import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRealtimeClient, type ConnStatus } from './realtime-client.ts';

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(d: string) {
    this.onmessage?.({ data: d });
  }
}

const last = () => FakeWS.instances[FakeWS.instances.length - 1]!;
const WS = FakeWS as unknown as typeof WebSocket;

function setup(getLastId = () => 41) {
  const statuses: Array<[ConnStatus, number | undefined]> = [];
  const messages: unknown[] = [];
  const client = createRealtimeClient({
    url: 'ws://x',
    getLastId,
    onMessage: (m) => messages.push(m),
    onStatus: (s, r) => statuses.push([s, r]),
    WebSocketImpl: WS,
    random: () => 1,
  });
  return { client, statuses, messages };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWS.instances = [];
});
afterEach(() => vi.useRealTimers());

test('sends resume with the last id on open', () => {
  const { statuses } = setup(() => 41);
  expect(statuses[0]).toEqual(['connecting', undefined]);
  last().open();
  expect(JSON.parse(last().sent[0]!)).toEqual({ type: 'resume', lastId: 41 });
  expect(statuses.at(-1)![0]).toBe('open');
});

test('reports waking after 5s without open', () => {
  const { statuses } = setup();
  vi.advanceTimersByTime(4999);
  expect(statuses.map((s) => s[0])).toEqual(['connecting']);
  vi.advanceTimersByTime(1);
  expect(statuses.at(-1)![0]).toBe('waking');
  last().open();
  expect(statuses.at(-1)![0]).toBe('open');
});

test('reconnects with capped exponential backoff', () => {
  const { statuses } = setup();
  const delays: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ws = last();
    ws.close();
    const s = statuses.at(-1)!;
    expect(s[0]).toBe('retrying');
    delays.push(s[1]!);
    vi.advanceTimersByTime(s[1]!);
    expect(last()).not.toBe(ws);
  }
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('resets backoff after a successful open', () => {
  const { statuses } = setup();
  last().close();
  vi.advanceTimersByTime(1000);
  last().open();
  last().close();
  expect(statuses.at(-1)).toEqual(['retrying', 1000]);
});

test('pings every 25s and reconnects if no pong within 10s', () => {
  const { statuses } = setup();
  const ws = last();
  ws.open();
  vi.advanceTimersByTime(25000);
  expect(ws.sent.map((s) => JSON.parse(s).type)).toEqual(['resume', 'ping']);
  ws.recv(JSON.stringify({ id: 0, type: 'pong', ts: new Date().toISOString(), payload: {} }));
  vi.advanceTimersByTime(10000);
  expect(statuses.at(-1)![0]).toBe('open');
  vi.advanceTimersByTime(15000); // second ping at 50s
  expect(ws.sent.filter((s) => JSON.parse(s).type === 'ping')).toHaveLength(2);
  vi.advanceTimersByTime(10000); // no pong
  expect(statuses.at(-1)![0]).toBe('retrying');
});

test('drops unparseable messages', () => {
  const { messages } = setup();
  last().open();
  last().recv('not json');
  last().recv(JSON.stringify({ nope: 1 }));
  expect(messages).toHaveLength(0);
  last().recv(JSON.stringify({ id: 0, type: 'pong', ts: new Date().toISOString(), payload: {} }));
  expect(messages).toHaveLength(1);
});

test('close stops reconnecting', () => {
  const { client } = setup();
  last().open();
  client.close();
  vi.advanceTimersByTime(120000);
  expect(FakeWS.instances).toHaveLength(1);
});
