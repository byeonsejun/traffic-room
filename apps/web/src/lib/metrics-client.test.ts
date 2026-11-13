import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import type { Metrics } from '@traffic-room/shared';
import { createMetricsClient, sseUrlFrom, type MetricsStatus } from './metrics-client.ts';

type Listener = (e: MessageEvent) => void;
class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  listeners = new Map<string, Listener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data }));
  }
}

const metrics: Metrics = {
  trafficSnapshotId: 3,
  trafficDataAt: '2026-11-13T02:00:00.000Z',
  nextTrafficAt: '2026-11-13T04:00:00.000Z',
  traffic: { avgSpeed: 81.2, ok: 900, slow: 80, jam: 20, jamKm: 14.5 },
  incidents: { total: 2, byCategory: { accident: 1, breakdown: 0, weather: 0, construction: 1, report: 0, other: 0 } },
  delayMinutes: 60,
  intervalMinutes: 60,
  collectedAt: null,
};

let onMetrics: Mock<(m: Metrics) => void>;
let onStatus: Mock<(s: MetricsStatus) => void>;
const open = () =>
  createMetricsClient({
    url: 'https://rt.test/sse/metrics',
    onMetrics,
    onStatus,
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
  });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  onMetrics = vi.fn();
  onStatus = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
});

test('a valid metrics event is handed over once', () => {
  open();
  FakeEventSource.all[0]!.emit('metrics', JSON.stringify(metrics));
  expect(onMetrics).toHaveBeenCalledTimes(1);
  expect(onMetrics).toHaveBeenCalledWith(metrics);
});

test('broken JSON or a wrong shape is ignored', () => {
  open();
  const es = FakeEventSource.all[0]!;
  es.emit('metrics', '{"trafficSnapshotId":');
  es.emit('metrics', JSON.stringify({ ...metrics, delayMinutes: 'soon' }));
  expect(onMetrics).not.toHaveBeenCalled();
});

test('open and errors are reported as status', () => {
  open();
  const es = FakeEventSource.all[0]!;
  es.onopen!();
  es.onerror!();
  expect(onStatus.mock.calls.map(([s]) => s)).toEqual(['open', 'retry']);
});

test('the browser reconnects by itself unless the stream is closed for good', () => {
  open();
  FakeEventSource.all[0]!.onerror!();
  vi.advanceTimersByTime(60_000);
  expect(FakeEventSource.all).toHaveLength(1);
});

test('a stream closed for good (502 while the server wakes) is reopened after a pause', () => {
  open();
  const first = FakeEventSource.all[0]!;
  first.readyState = FakeEventSource.CLOSED;
  first.onerror!();
  vi.advanceTimersByTime(4_999);
  expect(FakeEventSource.all).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(FakeEventSource.all).toHaveLength(2);
  FakeEventSource.all[1]!.emit('metrics', JSON.stringify(metrics));
  expect(onMetrics).toHaveBeenCalledTimes(1);
});

test('close stops the stream and any pending reopen', () => {
  const client = open();
  const first = FakeEventSource.all[0]!;
  first.readyState = FakeEventSource.CLOSED;
  first.onerror!();
  client.close();
  vi.advanceTimersByTime(120_000);
  expect(FakeEventSource.all).toHaveLength(1);
  expect(first.closed).toBe(true);
});

test('the SSE address comes from the realtime WebSocket address', () => {
  expect(sseUrlFrom('wss://rt.example.com/ws')).toBe('https://rt.example.com/sse/metrics');
  expect(sseUrlFrom('ws://localhost:8080/ws')).toBe('http://localhost:8080/sse/metrics');
  expect(sseUrlFrom(undefined)).toBeNull();
  expect(sseUrlFrom('')).toBeNull();
  expect(sseUrlFrom('not a url')).toBeNull();
});
