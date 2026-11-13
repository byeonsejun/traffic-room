import { beforeEach, expect, test } from 'vitest';
import type { Metrics } from '@traffic-room/shared';
import { isTrafficStale, useMetrics } from './metrics.ts';

const timing = { delayMinutes: 60, intervalMinutes: 60 };
const now = new Date('2026-11-13T06:00:00.000Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

test('traffic older than delay + 2 × interval is stale', () => {
  expect(isTrafficStale(minutesAgo(3 * 60 + 1), now, timing)).toBe(true);
  expect(isTrafficStale(minutesAgo(2 * 60 + 59), now, timing)).toBe(false);
});

test('the threshold follows the configured timing', () => {
  // 지연 20 · 간격 15 → 50분
  expect(isTrafficStale(minutesAgo(51), now, { delayMinutes: 20, intervalMinutes: 15 })).toBe(true);
  expect(isTrafficStale(minutesAgo(49), now, { delayMinutes: 20, intervalMinutes: 15 })).toBe(false);
});

const m = (trafficSnapshotId: number): Metrics => ({
  trafficSnapshotId,
  trafficDataAt: null,
  nextTrafficAt: null,
  traffic: null,
  incidents: { total: 0, byCategory: { accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
  delayMinutes: 60,
  intervalMinutes: 60,
  collectedAt: null,
});

beforeEach(() => useMetrics.setState(useMetrics.getInitialState(), true));

test('the store starts empty and keeps the latest metrics', () => {
  expect(useMetrics.getState().metrics).toBeNull();
  useMetrics.getState().apply(m(1));
  useMetrics.getState().apply(m(2));
  expect(useMetrics.getState().metrics?.trafficSnapshotId).toBe(2);
});
