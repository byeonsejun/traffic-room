import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LogEvent } from '@traffic-room/shared';
import { createScheduler } from './scheduler.ts';

const T0 = new Date('2026-11-12T00:00:00.000Z');
const MIN = 60_000;

function ev(id: number, offsetMin: number): LogEvent {
  return {
    id,
    kind: 'arrived',
    emitAt: new Date(T0.getTime() + offsetMin * MIN).toISOString(),
    incident: {
      key: `k${id}`, category: 'accident', roadName: '경부선', direction: '서울',
      detail: '', message: '', lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

function make(loadWindow: (from: Date, to: Date) => Promise<LogEvent[]>) {
  const emitted: number[] = [];
  const s = createScheduler({
    loadWindow,
    emit: (e) => emitted.push(e.id),
    now: () => new Date(),
    windowMinutes: 60,
    reloadMinutes: 30,
  });
  return { s, emitted };
}

test('emits each event at its emitAt, once', async () => {
  const { s, emitted } = make(async () => [ev(2, 20), ev(1, 10)]);
  await s.start();
  await vi.advanceTimersByTimeAsync(9 * MIN);
  expect(emitted).toEqual([]);
  await vi.advanceTimersByTimeAsync(1 * MIN);
  expect(emitted).toEqual([1]);
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(emitted).toEqual([1, 2]);
  s.stop();
});

test('reloads every 30 minutes and does not double-schedule ids it already has', async () => {
  const all = [ev(1, 10), ev(2, 40), ev(3, 50)];
  const loadWindow = vi.fn(async (from: Date, to: Date) =>
    all.filter((e) => Date.parse(e.emitAt) >= from.getTime() - 5 * MIN && Date.parse(e.emitAt) <= to.getTime()),
  );
  const { s, emitted } = make(loadWindow);
  await s.start();
  expect(loadWindow).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(loadWindow).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(loadWindow).toHaveBeenCalledTimes(3);
  expect(emitted).toEqual([1, 2, 3]);
  s.stop();
});

/** DB 처럼 (from, to] 범위만 돌려주는 loadWindow. 호출마다 범위를 기록한다. */
function windowed(all: LogEvent[]) {
  const calls: Array<[number, number]> = [];
  const fn = vi.fn(async (from: Date, to: Date) => {
    calls.push([from.getTime(), to.getTime()]);
    return all
      .filter((e) => Date.parse(e.emitAt) > from.getTime() && Date.parse(e.emitAt) <= to.getTime())
      .sort((a, b) => a.id - b.id);
  });
  return { fn, calls };
}

test('first load also covers the last reload interval and emits already-due events right away, in id order', async () => {
  // 시작 직전 35분(재조회 30분 + 여유 5분)은 이미 송출 시각이 지났어도 바로 내보낸다. 그 이전은 resume 전용이다.
  const { fn, calls } = windowed([ev(3, -10), ev(1, -40), ev(2, -20), ev(4, 5)]);
  const { s, emitted } = make(fn);
  await s.start();
  expect(calls[0]).toEqual([T0.getTime() - 35 * MIN, T0.getTime() + 60 * MIN]);
  expect(emitted).toEqual([2, 3]);
  await vi.advanceTimersByTimeAsync(5 * MIN);
  expect(emitted).toEqual([2, 3, 4]);
  s.stop();
});

test('event inserted after the last reload with emitAt before the next reload is still emitted', async () => {
  const all: LogEvent[] = [];
  const { fn, calls } = windowed(all);
  const { s, emitted } = make(fn);
  await s.start();
  // 수집기가 첫 조회 직후 넣었다. 송출 시각(+10분)은 다음 재조회(+30분)보다 앞이다.
  await vi.advanceTimersByTimeAsync(1 * MIN);
  all.push(ev(1, 10));
  await vi.advanceTimersByTimeAsync(29 * MIN);
  expect(calls[1]![0]).toBeLessThanOrEqual(T0.getTime());
  expect(emitted).toEqual([1]);
  // 다음 재조회에서 다시 잡혀도 두 번 나가지 않는다.
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(emitted).toEqual([1]);
  s.stop();
});

test('events due at the same instant go out in id order', async () => {
  const { fn } = windowed([ev(9, 10), ev(7, 10), ev(8, 10)]);
  const { s, emitted } = make(fn);
  await s.start();
  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(emitted).toEqual([7, 8, 9]);
  s.stop();
});

test('stop during an in-flight load schedules nothing and leaves no timers', async () => {
  let release!: (v: LogEvent[]) => void;
  const load = vi.fn(() => new Promise<LogEvent[]>((r) => (release = r)));
  const { s, emitted } = make(load);
  const started = s.start();
  s.stop();
  release([ev(1, -1), ev(2, 10)]);
  await started;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(emitted).toEqual([]);
  expect(load).toHaveBeenCalledTimes(1);
});

test('calling start twice does not leak a second reload interval', async () => {
  const { fn } = windowed([]);
  const { s } = make(fn);
  await s.start();
  await s.start();
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(fn).toHaveBeenCalledTimes(3); // start 두 번 + 재조회 한 번
  s.stop();
  expect(vi.getTimerCount()).toBe(0);
});

test('a failing loadWindow is retried on the next reload without crashing', async () => {
  const load = vi
    .fn<(from: Date, to: Date) => Promise<LogEvent[]>>()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue([ev(1, 40)]);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { s, emitted } = make(load);
  await expect(s.start()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(30 * MIN);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(emitted).toEqual([1]);
  expect(log).toHaveBeenCalled();
  s.stop();
});

test('stop clears all timers', async () => {
  const { s, emitted } = make(async () => [ev(1, 10)]);
  await s.start();
  s.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60 * MIN);
  expect(emitted).toEqual([]);
});
