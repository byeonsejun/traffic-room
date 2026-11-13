import { describe, expect, test, vi } from 'vitest';
import { createTestDb } from '@traffic-room/db/test-db';
import { countRunsThisMonth, getActiveKeys, getCctvs, recordRun, type Db } from '@traffic-room/db';
import { ItsError, type ItsClient } from '@traffic-room/its';
import { readTiming, type Cctv, type Incident } from '@traffic-room/shared';
import { runCctvs } from './run-cctvs.ts';
import { runEvents } from './run-events.ts';

const inc = (key: string): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '서울', detail: '', message: '',
  lanesBlocked: '', lon: 127, lat: 37, startedAt: '2026-09-18T08:00:00+09:00',
});
const cctv = (id: string): Cctv => ({ id, name: id, lon: 127, lat: 37, url: `https://x/${id}.m3u8`, fetchedAt: '2026-11-11T10:00:00Z' });
const timing = readTiming({});
const at = (hm: string) => new Date(`2026-11-11T${hm}:00+09:00`);

function fakeIts(over: Partial<ItsClient> = {}): ItsClient {
  return { events: vi.fn(async () => []), cctvs: vi.fn(async () => []), traffic: vi.fn(async () => ({ dataAt: [], items: [] })), ...over };
}
const failedRuns = async (db: Db) =>
  (await db.query<{ n: number }>("select count(*)::int as n from collector_runs where not ok"))[0]!.n;

describe('runEvents', () => {
  test('keeps state when ITS fails', async () => {
    const db = await createTestDb();
    const events = vi.fn().mockResolvedValueOnce([inc('a'), inc('b')]).mockRejectedValueOnce(new ItsError('4001', 'x'));
    const its = fakeIts({ events });

    const first = await runEvents({ db, its, timing, now: () => at('22:05') });
    expect(first.status).toBe('ok');
    expect(await getActiveKeys(db)).toEqual(['a', 'b']);

    const second = await runEvents({ db, its, timing, now: () => at('23:05') });
    expect(second).toMatchObject({ status: 'failed', code: '4001' });
    expect(await getActiveKeys(db)).toEqual(['a', 'b']);
    expect(await failedRuns(db)).toBe(1);
  });

  test('an empty ITS response over active incidents fails without clearing', async () => {
    const db = await createTestDb();
    const events = vi.fn().mockResolvedValueOnce([inc('a')]).mockResolvedValueOnce([]);
    const its = fakeIts({ events });
    await runEvents({ db, its, timing, now: () => at('22:05') });
    const r = await runEvents({ db, its, timing, now: () => at('23:05') });
    expect(r.status).toBe('failed');
    expect(await getActiveKeys(db)).toEqual(['a']);
    expect(await failedRuns(db)).toBe(1);
  });

  test('records arrivals and clears across runs', async () => {
    const db = await createTestDb();
    const events = vi.fn()
      .mockResolvedValueOnce([inc('a')])
      .mockResolvedValueOnce([{ ...inc('n'), startedAt: '2026-11-11T22:30:00+09:00' }]);
    const its = fakeIts({ events });
    await runEvents({ db, its, timing, now: () => at('22:05') });
    const r = await runEvents({ db, its, timing, now: () => at('23:05') });
    expect(r).toMatchObject({ status: 'ok', arrived: 1, cleared: 1 });
    expect(await getActiveKeys(db)).toEqual(['n']);
  });

  test('uses the configured delay for arrival times', async () => {
    const db = await createTestDb();
    const t20 = readTiming({ DELAY_MINUTES: '20' });
    const its = fakeIts({ events: vi.fn().mockResolvedValueOnce([inc('a')]).mockResolvedValueOnce([{ ...inc('n'), startedAt: '2026-11-11T22:30:00+09:00' }]) });
    await runEvents({ db, its, timing: t20, now: () => at('22:05') });
    await runEvents({ db, its, timing: t20, now: () => at('23:05') });
    const rows = await db.query<{ emit_at: Date | string }>("select emit_at from event_log where kind = 'arrived'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const ms = new Date(r.emit_at).getTime();
      expect(ms).toBeGreaterThanOrEqual(at('22:05').getTime());
      expect(ms).toBeLessThanOrEqual(at('23:05').getTime() + 20 * 60_000);
    }
  });

  test('prunes incidents cleared 8 days ago after a successful run', async () => {
    const db = await createTestDb();
    const old = new Date(at('22:05').getTime() - 8 * 86_400_000);
    await db.query(
      `insert into incidents (key, category, road_name, direction, detail, message, lanes_blocked, lon, lat,
         started_at, first_seen_at, last_seen_at, arrive_at, cleared_at)
       values ('gone', 'accident', 'r', 'd', 'x', 'm', '', 127, 37, $1, $1, $1, null, $1)`,
      [old],
    );
    await db.query(`insert into event_log (kind, incident_key, emit_at) values ('cleared', 'gone', $1)`, [old]);
    const its = fakeIts({ events: vi.fn().mockResolvedValue([inc('a')]) });
    await runEvents({ db, its, timing, now: () => at('22:05') });
    expect(await db.query("select 1 from incidents where key = 'gone'")).toHaveLength(0);
    expect(await db.query("select 1 from event_log where incident_key = 'gone'")).toHaveLength(0);
  });

  test('skips when the configured monthly limit is reached', async () => {
    const db = await createTestDb();
    for (let i = 0; i < 3; i++) await recordRun(db, 'events', true, 1, new Date(at('00:00').getTime() + i * 1000));
    const its = fakeIts();
    const r = await runEvents({ db, its, timing: readTiming({ ITS_MONTHLY_LIMIT: '3' }), now: () => at('23:05') });
    expect(r.status).toBe('skipped-budget');
    expect(its.events).not.toHaveBeenCalled();
  });

  test('skips without calling ITS when 950 calls were already made this month', async () => {
    const db = await createTestDb();
    for (let i = 0; i < 950; i++) await recordRun(db, 'events', true, 1, new Date(at('00:00').getTime() + i * 1000));
    const its = fakeIts();
    const r = await runEvents({ db, its, timing, now: () => at('23:05') });
    expect(r.status).toBe('skipped-budget');
    expect(its.events).not.toHaveBeenCalled();
    expect(await countRunsThisMonth(db, 'events', at('23:05'))).toBe(950);
  });
});

describe('runCctvs', () => {
  test('fetches ex and its once each and upserts', async () => {
    const db = await createTestDb();
    const cctvs = vi.fn(async (type: 'ex' | 'its') => (type === 'ex' ? [cctv('e1')] : [cctv('i1'), cctv('i2')]));
    const its = fakeIts({ cctvs });
    const r = await runCctvs({ db, its, timing, now: () => at('23:15') });
    expect(r).toEqual({ status: 'ok', count: 3 });
    expect(cctvs).toHaveBeenCalledTimes(2);
    expect(cctvs.mock.calls.map((c) => c[0])).toEqual(['ex', 'its']);
    expect(await countRunsThisMonth(db, 'cctv', at('23:15'))).toBe(2);
    expect((await getCctvs(db)).map((c) => c.id)).toEqual(['e1', 'i1', 'i2']);
  });

  test('keeps what it got when one type fails, and reports failure', async () => {
    const db = await createTestDb();
    const cctvs = vi.fn(async (type: 'ex' | 'its') => {
      if (type === 'its') throw new ItsError('HTTP_500', 'x');
      return [cctv('e1')];
    });
    const r = await runCctvs({ db, its: fakeIts({ cctvs }), timing, now: () => at('23:15') });
    expect(r).toMatchObject({ status: 'failed', count: 1, code: 'HTTP_500' });
    expect((await getCctvs(db)).map((c) => c.id)).toEqual(['e1']);
    expect(await failedRuns(db)).toBe(1);
  });

  test('skips when the monthly budget is used up', async () => {
    const db = await createTestDb();
    for (let i = 0; i < 950; i++) await recordRun(db, 'cctv', true, 1, new Date(at('00:00').getTime() + i * 1000));
    const its = fakeIts();
    const r = await runCctvs({ db, its, timing, now: () => at('23:15') });
    expect(r.status).toBe('skipped-budget');
    expect(its.cctvs).not.toHaveBeenCalled();
  });
});
