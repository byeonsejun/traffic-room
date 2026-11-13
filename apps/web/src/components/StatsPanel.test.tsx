import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Metrics } from '@traffic-room/shared';
import { useConsole } from '@/store/console';
import { useMetrics } from '@/store/metrics';
import { StatsPanel } from './StatsPanel';
import type { InsightsData, InsightsState } from './useInsights';

// jsdom 에는 canvas 가 없다. 차트는 받은 이름만 남긴다.
vi.mock('./charts/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div data-chart={ariaLabel} />,
}));

const hist = (buckets: InsightsData['buckets'], intervalMinutes = 60, status: InsightsState['status'] = 'ok'): InsightsState => ({
  status, data: { buckets, routes: [], incidentsByHour: [], intervalMinutes, delayMinutes: 60, loadedAt: 0 },
});

beforeEach(() => {
  vi.useFakeTimers();
  useConsole.setState(useConsole.getInitialState(), true);
  useMetrics.setState(useMetrics.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const count = () => document.querySelector('.count')!;

test('arrival bumps the count for 1.2 s', () => {
  render(<StatsPanel arrivalId={5} collectedAt={null} delayMinutes={60} insights={hist([])} />);
  expect(count().classList.contains('is-bump')).toBe(true);
  act(() => vi.advanceTimersByTime(1200));
  expect(count().classList.contains('is-bump')).toBe(false);
});

test('a cleared item right after an arrival does not leave the count red', () => {
  const { rerender } = render(<StatsPanel arrivalId={5} collectedAt={null} delayMinutes={60} insights={hist([])} />);
  act(() => vi.advanceTimersByTime(400));
  rerender(<StatsPanel arrivalId={undefined} collectedAt={null} delayMinutes={60} insights={hist([])} />);
  act(() => vi.advanceTimersByTime(1200));
  expect(count().classList.contains('is-bump')).toBe(false);
});

const bucket = (hour: number, avgSpeed: number) => ({
  dataAt: new Date(Date.UTC(2026, 10, 12, hour)).toISOString(),
  avgSpeed, ok: 50, slow: 20, jam: 5, jamKm: 4,
});
const day = Array.from({ length: 24 }, (_, h) => bucket(h, 80 + (h % 5)));
const metrics = (avgSpeed: number): Metrics => ({
  trafficSnapshotId: 3, trafficDataAt: '2026-11-13T02:00:00.000Z', nextTrafficAt: null,
  traffic: { avgSpeed, ok: 5610, slow: 2671, jam: 683, jamKm: 120 },
  incidents: { total: 0, byCategory: { accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
  delayMinutes: 60, intervalMinutes: 60,
});
const panel = (props: Partial<Parameters<typeof StatsPanel>[0]> = {}) =>
  render(<StatsPanel collectedAt={null} delayMinutes={60} insights={hist([])} {...props} />);
const charts = () => [...document.querySelectorAll('[data-chart]')].map((e) => e.getAttribute('data-chart'));
const speed = () => document.querySelector('.speed .hero')?.textContent;

test('with no traffic yet it says so instead of a number, and links to the analysis page', () => {
  const { getByText, getByRole } = panel();
  expect(getByText('교통 정보 준비 중')).toBeTruthy();
  expect(speed()).toBeUndefined();
  expect(charts()).toEqual([]);
  expect(getByRole('link', { name: /분석 보기/ }).getAttribute('href')).toBe('/insights');
});

test('the hero speed and level bar follow the SSE metrics', () => {
  act(() => useMetrics.getState().apply(metrics(84.4)));
  panel({ insights: hist(day) });
  expect(speed()).toBe('84km/h');
  expect(charts()).toEqual(['최근 24시간 고속도로 평균 속도 추이', '구간 상태별 구간 수']);
  expect(document.querySelector('.levels h2')?.textContent).toContain('8,964');
});

test('without metrics the latest bucket supplies the speed and levels', () => {
  panel({ insights: hist([bucket(0, 70), bucket(1, 91.6)]) });
  expect(speed()).toBe('92km/h');
  expect(charts()).toContain('구간 상태별 구간 수');
});

test('one hour of history shows the recording note instead of a trend', () => {
  const { getByText } = panel({ insights: hist([bucket(0, 70)]) });
  expect(getByText('기록 중 · 1/24시간')).toBeTruthy();
  expect(charts()).not.toContain('최근 24시간 고속도로 평균 속도 추이');
});

test('the note uses the configured delay', () => {
  panel({ delayMinutes: 20 });
  expect(document.querySelector('.about')?.textContent).toContain('약 20분 지연');
});

test('history at 15-minute intervals is counted in hours, not buckets', () => {
  const quarter = Array.from({ length: 12 }, (_, i) => ({ ...bucket(0, 80), dataAt: new Date(Date.UTC(2026, 10, 12, 0, i * 15)).toISOString() }));
  const { getByText } = panel({ insights: hist(quarter, 15) });
  expect(getByText('기록 중 · 3/24시간')).toBeTruthy();
});

test('while history is loading no recording note shows', () => {
  panel({ insights: hist([], 60, 'loading') });
  expect(document.querySelector('.recording')).toBeNull();
});

test('a failed history load says so instead of reading as zero hours', () => {
  const { getByText, queryByText } = panel({ insights: hist([], 60, 'error') });
  expect(getByText('기록을 불러오지 못했어요')).toBeTruthy();
  expect(queryByText(/기록 중/)).toBeNull();
});
