import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Metrics } from '@traffic-room/shared';
import type { MetricsClientOptions } from '@/lib/metrics-client';
import { useMetrics } from '@/store/metrics';
import { Insights } from './Insights';

// 지표 스트림 주소는 모듈을 읽을 때 정해진다. import 보다 먼저 넣는다.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_REALTIME_URL = 'ws://rt.test/ws';
});
const streams: Array<{ opts: MetricsClientOptions; close: ReturnType<typeof vi.fn> }> = [];
vi.mock('@/lib/metrics-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics-client')>()),
  createMetricsClient: (opts: MetricsClientOptions) => {
    const s = { opts, close: vi.fn() };
    streams.push(s);
    return s;
  },
}));

// jsdom 에는 canvas 가 없다. 차트는 받은 이름만 남긴다.
vi.mock('../charts/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div data-chart={ariaLabel} />,
}));

const H = 3_600_000;
// 2026-11-13 12:30 KST
const NOW = Date.UTC(2026, 10, 13, 3, 30);
const hourAt = (h: number) => new Date(Date.UTC(2026, 10, 13, 2) - h * H).toISOString();
const buckets = (n: number, speed = (h: number) => 80 + (h % 4)) =>
  Array.from({ length: n }, (_, i) => ({ dataAt: hourAt(n - 1 - i), avgSpeed: speed(n - 1 - i), ok: 60, slow: 30, jam: 10, jamKm: 42 }));
const body = (n: number) => ({
  buckets: buckets(n),
  routes: [{ dataAt: hourAt(0), route: '경부고속도로', avgSpeed: 52 }],
  incidentsByHour: [],
  delayMinutes: 60,
  intervalMinutes: 60,
});
const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  trafficSnapshotId: 7, trafficDataAt: hourAt(0), nextTrafficAt: new Date(NOW + 18 * 60_000 + 30_000).toISOString(),
  traffic: { avgSpeed: 83.6, ok: 5610, slow: 2671, jam: 683, jamKm: 312.4 },
  incidents: { total: 41, byCategory: { accident: 5, breakdown: 23, weather: 0, construction: 9, report: 4, other: 0 } },
  delayMinutes: 60, intervalMinutes: 60,
  ...over,
});

let respond: (path: string) => Response;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => respond(String(input)));
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  streams.length = 0;
  respond = () => ok(body(9));
  useMetrics.setState(useMetrics.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = async () => {
  const view = render(<Insights />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return view;
};
const charts = () => [...document.querySelectorAll('[data-chart]')].map((e) => e.getAttribute('data-chart'));
const tile = (label: string) => screen.getByText(label).closest('.kpi-tile')!;

test('nine hours of history: recording band, charts drawn with what exists, no yesterday comparison', async () => {
  await mount();
  expect(screen.getByText('기록 중 · 9/24시간')).toBeTruthy();
  expect(document.body.textContent).not.toContain('어제 같은 시각');
  expect(charts()).toEqual([
    '최근 24시간 노선별 평균 속도', '지금 느린 노선', '최근 24시간 구간 상태 비율', '최근 24시간 시간대별 돌발 발생',
  ]);
  expect(screen.getByRole('link', { name: '분석' }).getAttribute('aria-current')).toBe('page');
});

test('a full day hides the band and compares with the same time yesterday', async () => {
  respond = () => ok({ ...body(25), buckets: buckets(25, (h) => (h === 24 ? 78 : 84)) });
  await mount();
  expect(screen.queryByText(/기록 중/)).toBeNull();
  expect(tile('고속도로 평균 속도').textContent).toContain('어제 같은 시각보다 +6 km/h');
});

test('before the first response nothing claims zero hours; a failure says so', async () => {
  respond = () => new Response('{}', { status: 503 });
  await mount();
  expect(screen.queryByText(/기록 중/)).toBeNull();
  expect(screen.getByText('기록을 불러오지 못했어요')).toBeTruthy();
});

test('tiles follow SSE metrics and the next update counts down every second', async () => {
  await mount();
  act(() => useMetrics.getState().apply(metrics()));
  expect(tile('고속도로 평균 속도').textContent).toContain('84');
  expect(tile('정체 구간 길이').textContent).toContain('312');
  expect(tile('진행 중 돌발').textContent).toContain('41');
  expect(tile('진행 중 돌발').textContent).toContain('사고 5 · 고장 23');
  expect(tile('다음 교통 갱신까지').textContent).toContain('18:30');
  act(() => vi.advanceTimersByTime(1000));
  expect(tile('다음 교통 갱신까지').textContent).toContain('18:29');
});

test('with no next update time the countdown shows a dash and why', async () => {
  await mount();
  expect(tile('다음 교통 갱신까지').textContent).toContain('—');
  expect(tile('다음 교통 갱신까지').textContent).toContain('실시간 지표를 기다리는 중');
  act(() => useMetrics.getState().apply(metrics({ nextTrafficAt: null })));
  expect(tile('다음 교통 갱신까지').textContent).toContain('—');
  expect(tile('다음 교통 갱신까지').textContent).toContain('다음 수집 시각이 아직 없어요');
});

test('a new traffic snapshot in the metrics refetches the 24-hour insights', async () => {
  await mount();
  act(() => useMetrics.getState().apply(metrics({ trafficSnapshotId: 8 })));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const calls = fetchMock.mock.calls.map(([p]) => String(p));
  expect(calls).toEqual(['/api/insights', '/api/insights?id=8']);
});

test('the page opens one metrics stream and closes it on unmount', async () => {
  const view = await mount();
  expect(streams.map((s) => s.opts.url)).toEqual(['http://rt.test/sse/metrics']);
  view.unmount();
  expect(streams[0]!.close).toHaveBeenCalled();
});

test('before SSE arrives the delay label comes from /api/insights', async () => {
  respond = () => ok({ ...body(9), delayMinutes: 20 });
  await mount();
  expect(document.querySelector('.top .delay')?.textContent).toBe('약 20분 지연');
  expect(document.querySelector('.ins-head p')?.textContent).toContain('약 20분 지연');
});

test('a failed first load retries with backoff (30 s, then 60 s) until it succeeds', async () => {
  let fail = true;
  respond = () => (fail ? new Response('{}', { status: 503 }) : ok(body(9)));
  await mount();
  const calls = () => fetchMock.mock.calls.length;
  expect(calls()).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
  expect(calls()).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(calls()).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
  expect(calls()).toBe(2);
  fail = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(calls()).toBe(3);
  expect(screen.getByText('기록 중 · 9/24시간')).toBeTruthy();
  // 성공한 뒤에는 더 다시 받지 않는다.
  await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
  expect(calls()).toBe(3);
});
