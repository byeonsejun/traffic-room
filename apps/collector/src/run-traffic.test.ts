import { describe, expect, test, vi } from 'vitest';
import { createTestDb } from '@traffic-room/db/test-db';
import { recordRun, type Db } from '@traffic-room/db';
import type { HighwaysIndex } from '@traffic-room/highways';
import type { ItsClient, TrafficFetch } from '@traffic-room/its';
import { readTiming } from '@traffic-room/shared';
import { formatTrafficLine, runTraffic } from './run-traffic.ts';

const timing = readTiming({});
const ids = Array.from({ length: 10 }, (_, i) => `L${i}`);
const highways: HighwaysIndex = {
  size: ids.length,
  get: (id) => (ids.includes(id) ? { route: '경부선', lengthM: 1000 } : undefined),
};
const fetchOf = (n: number, dataAt = '2026-11-13T01:00:00.000Z'): TrafficFetch => ({
  dataAt: [dataAt],
  items: ids.slice(0, n).map((linkId) => ({ linkId, roadName: '경부고속도로', speed: 80, dataAt })),
});
const itsOf = (traffic: ItsClient['traffic']): ItsClient => ({ events: vi.fn(async () => []), cctvs: vi.fn(async () => []), traffic });
const now = () => new Date('2026-11-13T02:10:00.000Z');
const count = async (db: Db, table: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n;

describe('runTraffic', () => {
  test('첫 실행은 저장하고 showAt 은 기준 시각 + 지연', async () => {
    const db = await createTestDb();
    const r = await runTraffic({ db, its: itsOf(async () => fetchOf(10)), now, timing, highways });
    expect(r).toMatchObject({ status: 'ok', links: 10, missing: 0, unknown: 0 });
    expect(await count(db, 'traffic_snapshots')).toBe(1);
    const row = (await db.query<{ show_at: Date | string }>('select show_at from traffic_snapshots'))[0]!;
    expect(new Date(row.show_at).toISOString()).toBe('2026-11-13T02:00:00.000Z');
  });

  test('ITS 가 소수 속도를 줘도 ok 로 저장한다', async () => {
    const db = await createTestDb();
    const fetched = fetchOf(10);
    fetched.items = fetched.items.map((it, i) => ({ ...it, speed: 55.5 + i * 1.2 }));
    const r = await runTraffic({ db, its: itsOf(async () => fetched), now, timing, highways });
    expect(r).toMatchObject({ status: 'ok', links: 10 });
    expect(await count(db, 'traffic_snapshots')).toBe(1);
    expect(await count(db, 'link_speeds')).toBe(10);
  });

  test('같은 응답을 다시 받으면 same 이고 아무것도 더 쓰지 않는다', async () => {
    const db = await createTestDb();
    const its = itsOf(async () => fetchOf(10));
    await runTraffic({ db, its, now, timing, highways });
    const r = await runTraffic({ db, its, now, timing, highways });
    expect(r.status).toBe('same');
    expect(await count(db, 'traffic_snapshots')).toBe(1);
    expect(await count(db, 'traffic_buckets')).toBe(1);
    expect(await count(db, 'collector_runs where ok')).toBe(2);
  });

  test('구간이 절반만 온 응답은 거부하고 스냅샷은 그대로', async () => {
    const db = await createTestDb();
    const traffic = vi.fn().mockResolvedValueOnce(fetchOf(10)).mockResolvedValueOnce(fetchOf(5, '2026-11-13T02:00:00.000Z'));
    const its = itsOf(traffic);
    await runTraffic({ db, its, now, timing, highways });
    const r = await runTraffic({ db, its, now, timing, highways });
    expect(r).toMatchObject({ status: 'rejected', reason: 'too-few' });
    expect(await count(db, 'traffic_snapshots')).toBe(1);
    expect(await count(db, 'collector_runs where not ok')).toBe(1);
  });

  test('월 한도에 닿으면 ITS 를 부르지 않는다', async () => {
    const db = await createTestDb();
    for (let i = 0; i < 3; i++) await recordRun(db, 'traffic', true, 1, new Date(now().getTime() - 1000 * (i + 1)));
    const traffic = vi.fn();
    const r = await runTraffic({ db, its: itsOf(traffic), now, timing: readTiming({ ITS_MONTHLY_LIMIT: '3' }), highways });
    expect(r.status).toBe('skipped-budget');
    expect(traffic).not.toHaveBeenCalled();
  });

  test('정리가 실패해도 저장과 ok 기록은 그대로', async () => {
    const real = await createTestDb();
    const db: Db = { query: (t, p) => real.query(t, p), batch: async () => { throw Object.assign(new Error('x'), { code: 'PRUNE' }); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runTraffic({ db, its: itsOf(async () => fetchOf(10)), now, timing, highways });
    expect(r.status).toBe('ok');
    expect(err).toHaveBeenCalledWith('traffic prune failed code=PRUNE');
    err.mockRestore();
    expect(await count(real, 'traffic_snapshots')).toBe(1);
    expect(await count(real, 'collector_runs')).toBe(1);
    expect(await count(real, 'collector_runs where ok')).toBe(1);
  });

  test('ITS 오류는 failed 로 남기고 DB 는 그대로', async () => {
    const db = await createTestDb();
    const r = await runTraffic({ db, its: itsOf(async () => { throw Object.assign(new Error('x'), { code: 'ITS_RESULT' }); }), now, timing, highways });
    expect(r).toMatchObject({ status: 'failed', code: 'ITS_RESULT' });
    expect(await count(db, 'traffic_snapshots')).toBe(0);
  });
});

describe('runTraffic 기준 시각', () => {
  test('도로 모양 밖 구간의 다른 시각은 저장을 막지 않고, 저장 시각은 본선 구간의 것', async () => {
    const db = await createTestDb();
    const base = fetchOf(10);
    const mixed: TrafficFetch = {
      dataAt: [...base.dataAt, '2026-11-13T00:55:00.000Z'],
      items: [...base.items, { linkId: 'N1', roadName: '국도1호선', speed: 50, dataAt: '2026-11-13T00:55:00.000Z' }],
    };
    const r = await runTraffic({ db, its: itsOf(async () => mixed), now, timing, highways });
    expect(r).toMatchObject({ status: 'ok', dataAt: new Date('2026-11-13T01:00:00.000Z') });
    expect(await count(db, 'traffic_snapshots')).toBe(1);
  });
});

describe('formatTrafficLine', () => {
  test('한 줄에 links · missing · unknown · data 를 담는다', () => {
    const line = formatTrafficLine({ status: 'ok', links: 8964, missing: 12269, unknown: 5900, dataAt: new Date('2026-11-13T01:00:00.000Z') });
    expect(line).toBe('traffic ok links=8964 missing=12269 unknown=5900 data=10:00');
  });
});
