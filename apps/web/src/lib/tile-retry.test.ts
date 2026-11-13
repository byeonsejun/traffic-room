import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TILE_RETRY_COOLDOWN_MS, TILE_RETRY_DELAYS, retryFailedTiles } from './tile-retry.ts';

type Handler = (e: unknown) => void;
const fakeMap = () => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    on: vi.fn((ev: string, fn: Handler) => handlers.set(ev, fn)),
    off: vi.fn((ev: string) => handlers.delete(ev)),
    refreshTiles: vi.fn(),
  };
};
const tileError = (z: number, x: number, y: number, error: unknown = Object.assign(new Error('Failed to fetch'), { status: 0 })) => ({
  error, sourceId: 'openmaptiles', tile: { tileID: { canonical: { z, x, y } } },
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('a tile that failed to load is asked for again after a short wait', () => {
  const map = fakeMap();
  retryFailedTiles(map as never);
  map.handlers.get('error')!(tileError(10, 876, 400));
  expect(map.refreshTiles).not.toHaveBeenCalled();
  vi.advanceTimersByTime(TILE_RETRY_DELAYS[0]!);
  expect(map.refreshTiles).toHaveBeenCalledWith('openmaptiles', [{ z: 10, x: 876, y: 400 }]);
});

test('it backs off and gives up after the last delay, logging once', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const map = fakeMap();
  retryFailedTiles(map as never);
  for (let i = 0; i <= TILE_RETRY_DELAYS.length; i += 1) {
    map.handlers.get('error')!(tileError(10, 1, 2));
    vi.advanceTimersByTime(20_000);
  }
  expect(map.refreshTiles).toHaveBeenCalledTimes(TILE_RETRY_DELAYS.length);
  expect(log).toHaveBeenCalledTimes(1);
  expect(String(log.mock.calls[0]![0])).toContain('[map-tile]');
});

test('a tile that loads again gets a fresh set of retries next time', () => {
  const map = fakeMap();
  retryFailedTiles(map as never);
  map.handlers.get('error')!(tileError(10, 1, 2));
  vi.advanceTimersByTime(60_000);
  map.handlers.get('sourcedata')!({ sourceId: 'openmaptiles', tile: { tileID: { canonical: { z: 10, x: 1, y: 2 } } } });
  map.handlers.get('error')!(tileError(10, 1, 2));
  vi.advanceTimersByTime(TILE_RETRY_DELAYS[0]!);
  expect(map.refreshTiles).toHaveBeenCalledTimes(2);
});

test('aborted requests (map moved on) are not retried; other map errors are still logged', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const map = fakeMap();
  retryFailedTiles(map as never);
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  map.handlers.get('error')!(tileError(10, 1, 2, abort));
  map.handlers.get('error')!({ error: new TypeError('style broke') });
  vi.advanceTimersByTime(60_000);
  expect(map.refreshTiles).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledTimes(1);
  expect(String(log.mock.calls[0]![0])).toContain('[map]');
});

test('stop removes the listeners and cancels pending retries; a vanished source does not throw', () => {
  const map = fakeMap();
  const stop = retryFailedTiles(map as never);
  map.handlers.get('error')!(tileError(10, 1, 2));
  stop();
  vi.advanceTimersByTime(60_000);
  expect(map.refreshTiles).not.toHaveBeenCalled();
  expect(map.handlers.size).toBe(0);

  const map2 = fakeMap();
  map2.refreshTiles.mockImplementation(() => { throw new Error('There is no tile manager'); });
  retryFailedTiles(map2 as never);
  map2.handlers.get('error')!(tileError(10, 1, 2));
  expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
});

test('a tile that ran out of retries gets a fresh set after a cool-down', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const map = fakeMap();
  retryFailedTiles(map as never);
  for (let i = 0; i <= TILE_RETRY_DELAYS.length; i += 1) {
    map.handlers.get('error')!(tileError(10, 1, 2));
    vi.advanceTimersByTime(20_000);
  }
  const used = map.refreshTiles.mock.calls.length;
  vi.advanceTimersByTime(TILE_RETRY_COOLDOWN_MS);
  // 식힌 뒤 한 번 더 스스로 부탁한다(아무도 그 타일을 다시 찾지 않아도 빈칸이 영영 남지 않게).
  expect(map.refreshTiles.mock.calls.length).toBe(used + 1);
  map.handlers.get('error')!(tileError(10, 1, 2));
  vi.advanceTimersByTime(TILE_RETRY_DELAYS[0]!);
  expect(map.refreshTiles.mock.calls.length).toBe(used + 2);
});

test('several errors for the same tile while a retry is pending schedule only one retry', () => {
  const map = fakeMap();
  retryFailedTiles(map as never);
  map.handlers.get('error')!(tileError(12, 5, 6));
  map.handlers.get('error')!(tileError(12, 5, 6));
  vi.advanceTimersByTime(60_000);
  expect(map.refreshTiles).toHaveBeenCalledTimes(1);
});

test('non-tile map errors are logged in full (message and stack), as MapLibre would have', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const map = fakeMap();
  retryFailedTiles(map as never);
  const err = new Error('The map has no image with that id');
  map.handlers.get('error')!({ error: err });
  expect(log.mock.calls[0]).toContain(err);
});
