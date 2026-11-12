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

test('does not emit events whose emitAt passed before start (they are resume-only)', async () => {
  const { s, emitted } = make(async () => [ev(1, -5), ev(2, 5)]);
  await s.start();
  await vi.advanceTimersByTimeAsync(10 * MIN);
  expect(emitted).toEqual([2]);
  s.stop();
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
