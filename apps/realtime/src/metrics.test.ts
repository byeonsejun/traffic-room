import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { TrafficSnapshotRow } from '@traffic-room/db';
import { readTiming, type Category, type LogEvent, type Metrics } from '@traffic-room/shared';
import { createMetricsState } from './metrics.ts';

const T0 = new Date('2026-11-13T03:00:00.000Z');
const MIN = 60_000;

function snap(id: number, showOffsetMin: number, avgSpeed: number): TrafficSnapshotRow {
  const showAt = new Date(T0.getTime() + showOffsetMin * MIN);
  return {
    id,
    dataAt: new Date(showAt.getTime() - 60 * MIN),
    showAt,
    summary: { avgSpeed, ok: 10, slow: 2, jam: 1, jamKm: 3.5 },
  };
}

const zero = (): Record<Category, number> => ({
  accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0,
});

function ev(id: number, kind: LogEvent['kind'], category: Category = 'accident'): LogEvent {
  return {
    id, kind, emitAt: T0.toISOString(),
    incident: {
      key: `k${id}`, category, roadName: '경부선', direction: '서울',
      detail: '', message: '', lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
    },
  };
}

type Loaded = { shown: TrafficSnapshotRow | null; upcoming: TrafficSnapshotRow[]; incidents: Metrics['incidents'] };

function make(load: () => Promise<Loaded>) {
  return createMetricsState({
    load,
    now: () => new Date(),
    timing: readTiming({}),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

test('upcoming 스냅샷의 showAt 이 되면 교통 지표를 바꾸고 구독자에게 한 번 알린다', async () => {
  const A = snap(1, -30, 80);
  const B = snap(2, 10, 60);
  const m = make(async () => ({ shown: A, upcoming: [B], incidents: { total: 0, byCategory: zero() } }));
  await m.reload();

  expect(m.current().traffic?.avgSpeed).toBe(80);
  expect(m.current().trafficSnapshotId).toBe(1);
  expect(m.current().trafficDataAt).toBe(A.dataAt.toISOString());
  expect(m.current().nextTrafficAt).toBe(B.showAt.toISOString());
  expect(m.current().delayMinutes).toBe(60);
  expect(m.current().intervalMinutes).toBe(60);

  const seen: Metrics[] = [];
  m.subscribe((x) => seen.push(x));
  await vi.advanceTimersByTimeAsync(10 * MIN);

  expect(m.current().traffic?.avgSpeed).toBe(60);
  expect(m.current().trafficSnapshotId).toBe(2);
  expect(m.current().nextTrafficAt).toBeNull();
  expect(seen).toHaveLength(1);
  expect(seen[0]?.traffic?.avgSpeed).toBe(60);
  m.stop();
});

test('reload 는 타이머를 새로 걸고, 이미 공개된 스냅샷을 다시 알리지 않는다', async () => {
  const A = snap(1, -30, 80);
  const B = snap(2, 10, 60);
  const C = snap(3, 40, 50);
  let rows: Loaded = { shown: A, upcoming: [B], incidents: { total: 0, byCategory: zero() } };
  const m = make(async () => rows);
  await m.reload();
  const seen: Metrics[] = [];
  m.subscribe((x) => seen.push(x));

  await vi.advanceTimersByTimeAsync(10 * MIN); // B 공개
  expect(seen).toHaveLength(1);

  // 30분 재조회: DB 기준으로도 B 가 공개 중이고, C 가 다음.
  rows = { shown: B, upcoming: [B, C], incidents: { total: 0, byCategory: zero() } };
  await vi.advanceTimersByTimeAsync(20 * MIN);
  await m.reload();
  expect(seen).toHaveLength(2); // nextTrafficAt 만 바뀜
  expect(seen[1]?.trafficSnapshotId).toBe(2);
  expect(seen[1]?.nextTrafficAt).toBe(C.showAt.toISOString());

  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(m.current().trafficSnapshotId).toBe(3);
  expect(seen).toHaveLength(3);
  m.stop();
});

test('값이 그대로면 구독자를 부르지 않는다', async () => {
  const A = snap(1, -30, 80);
  const m = make(async () => ({ shown: A, upcoming: [], incidents: { total: 0, byCategory: zero() } }));
  await m.reload();
  const fn = vi.fn();
  m.subscribe(fn);
  await m.reload();
  expect(fn).not.toHaveBeenCalled();
  m.stop();
});

test('교통 데이터가 없으면 null 로 둔다', async () => {
  const m = make(async () => ({ shown: null, upcoming: [], incidents: { total: 0, byCategory: zero() } }));
  await m.reload();
  expect(m.current()).toMatchObject({ trafficSnapshotId: null, trafficDataAt: null, nextTrafficAt: null, traffic: null });
  m.stop();
});

test('onEvent: arrived 는 +1, cleared 는 −1, 0 아래로 내려가지 않는다', async () => {
  const m = make(async () => ({ shown: null, upcoming: [], incidents: { total: 0, byCategory: zero() } }));
  await m.reload();
  const fn = vi.fn();
  m.subscribe(fn);

  m.onEvent(ev(1, 'arrived', 'accident'));
  expect(m.current().incidents.total).toBe(1);
  expect(m.current().incidents.byCategory.accident).toBe(1);

  m.onEvent(ev(2, 'cleared', 'accident'));
  expect(m.current().incidents).toEqual({ total: 0, byCategory: zero() });

  m.onEvent(ev(3, 'cleared', 'weather')); // 해제가 먼저 와도 음수가 되지 않는다
  expect(m.current().incidents).toEqual({ total: 0, byCategory: zero() });
  expect(fn).toHaveBeenCalledTimes(2);
  m.stop();
});

test('reload 는 돌발 수를 DB 값으로 되돌린다', async () => {
  const byCategory = { ...zero(), construction: 2 };
  const m = make(async () => ({ shown: null, upcoming: [], incidents: { total: 2, byCategory } }));
  m.onEvent(ev(1, 'arrived', 'accident'));
  await m.reload();
  expect(m.current().incidents).toEqual({ total: 2, byCategory });
  m.stop();
});

test('조회가 실패하면 이전 상태를 유지한다', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const A = snap(1, -30, 80);
  let fail = false;
  const m = make(async () => {
    if (fail) throw new Error('boom');
    return { shown: A, upcoming: [], incidents: { total: 0, byCategory: zero() } };
  });
  await m.reload();
  fail = true;
  await m.reload();
  expect(m.current().trafficSnapshotId).toBe(1);
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0]?.[0])).not.toContain('boom');
  err.mockRestore();
  m.stop();
});

test('stop 뒤에는 타이머가 울리지 않는다', async () => {
  const m = make(async () => ({ shown: snap(1, -30, 80), upcoming: [snap(2, 10, 60)], incidents: { total: 0, byCategory: zero() } }));
  await m.reload();
  const fn = vi.fn();
  m.subscribe(fn);
  m.stop();
  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(fn).not.toHaveBeenCalled();
  expect(m.current().trafficSnapshotId).toBe(1);
});
