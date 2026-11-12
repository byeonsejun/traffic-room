import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ServerMessage } from '@traffic-room/shared';
import type { RealtimeClientOptions } from '@/lib/realtime-client';
import { useConsole, type Snapshot } from '@/store/console';
import { Console } from './Console';

// Console 은 모듈을 읽을 때 실시간 서버 주소를 정한다. import 보다 먼저 넣는다.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_REALTIME_URL = 'ws://rt.test/ws';
});

// 지도는 WebGL 이 필요해 jsdom 에서 띄우지 않는다.
vi.mock('./MapView', () => ({ MapView: () => null }));

const clients: Array<{ opts: RealtimeClientOptions; close: ReturnType<typeof vi.fn>; lastIdAtConnect: number }> = [];
vi.mock('@/lib/realtime-client', () => ({
  createRealtimeClient: (opts: RealtimeClientOptions) => {
    const c = { opts, close: vi.fn(), send: vi.fn(), lastIdAtConnect: opts.getLastId() };
    clients.push(c);
    return c;
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
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/api/cctvs') return ok([]);
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
  snapshots = [];
  useConsole.setState(useConsole.getInitialState(), true);
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
