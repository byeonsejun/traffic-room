import { afterEach, expect, test } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readTiming, type Metrics } from '@traffic-room/shared';
import { createMetricsState, type MetricsLoad, type MetricsState } from './metrics.ts';
import { registerSse } from './sse.ts';

const ORIGIN = 'http://localhost:3000';

const base: Metrics = {
  trafficSnapshotId: 1,
  trafficDataAt: '2026-11-13T02:00:00.000Z',
  nextTrafficAt: null,
  traffic: { avgSpeed: 80, ok: 10, slow: 2, jam: 1, jamKm: 3.5 },
  incidents: { total: 0, byCategory: { accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
  delayMinutes: 60,
  intervalMinutes: 60,
};

/** 테스트용 지표 상태: set 으로 값을 바꾸면 구독자에게 알린다. */
function fakeMetrics(initial: Metrics) {
  let value = initial;
  const subs = new Set<(m: Metrics) => void>();
  const state: MetricsState & { set(m: Metrics): void; subscribers(): number } = {
    current: () => value,
    ready: () => true,
    reload: async () => {},
    onEvent: () => {},
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    stop: () => subs.clear(),
    set(m) {
      value = m;
      for (const fn of subs) fn(m);
    },
    subscribers: () => subs.size,
  };
  return state;
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
});

async function start(metrics: MetricsState, pingMs?: number) {
  const app = Fastify();
  registerSse(app, metrics, [ORIGIN], { pingMs });
  await app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(app);
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return { app, url: `http://127.0.0.1:${addr.port}/sse/metrics` };
}

type Event = { id: number; event: string; data: Metrics };

/** 스트림을 조금씩 읽어 완성된 이벤트 블록만 돌려준다. */
function reader(body: ReadableStream<Uint8Array>) {
  const r = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    async next(): Promise<Event> {
      for (;;) {
        const end = buf.indexOf('\n\n');
        if (end >= 0) {
          const block = buf.slice(0, end);
          buf = buf.slice(end + 2);
          if (block.startsWith(':')) continue; // ping
          const f = Object.fromEntries(block.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
          return { id: Number(f.id), event: String(f.event), data: JSON.parse(String(f.data)) as Metrics };
        }
        const { value, done } = await r.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value, { stream: true });
      }
    },
  };
}

test('허용 Origin 은 접속 즉시 metrics 이벤트를 받고, 바뀌면 id 가 1 오른 이벤트를 받는다', async () => {
  const metrics = fakeMetrics(base);
  const { url } = await start(metrics);
  const ac = new AbortController();
  const res = await fetch(url, { headers: { origin: ORIGIN }, signal: ac.signal });

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);

  const events = reader(res.body!);
  const first = await events.next();
  expect(first.event).toBe('metrics');
  expect(first.data).toEqual(base);

  metrics.set({ ...base, nextTrafficAt: '2026-11-13T03:10:00.000Z' });
  const second = await events.next();
  expect(second.event).toBe('metrics');
  expect(second.id).toBe(first.id + 1);
  expect(second.data.nextTrafficAt).toBe('2026-11-13T03:10:00.000Z');

  ac.abort();
  await expect.poll(() => metrics.subscribers()).toBe(0);
});

test('허용되지 않은 Origin 이나 Origin 이 없으면 403', async () => {
  const metrics = fakeMetrics(base);
  const { url } = await start(metrics);

  const bad = await fetch(url, { headers: { origin: 'https://evil.example' } });
  expect(bad.status).toBe(403);
  expect(bad.headers.get('content-type')).not.toBe('text/event-stream');
  await bad.body?.cancel();

  const none = await fetch(url);
  expect(none.status).toBe(403);
  await none.body?.cancel();
  expect(metrics.subscribers()).toBe(0);
});

test('서버를 닫으면 열린 스트림도 끝난다', async () => {
  const metrics = fakeMetrics(base);
  const { app, url } = await start(metrics);
  const res = await fetch(url, { headers: { origin: ORIGIN } });
  const events = reader(res.body!);
  await events.next();
  await app.close();
  apps = [];
  await expect(events.next()).rejects.toThrow('stream ended');
  expect(metrics.subscribers()).toBe(0);
});

test('첫 조회 전에는 200 과 헤더만 보내고, 조회가 끝나면 DB 값으로 첫 metrics 이벤트를 보낸다', async () => {
  let resolve!: (v: MetricsLoad) => void;
  const metrics = createMetricsState({
    load: () => new Promise<MetricsLoad>((r) => (resolve = r)),
    now: () => new Date('2026-11-13T03:00:00.000Z'),
    timing: readTiming({}),
  });
  const { url } = await start(metrics);
  const loading = metrics.reload();
  const res = await fetch(url, { headers: { origin: ORIGIN } });
  expect(res.status).toBe(200);
  expect(metrics.ready()).toBe(false);

  const events = reader(res.body!);
  const byCategory = { ...base.incidents.byCategory, construction: 2 };
  resolve({
    shown: {
      id: 7,
      dataAt: new Date('2026-11-13T02:00:00.000Z'),
      showAt: new Date('2026-11-13T02:55:00.000Z'),
      summary: { avgSpeed: 71, ok: 5, slow: 1, jam: 0, jamKm: 0 },
    },
    upcoming: [],
    incidents: { total: 2, byCategory },
  });
  await loading;
  const first = await events.next();
  expect(first.event).toBe('metrics');
  expect(first.data.trafficSnapshotId).toBe(7);
  expect(first.data.traffic?.avgSpeed).toBe(71);
  expect(first.data.incidents).toEqual({ total: 2, byCategory });
  metrics.stop();
});

test('pingMs 마다 주석 줄로 연결을 유지한다', async () => {
  const { url } = await start(fakeMetrics(base), 20);
  const ac = new AbortController();
  const res = await fetch(url, { headers: { origin: ORIGIN }, signal: ac.signal });
  const r = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  while (!text.includes(': ping\n\n')) {
    const { value, done } = await r.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  expect(text).toContain(': ping\n\n');
  ac.abort();
});
