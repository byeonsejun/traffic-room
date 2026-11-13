import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import { createTestDb } from '@traffic-room/db/test-db';
import { applyIncidentPlan, getCctv, recordRun, upsertCctvs, type Db } from '@traffic-room/db';
import type { ItsClient } from '@traffic-room/its';
import { parseServerMessage, readTiming, type Cctv, type Incident, type LogEvent, type ServerMessage } from '@traffic-room/shared';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.ts';
import { createHub } from './hub.ts';
import { createDailyQuota, refreshCctv } from './cctv-refresh.ts';

const NOW = new Date('2026-11-12T03:00:00Z'); // KST 12:00
const ORIGIN = 'http://localhost:3000';

const inc = (key: string): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '서울', detail: '', message: '',
  lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
});
const SEOCHO: Cctv = {
  id: 'c1', name: '[경부선] 서초', lon: 127.0251, lat: 37.4836,
  url: 'https://cctv.example/old.m3u8', fetchedAt: '2026-11-12T00:00:00.000Z',
};

function fakeIts(list: Cctv[] = []): ItsClient & { cctvs: ReturnType<typeof vi.fn> } {
  return { events: vi.fn(async () => []), cctvs: vi.fn(async () => list), traffic: vi.fn(async () => ({ dataAt: [], items: [] })) };
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
});

async function setup(opts: { its?: ItsClient; db?: Db; idleMs?: number; cctvRefresh?: boolean } = {}) {
  const db = opts.db ?? (await createTestDb());
  const its = opts.its ?? fakeIts();
  const hub = createHub();
  const app = await buildServer({ db, its, timing: readTiming({}), now: () => NOW, allowedOrigins: [ORIGIN], hub, idleMs: opts.idleMs, cctvRefresh: opts.cctvRefresh });
  await app.ready();
  apps.push(app);
  return { app, db, its, hub };
}

interface Client {
  ws: WebSocket;
  next(): Promise<ServerMessage>;
  closed: Promise<number>;
  send(m: unknown): void;
}

/** onInit 에서 듣기 시작해 연결 직후 오는 hello 도 놓치지 않는다. */
async function connect(app: FastifyInstance, origin = ORIGIN, path = '/ws'): Promise<Client> {
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  let onClose!: (code: number) => void;
  const closed = new Promise<number>((r) => (onClose = r));
  const ws = await app.injectWS(path, { headers: { origin } }, {
    onInit(ws) {
      ws.on('message', (data) => {
        const m = parseServerMessage(String(data));
        if (!m) throw new Error('server sent an invalid message: ' + String(data));
        const w = waiters.shift();
        if (w) w(m);
        else queue.push(m);
      });
      ws.on('close', (code) => onClose(code));
    },
  });
  return {
    ws,
    closed,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next: () => {
      const m = queue.shift();
      if (m) return Promise.resolve(m);
      return new Promise((r) => waiters.push(r));
    },
  };
}

/** 문구에 needle 이 든 첫 쿼리를 open() 전까지 붙잡아 두는 Db (Neon 콜드 스타트 흉내). */
function gated(db: Db, needle: string) {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  let reach!: () => void;
  const reached = new Promise<void>((r) => (reach = r));
  let held = false;
  const wrapped: Db = {
    async query<T>(text: string, params?: unknown[]) {
      if (!held && text.includes(needle)) {
        held = true;
        reach();
        await opened;
      }
      return db.query<T>(text, params);
    },
    batch: (s) => db.batch(s),
  };
  return { db: wrapped, open, reached };
}

/** 지금보다 이전 송출 시각의 로그 3건(id 1,2,3)을 만든다. */
async function seedThreeEvents(db: Db) {
  const base = NOW.getTime() - 3 * 60 * 60_000;
  await applyIncidentPlan(db, {
    quiet: [], seen: [], cleared: [],
    arriving: ['a', 'b', 'c'].map((k, i) => ({ incident: inc(k), emitAt: new Date(base + i * 60_000) })),
  }, new Date(base - 60 * 60_000));
}

describe('websocket', () => {
  test('sends hello with delay and latest id on connect', async () => {
    const { app, db } = await setup();
    await seedThreeEvents(db);
    const c = await connect(app);
    const hello = await c.next();
    expect(hello).toMatchObject({ id: 0, type: 'hello', payload: { delayMinutes: 60, latestId: 3 } });
  });

  test('resume returns missed events after lastId in order, max 200', async () => {
    const { app, db } = await setup();
    await seedThreeEvents(db);
    const c = await connect(app);
    await c.next(); // hello
    c.send({ type: 'resume', lastId: 1 });
    const m2 = await c.next();
    const m3 = await c.next();
    expect([m2.id, m3.id]).toEqual([2, 3]);
    expect(m2).toMatchObject({ type: 'incident.arrived', payload: { incident: { key: 'b' } } });
    expect(m3).toMatchObject({ type: 'incident.arrived', payload: { incident: { key: 'c' } } });
  });

  test('resume answers at most 200 events', async () => {
    const { app, db } = await setup();
    const base = NOW.getTime() - 5 * 60 * 60_000;
    await applyIncidentPlan(db, {
      quiet: [], seen: [], cleared: [],
      arriving: Array.from({ length: 250 }, (_, i) => ({ incident: inc(`k${i}`), emitAt: new Date(base + i * 1000) })),
    }, new Date(base - 60 * 60_000));
    const c = await connect(app);
    await c.next(); // hello
    c.send({ type: 'resume', lastId: 0 });
    c.send({ type: 'ping' });
    const ids: number[] = [];
    for (;;) {
      const m = await c.next();
      if (m.type === 'pong') break;
      ids.push(m.id);
    }
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(200);
  });

  test('lastId in the url is resumed before any broadcast, without a resume message', async () => {
    const { app, db, hub } = await setup();
    await seedThreeEvents(db);
    const c = await connect(app, ORIGIN, '/ws?lastId=1');
    // 클라이언트가 아무 말도 하기 전에 브로드캐스트가 먼저 나간다.
    hub.broadcast({ id: 9, kind: 'arrived', emitAt: NOW.toISOString(), incident: inc('z') });
    const got = [await c.next(), await c.next(), await c.next(), await c.next()];
    expect(got.map((m) => m.type)).toEqual(['hello', 'incident.arrived', 'incident.arrived', 'incident.arrived']);
    expect(got.map((m) => m.id)).toEqual([0, 2, 3, 9]);
  });

  test.each(['abc', '-1', '1.5', ''])('ignores an invalid lastId in the url (%s)', async (bad) => {
    const { app, db, hub } = await setup();
    await seedThreeEvents(db);
    const c = await connect(app, ORIGIN, `/ws?lastId=${bad}`);
    hub.broadcast({ id: 9, kind: 'arrived', emitAt: NOW.toISOString(), incident: inc('z') });
    expect((await c.next()).type).toBe('hello');
    expect((await c.next()).id).toBe(9);
  });

  test('responds pong to ping', async () => {
    const { app } = await setup();
    const c = await connect(app);
    await c.next();
    c.send({ type: 'ping' });
    expect(await c.next()).toMatchObject({ id: 0, type: 'pong', payload: {} });
  });

  test('rejects connections from origins not in ALLOWED_ORIGINS', async () => {
    const { app } = await setup();
    const c = await connect(app, 'https://evil.example');
    expect(await c.closed).toBe(1008);
  });

  test('ignores malformed client messages without closing', async () => {
    const { app } = await setup();
    const c = await connect(app);
    await c.next();
    c.send('{');
    c.send({ type: 'nope' });
    c.send({ type: 'ping' });
    expect(await c.next()).toMatchObject({ type: 'pong' });
    expect(c.ws.readyState).toBe(c.ws.OPEN);
  });

  test('closes clients that stay silent past the idle limit', async () => {
    const { app } = await setup({ idleMs: 50 });
    const c = await connect(app);
    expect(await c.closed).toBe(4000);
  });

  test('cctv.request refresh=false returns cached url', async () => {
    const { app, db, its } = await setup();
    await upsertCctvs(db, [SEOCHO]);
    const c = await connect(app);
    await c.next();
    c.send({ type: 'cctv.request', cctvId: 'c1', refresh: false });
    expect(await c.next()).toMatchObject({
      type: 'cctv.url', payload: { cctvId: 'c1', url: SEOCHO.url, reason: 'cached' },
    });
    expect(its.cctvs).not.toHaveBeenCalled();
  });

  test('cctv.request for an unknown cctv is unavailable', async () => {
    const { app } = await setup();
    const c = await connect(app);
    await c.next();
    c.send({ type: 'cctv.request', cctvId: 'nope', refresh: true });
    expect(await c.next()).toMatchObject({ type: 'cctv.url', payload: { cctvId: 'nope', url: null, reason: 'unavailable' } });
  });

  test('cctv.request refresh=true with CCTV_REFRESH off never calls ITS and answers the cached url', async () => {
    const { app, db, its } = await setup({ cctvRefresh: false });
    await upsertCctvs(db, [SEOCHO]);
    const c = await connect(app);
    await c.next();
    c.send({ type: 'cctv.request', cctvId: 'c1', refresh: true });
    expect(await c.next()).toMatchObject({
      type: 'cctv.url', payload: { cctvId: 'c1', url: SEOCHO.url, reason: 'cached' },
    });
    expect(its.cctvs).not.toHaveBeenCalled();
  });

  test('cctv.request refresh=true with CCTV_REFRESH off for an unknown cctv is unavailable', async () => {
    const { app, its } = await setup({ cctvRefresh: false });
    const c = await connect(app);
    await c.next();
    c.send({ type: 'cctv.request', cctvId: 'nope', refresh: true });
    expect(await c.next()).toMatchObject({ type: 'cctv.url', payload: { cctvId: 'nope', url: null, reason: 'unavailable' } });
    expect(its.cctvs).not.toHaveBeenCalled();
  });

  test('cctv.request refresh=true calls ITS once with a ±0.01 bbox and updates the url', async () => {
    // 같은 이름이지만 좌표가 미세하게 달라 id 가 다르다. 이름으로 맞춘다.
    const fresh = { ...SEOCHO, id: 'other-id', lon: 127.02511, url: 'https://cctv.example/new.m3u8' };
    const decoy = { ...SEOCHO, id: 'c2', name: '[경부선] 양재', url: 'https://cctv.example/decoy.m3u8' };
    const its = fakeIts([decoy, fresh]);
    const { app, db } = await setup({ its });
    await upsertCctvs(db, [SEOCHO]);
    const c = await connect(app);
    await c.next();
    c.send({ type: 'cctv.request', cctvId: 'c1', refresh: true });
    expect(await c.next()).toMatchObject({
      type: 'cctv.url', payload: { cctvId: 'c1', url: fresh.url, reason: 'refreshed' },
    });
    expect(its.cctvs).toHaveBeenCalledTimes(1);
    const [type, bbox] = its.cctvs.mock.calls[0]!;
    expect(type).toBe('ex');
    expect(bbox.minX).toBeCloseTo(SEOCHO.lon - 0.01, 9);
    expect(bbox.maxX).toBeCloseTo(SEOCHO.lon + 0.01, 9);
    expect(bbox.minY).toBeCloseTo(SEOCHO.lat - 0.01, 9);
    expect(bbox.maxY).toBeCloseTo(SEOCHO.lat + 0.01, 9);
    expect((await getCctv(db, 'c1'))?.url).toBe(fresh.url);
    const runs = await db.query<{ ok: boolean; count: number }>("select ok, count from collector_runs where service = 'cctv'");
    expect(runs).toEqual([{ ok: true, count: 2 }]);
  });

  test('a broadcast during a slow resume arrives after the resumed events', async () => {
    const real = await createTestDb();
    await seedThreeEvents(real);
    const gate = gated(real, 'l.id > $1'); // getEventsAfter
    const { app, hub } = await setup({ db: gate.db });
    const c = await connect(app);
    expect((await c.next()).type).toBe('hello');
    c.send({ type: 'resume', lastId: 1 });
    await gate.reached;
    hub.broadcast({ id: 9, kind: 'cleared', emitAt: NOW.toISOString(), incident: inc('z') });
    gate.open();
    const ids = [(await c.next()).id, (await c.next()).id, (await c.next()).id];
    expect(ids).toEqual([2, 3, 9]);
  });

  test('a broadcast during a slow hello arrives after hello', async () => {
    const real = await createTestDb();
    const gate = gated(real, 'max(id)'); // latestEmittedId
    const { app, hub } = await setup({ db: gate.db });
    const pending = connect(app);
    await gate.reached;
    hub.broadcast({ id: 9, kind: 'arrived', emitAt: NOW.toISOString(), incident: inc('z') });
    gate.open();
    const c = await pending;
    expect((await c.next()).type).toBe('hello');
    expect(await c.next()).toMatchObject({ id: 9, type: 'incident.arrived' });
  });

  test('broadcast reaches every connected client', async () => {
    const { app, hub } = await setup();
    const a = await connect(app);
    const b = await connect(app);
    await a.next();
    await b.next();
    const e: LogEvent = { id: 7, kind: 'arrived', emitAt: NOW.toISOString(), incident: inc('x') };
    hub.broadcast(e);
    hub.broadcast({ ...e, id: 8, kind: 'cleared' });
    for (const c of [a, b]) {
      expect(await c.next()).toEqual({ id: 7, type: 'incident.arrived', ts: e.emitAt, payload: { incident: inc('x') } });
      expect(await c.next()).toEqual({ id: 8, type: 'incident.cleared', ts: e.emitAt, payload: { key: 'x' } });
    }
  });
});

describe('GET /health', () => {
  test('answers ok', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('refreshCctv', () => {
  async function deps(its: ItsClient) {
    const db = await createTestDb();
    await upsertCctvs(db, [SEOCHO]);
    return { db, its, timing: readTiming({}), now: () => NOW, quota: createDailyQuota(10) };
  }

  test('cctv refresh returns unavailable after 10 refreshes today', async () => {
    const its = fakeIts([{ ...SEOCHO, url: 'https://cctv.example/new.m3u8' }]);
    const d = await deps(its);
    for (let i = 0; i < 10; i++) {
      expect((await refreshCctv(d, 'c1')).reason).toBe('refreshed');
    }
    expect(await refreshCctv(d, 'c1')).toEqual({ url: null, reason: 'unavailable' });
    expect(its.cctvs).toHaveBeenCalledTimes(10);
  });

  test('the daily cap resets at KST midnight', async () => {
    const its = fakeIts([SEOCHO]);
    const d = await deps(its);
    let now = new Date('2026-11-12T14:59:00Z'); // KST 23:59
    d.now = () => now;
    for (let i = 0; i < 10; i++) await refreshCctv(d, 'c1');
    expect((await refreshCctv(d, 'c1')).reason).toBe('unavailable');
    now = new Date('2026-11-12T15:00:00Z'); // KST 다음 날 00:00
    expect((await refreshCctv(d, 'c1')).reason).toBe('refreshed');
  });

  test('does not call ITS when the monthly budget is used up', async () => {
    const its = fakeIts([SEOCHO]);
    const d = await deps(its);
    for (let i = 0; i < 950; i++) await recordRun(d.db, 'cctv', true, 1, NOW);
    expect(await refreshCctv(d, 'c1')).toEqual({ url: null, reason: 'unavailable' });
    expect(its.cctvs).not.toHaveBeenCalled();
  });

  test('falls back to the cached url and records a failed run when ITS fails', async () => {
    const its = fakeIts();
    its.cctvs.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'NETWORK' }));
    const d = await deps(its);
    expect(await refreshCctv(d, 'c1')).toEqual({ url: SEOCHO.url, reason: 'cached' });
    const runs = await d.db.query<{ ok: boolean; count: number }>("select ok, count from collector_runs where service = 'cctv'");
    expect(runs).toEqual([{ ok: false, count: 0 }]);
  });

  test('keeps the cached url when no result has the same name', async () => {
    const its = fakeIts([{ ...SEOCHO, name: '[경부선] 양재', url: 'https://cctv.example/wrong.m3u8' }]);
    const d = await deps(its);
    expect(await refreshCctv(d, 'c1')).toEqual({ url: SEOCHO.url, reason: 'cached' });
    expect((await getCctv(d.db, 'c1'))?.url).toBe(SEOCHO.url);
  });

  test('uses type its for national road cctvs', async () => {
    const its = fakeIts([]);
    const d = await deps(its);
    await upsertCctvs(d.db, [{ ...SEOCHO, id: 'n1', name: '[국도1호선] 평택' }]);
    await refreshCctv(d, 'n1');
    expect(its.cctvs.mock.calls[0]![0]).toBe('its');
  });
});
