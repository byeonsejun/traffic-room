import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Metrics, ServerMessage } from '@traffic-room/shared';
import type { MetricsClientOptions } from '@/lib/metrics-client';
import type { RealtimeClientOptions } from '@/lib/realtime-client';
import type { Snapshot } from '@/lib/api';
import { useConsole } from '@/store/console';
import { useMetrics } from '@/store/metrics';
import { delayLabel } from '@traffic-room/shared';
import { Console } from './Console';

// Console 은 모듈을 읽을 때 실시간 서버 주소를 정한다. import 보다 먼저 넣는다.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_REALTIME_URL = 'ws://rt.test/ws';
});

// 지도는 WebGL 이 필요해 jsdom 에서 띄우지 않는다. 받은 교통 값만 기록한다.
const mapProps: Array<{ speeds: Map<string, number> | null; trafficDataAt: string | null; trafficError: boolean }> = [];
// jsdom 에는 canvas 가 없다. 차트는 그리지 않는다.
vi.mock('./charts/EChart', () => ({ EChart: () => null }));
vi.mock('./MapView', () => ({
  MapView: (p: (typeof mapProps)[number]) => {
    mapProps.push(p);
    return null;
  },
}));

const clients: Array<{ opts: RealtimeClientOptions; close: ReturnType<typeof vi.fn>; lastIdAtConnect: number }> = [];
vi.mock('@/lib/realtime-client', () => ({
  createRealtimeClient: (opts: RealtimeClientOptions) => {
    const c = { opts, close: vi.fn(), send: vi.fn(), lastIdAtConnect: opts.getLastId() };
    clients.push(c);
    return c;
  },
}));

const streams: Array<{ opts: MetricsClientOptions; close: ReturnType<typeof vi.fn> }> = [];
vi.mock('@/lib/metrics-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics-client')>()),
  createMetricsClient: (opts: MetricsClientOptions) => {
    const s = { opts, close: vi.fn() };
    streams.push(s);
    return s;
  },
}));

const snap = (latestId: number, keys: string[] = []): Snapshot => ({
  latestId,
  collectedAt: null,
  delayMinutes: 60,
  incidents: keys.map((key) => ({
    key, category: 'accident', roadName: '경부선', direction: '서울', detail: '', message: '',
    lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
  })),
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = () => new Response(JSON.stringify({ message: '상황 정보를 불러오지 못했어요.' }), { status: 503 });
const hello = (latestId: number): ServerMessage => ({
  id: 0, type: 'hello', ts: new Date().toISOString(), payload: { delayMinutes: 60, latestId },
});

let snapshots: Array<() => Response>;
let traffic: () => Response;
let insights: () => Response;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/api/cctvs') return ok([]);
  if (path.startsWith('/api/traffic')) return traffic();
  if (path.startsWith('/api/insights')) return insights();
  const next = snapshots.shift();
  if (!next) throw new Error('unexpected snapshot fetch');
  return next();
});

async function mount() {
  const view = render(<Console />);
  await flush();
  return view;
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  clients.length = 0;
  streams.length = 0;
  mapProps.length = 0;
  snapshots = [];
  traffic = () => ok({ id: null });
  insights = () => ok({ buckets: [], routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 60 });
  useConsole.setState(useConsole.getInitialState(), true);
  useMetrics.setState(useMetrics.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('connects only after the snapshot is applied, resuming from its latest id', async () => {
  snapshots = [() => ok(snap(12, ['a']))];
  await mount();
  expect(clients).toHaveLength(1);
  expect(clients[0]!.lastIdAtConnect).toBe(12);
  expect(Object.keys(useConsole.getState().incidents)).toEqual(['a']);
});

test('a failed snapshot is retried before connecting instead of resuming from 0', async () => {
  snapshots = [fail, () => ok(snap(30))];
  await mount();
  expect(clients).toHaveLength(0);
  expect(document.querySelector('.notices')?.textContent).toContain('불러오지 못했어요');
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(clients).toHaveLength(1);
  expect(clients[0]!.lastIdAtConnect).toBe(30);
  expect(document.querySelector('.notices')).toBeNull();
});

test('a hello far ahead of lastId reloads the snapshot and reconnects from it', async () => {
  snapshots = [() => ok(snap(10, ['a'])), () => ok(snap(500, ['b']))];
  await mount();
  act(() => clients[0]!.opts.onMessage(hello(400)));
  expect(clients[0]!.close).toHaveBeenCalled();
  await flush();
  expect(clients).toHaveLength(2);
  expect(clients[1]!.lastIdAtConnect).toBe(500);
  expect(Object.keys(useConsole.getState().incidents)).toEqual(['b']);
});

test('a hello behind lastId resets to the snapshot even though it is lower', async () => {
  snapshots = [() => ok(snap(90, ['a'])), () => ok(snap(5, ['c']))];
  await mount();
  act(() => clients[0]!.opts.onMessage(hello(5)));
  await flush();
  expect(clients).toHaveLength(2);
  expect(useConsole.getState().lastId).toBe(5);
  expect(clients[1]!.lastIdAtConnect).toBe(5);
});

test('a hello within reach keeps the connection', async () => {
  snapshots = [() => ok(snap(10))];
  await mount();
  act(() => clients[0]!.opts.onMessage(hello(210)));
  await flush();
  expect(clients).toHaveLength(1);
  expect(clients[0]!.close).not.toHaveBeenCalled();
});

test('unmount closes the realtime client and stops snapshot retries', async () => {
  snapshots = [() => ok(snap(1))];
  const view = await mount();
  view.unmount();
  expect(clients[0]!.close).toHaveBeenCalled();

  clients.length = 0;
  snapshots = [fail];
  const again = await mount();
  again.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(clients).toHaveLength(0);
  expect(fetchMock.mock.calls.filter(([p]) => p === '/api/snapshot')).toHaveLength(2);
});

test('a fresh construction arrival does not bump the count, an accident does', async () => {
  snapshots = [() => ok(snap(0))];
  await mount();
  const arrive = (id: number, category: 'construction' | 'accident') =>
    act(() => useConsole.getState().applyServerMessage({
      id, type: 'incident.arrived', ts: new Date().toISOString(),
      payload: { incident: { ...snap(0, [`k${id}`]).incidents[0]!, category } },
    }, new Date()));
  arrive(1, 'construction');
  expect(document.querySelector('.count')!.classList.contains('is-bump')).toBe(false);
  arrive(2, 'accident');
  expect(document.querySelector('.count')!.classList.contains('is-bump')).toBe(true);
});

test('traffic speeds are fetched once and handed to the map', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok({ id: 7, dataAt: '2026-11-13T02:00:00.000Z', speeds: [['A', 75], ['B', 12]] });
  await mount();
  expect(fetchMock.mock.calls.filter(([p]) => p === '/api/traffic')).toHaveLength(1);
  const last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 75], ['B', 12]]));
  expect(last.trafficDataAt).toBe('2026-11-13T02:00:00.000Z');
  expect(last.trafficError).toBe(false);
});

test('a failed traffic fetch leaves only base lines and flags the error', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = fail;
  await mount();
  const last = mapProps.at(-1)!;
  expect(last.speeds).toBeNull();
  expect(last.trafficDataAt).toBeNull();
  expect(last.trafficError).toBe(true);
});

test('with no traffic snapshot yet the map gets no speeds and no error', async () => {
  snapshots.push(() => ok(snap(1)));
  await mount();
  const last = mapProps.at(-1)!;
  expect(last.speeds).toBeNull();
  expect(last.trafficError).toBe(false);
});

const trafficCalls = () => fetchMock.mock.calls.filter(([p]) => String(p).startsWith('/api/traffic'));
const trafficBody = (id: number, speeds: [string, number][], dataAt = '2026-11-13T02:00:00.000Z') =>
  ({ id, dataAt, speeds });
const metrics = (trafficSnapshotId: number | null, dataAt: string | null = '2026-11-13T02:00:00.000Z'): Metrics => ({
  trafficSnapshotId,
  trafficDataAt: dataAt,
  nextTrafficAt: null,
  traffic: null,
  incidents: { total: 0, byCategory: { accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
  delayMinutes: 60,
  intervalMinutes: 60,
  collectedAt: null,
});
const push = async (m: Metrics) => {
  act(() => streams[0]!.opts.onMetrics(m));
  await flush();
};

test('the metrics stream opens on the SSE address next to the realtime server', async () => {
  snapshots.push(() => ok(snap(1)));
  const view = await mount();
  expect(streams.map((s) => s.opts.url)).toEqual(['http://rt.test/sse/metrics']);
  view.unmount();
  expect(streams[0]!.close).toHaveBeenCalled();
});

test('the same traffic snapshot id does not refetch speeds', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok(trafficBody(1, [['A', 75]]));
  await mount();
  await push(metrics(1));
  await push(metrics(1));
  expect(trafficCalls()).toHaveLength(1);
  expect(useMetrics.getState().metrics?.trafficSnapshotId).toBe(1);
});

test('a new traffic snapshot id refetches speeds and hands them to the map', async () => {
  snapshots.push(() => ok(snap(1)));
  const bodies = [trafficBody(1, [['A', 75]]), trafficBody(2, [['A', 30]], '2026-11-13T03:00:00.000Z')];
  traffic = () => ok(bodies.shift());
  await mount();
  await push(metrics(1));
  await push(metrics(2, '2026-11-13T03:00:00.000Z'));
  expect(trafficCalls()).toHaveLength(2);
  const last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 30]]));
  expect(last.trafficDataAt).toBe('2026-11-13T03:00:00.000Z');
  // 같은 id 가 다시 와도 또 받지 않는다.
  await push(metrics(2, '2026-11-13T03:00:00.000Z'));
  expect(trafficCalls()).toHaveLength(2);
});

test('metrics arriving while the first fetch is in flight do not double it', async () => {
  snapshots.push(() => ok(snap(1)));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const body = trafficBody(4, [['A', 75]]);
  traffic = () => new Response(new ReadableStream({
    async start(c) {
      await gate;
      c.enqueue(new TextEncoder().encode(JSON.stringify(body)));
      c.close();
    },
  }), { status: 200 });
  render(<Console />);
  act(() => streams[0]!.opts.onMetrics(metrics(4)));
  release();
  await flush();
  await flush();
  expect(trafficCalls()).toHaveLength(1);
  expect(mapProps.at(-1)!.speeds).toEqual(new Map([['A', 75]]));
});

test('when the SSE drops the map keeps the last speeds', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok(trafficBody(1, [['A', 75]]));
  await mount();
  await push(metrics(1));
  act(() => streams[0]!.opts.onStatus('retry'));
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  const last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 75]]));
  expect(last.trafficError).toBe(false);
});

test('a failed refetch keeps the old speeds without flagging an error, then retries', async () => {
  snapshots.push(() => ok(snap(1)));
  const replies = [() => ok(trafficBody(1, [['A', 75]])), fail, () => ok(trafficBody(2, [['A', 30]]))];
  traffic = () => replies.shift()!();
  await mount();
  await push(metrics(2));
  expect(trafficCalls()).toHaveLength(2);
  let last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 75]]));
  expect(last.trafficError).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(trafficCalls()).toHaveLength(3);
  last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 30]]));
});

test('a refetch that still returns the old snapshot (cache) is retried a few times, then given up', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok(trafficBody(1, [['A', 75]]));
  await mount();
  await push(metrics(2));
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  // 처음 1회 + 새 id 로 3번까지
  expect(trafficCalls()).toHaveLength(4);
  expect(mapProps.at(-1)!.speeds).toEqual(new Map([['A', 75]]));
});

test('a 503 from /api/traffic leaves base lines with the legend notice, incidents still flow', async () => {
  snapshots.push(() => ok(snap(1, ['a'])));
  traffic = fail;
  await mount();
  const last = mapProps.at(-1)!;
  expect(last.speeds).toBeNull();
  expect(last.trafficError).toBe(true);
  // 돌발 피드는 교통과 따로 계속 들어온다.
  act(() => useConsole.getState().applyServerMessage({
    id: 2, type: 'incident.arrived', ts: new Date().toISOString(),
    payload: { incident: { ...snap(0, ['k2']).incidents[0]! } },
  }, new Date()));
  expect(Object.keys(useConsole.getState().incidents).sort()).toEqual(['a', 'k2']);
  expect(document.querySelector('.feed')?.textContent).toContain('경부선');
});

test('a never-loaded traffic recovers when a metrics event names a snapshot', async () => {
  snapshots.push(() => ok(snap(1)));
  const replies = [fail, () => ok(trafficBody(5, [['A', 75]]))];
  traffic = () => replies.shift()!();
  await mount();
  expect(mapProps.at(-1)!.trafficError).toBe(true);
  await push(metrics(5));
  const last = mapProps.at(-1)!;
  expect(last.speeds).toEqual(new Map([['A', 75]]));
  expect(last.trafficError).toBe(false);
});

test('the top bar shows the time of the speeds on screen and goes stale', async () => {
  vi.setSystemTime(new Date('2026-11-13T06:00:00.000Z'));
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok(trafficBody(1, [['A', 75]], '2026-11-13T02:59:00.000Z')); // 3시간 1분 전
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(document.querySelector('.top .traffic-at.stale')?.textContent).toContain('교통 11:59 기준');
});

test('an older snapshot in a response never replaces newer speeds on screen', async () => {
  snapshots.push(() => ok(snap(1)));
  // 화면에는 3, 지표가 4 를 가리키는데 응답은 (늦은 캐시로) 2 가 온다.
  const replies = [() => ok(trafficBody(3, [['A', 75]])), () => ok(trafficBody(2, [['A', 10]]))];
  traffic = () => (replies.shift() ?? (() => ok(trafficBody(2, [['A', 10]]))))();
  await mount();
  await push(metrics(4));
  expect(trafficCalls().length).toBeGreaterThanOrEqual(2);
  expect(mapProps.at(-1)!.speeds).toEqual(new Map([['A', 75]]));
});

test('metrics naming an older snapshot than the one shown do not refetch', async () => {
  snapshots.push(() => ok(snap(1)));
  traffic = () => ok(trafficBody(3, [['A', 75]]));
  await mount();
  await push(metrics(2));
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(trafficCalls()).toHaveLength(1);
  expect(mapProps.at(-1)!.speeds).toEqual(new Map([['A', 75]]));
});

const metricsFor = (trafficSnapshotId: number): Metrics => ({
  trafficSnapshotId, trafficDataAt: '2026-11-13T02:00:00.000Z', nextTrafficAt: null, traffic: null,
  incidents: { total: 0, byCategory: { accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
  delayMinutes: 60, intervalMinutes: 60, collectedAt: null,
});

test('24-hour insights load on mount and again when the traffic snapshot changes', async () => {
  snapshots.push(() => ok(snap(1)));
  insights = () => ok({
    buckets: [{ dataAt: '2026-11-13T01:00:00.000Z', avgSpeed: 77.6, ok: 9, slow: 2, jam: 1, jamKm: 1 }],
    routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 60, collectedAt: null,
  });
  await mount();
  const insightCalls = () => fetchMock.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/api/insights'));
  expect(insightCalls()).toEqual(['/api/insights']);
  // SSE 지표가 아직 없으면 마지막 요약 기록이 평균 속도를 채운다.
  expect(document.querySelector('.speed .hero')?.textContent).toBe('78km/h');

  act(() => useMetrics.getState().apply(metricsFor(8)));
  await flush();
  // 같은 스냅샷을 가리키는 지표가 다시 와도 다시 받지 않는다.
  act(() => useMetrics.getState().apply({ ...metricsFor(8), nextTrafficAt: '2026-11-13T04:00:00.000Z' }));
  await flush();
  expect(insightCalls()).toEqual(['/api/insights', '/api/insights?id=8']);
});

test('a failed insights refetch keeps the last history', async () => {
  snapshots.push(() => ok(snap(1)));
  insights = () => ok({
    buckets: [{ dataAt: '2026-11-13T01:00:00.000Z', avgSpeed: 80, ok: 9, slow: 2, jam: 1, jamKm: 1 }],
    routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 60, collectedAt: null,
  });
  await mount();
  insights = fail;
  act(() => useMetrics.getState().apply(metricsFor(9)));
  await flush();
  expect(document.querySelector('.speed .hero')?.textContent).toBe('80km/h');
});

test('the top bar follows collectedAt from SSE metrics and never goes back to an older one', async () => {
  vi.setSystemTime(new Date('2026-11-13T17:30:00+09:00'));
  snapshots.push(() => ok({ ...snap(1), collectedAt: '2026-11-13T17:05:00+09:00' }));
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  const label = () => document.querySelector('.collected')?.textContent ?? '';
  expect(label()).toContain('17:05');
  await push({ ...metrics(1), collectedAt: '2026-11-13T17:20:00+09:00' });
  expect(label()).toBe('마지막 수집 17:20');
  await push({ ...metrics(1), collectedAt: '2026-11-13T17:00:00+09:00' });
  expect(label()).toBe('마지막 수집 17:05');
});

const calls = (prefix: string) => fetchMock.mock.calls.filter(([p]) => String(p).startsWith(prefix)).length;
const advance = (min: number) => act(async () => { await vi.advanceTimersByTimeAsync(min * 60_000); });
const cctv = (id: string, url: string) => ({ id, name: id, url, lon: 127, lat: 37 });

test('the delay label follows the delay in SSE metrics over the snapshot value', async () => {
  snapshots.push(() => ok(snap(1)));
  await mount();
  expect(document.querySelector('.delay')?.textContent).toBe(delayLabel(60));
  await push({ ...metrics(1), delayMinutes: 30 });
  expect(document.querySelector('.delay')?.textContent).toBe(delayLabel(30));
});

test('the CCTV list is refetched every 60 minutes, and a failure keeps the old list', async () => {
  snapshots.push(() => ok(snap(1)));
  let list = () => ok([cctv('a', 'http://x/1')]);
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => (String(input) === '/api/cctvs' ? list() : base(input)));
  await mount();
  expect(calls('/api/cctvs')).toBe(1);
  await advance(59);
  expect(calls('/api/cctvs')).toBe(1);
  await advance(2);
  expect(calls('/api/cctvs')).toBe(2);
  list = fail;
  await advance(60);
  expect(calls('/api/cctvs')).toBe(3);
  expect(document.querySelector('.notices')).toBeNull();
  fetchMock.mockImplementation(base);
});

test('a tab hidden for over an hour refetches the CCTV list when it becomes visible', async () => {
  snapshots.push(() => ok(snap(1)));
  await mount();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(61);
  expect(calls('/api/cctvs')).toBe(1);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(calls('/api/cctvs')).toBe(2);
  hidden.mockRestore();
});

test('with no SSE metrics for interval + 5 minutes, traffic and insights are refetched every interval until SSE returns', async () => {
  snapshots.push(() => ok(snap(1)));
  insights = () => ok({ buckets: [], routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 15 });
  await mount();
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([1, 1]);
  await advance(19);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([1, 1]);
  await advance(1);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([2, 2]);
  await advance(15);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([3, 3]);
  await push({ ...metrics(null), intervalMinutes: 15 });
  await advance(19);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([3, 3]);
  await push({ ...metrics(null), intervalMinutes: 15 });
  await advance(19);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([3, 3]);
  // 지표가 다시 조용해지면(간격 + 5분) 대비 갱신이 다시 시작되고, 그 뒤에는 간격마다 한 번씩이다.
  await advance(1);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([4, 4]);
  await advance(15);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([5, 5]);
});

test('the fallback skips ticks while the tab is hidden and catches up once when it is visible again', async () => {
  snapshots.push(() => ok(snap(1)));
  insights = () => ok({ buckets: [], routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 15 });
  await mount();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await advance(50);
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([1, 1]);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([2, 2]);
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect([calls('/api/traffic'), calls('/api/insights')]).toEqual([2, 2]);
  hidden.mockRestore();
});
