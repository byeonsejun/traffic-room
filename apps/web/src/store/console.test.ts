import { beforeEach, expect, test } from 'vitest';
import type { Incident, ServerMessage } from '@traffic-room/shared';
import { useConsole } from './console.ts';

const NOW = new Date('2026-11-12T10:00:00+09:00');
const inc = (key: string): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '상행', detail: '', message: '사고',
  lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
});
const arrived = (id: number, key: string, ts = NOW): ServerMessage => ({
  id, type: 'incident.arrived', ts: ts.toISOString(), payload: { incident: inc(key) },
} as ServerMessage);
const cleared = (id: number, key: string): ServerMessage => ({
  id, type: 'incident.cleared', ts: NOW.toISOString(), payload: { key },
} as ServerMessage);

beforeEach(() => {
  useConsole.setState(useConsole.getInitialState(), true);
});

test('applySnapshot fills incidents and lastId', () => {
  useConsole.getState().applySnapshot({
    incidents: [inc('a'), inc('b')], latestId: 12, collectedAt: null, delayMinutes: 60,
  });
  const s = useConsole.getState();
  expect(Object.keys(s.incidents).sort()).toEqual(['a', 'b']);
  expect(s.lastId).toBe(12);
  expect(s.feed).toEqual([]);
});

test('arrival adds incident, prepends feed (max 30) and advances lastId', () => {
  const { applyServerMessage } = useConsole.getState();
  for (let i = 1; i <= 32; i++) applyServerMessage(arrived(i, `k${i}`), NOW);
  const s = useConsole.getState();
  expect(s.lastId).toBe(32);
  expect(s.incidents['k32']).toBeDefined();
  expect(s.feed).toHaveLength(30);
  expect(s.feed[0]!.id).toBe(32);
  expect(s.feed[0]!.kind).toBe('arrived');
  expect(s.feed[0]!.incident.key).toBe('k32');
});

test('ignores duplicate and older ids', () => {
  const { applyServerMessage } = useConsole.getState();
  applyServerMessage(arrived(5, 'a'), NOW);
  const before = useConsole.getState();
  applyServerMessage(arrived(5, 'a'), NOW);
  applyServerMessage(arrived(4, 'b'), NOW);
  const s = useConsole.getState();
  expect(s.feed).toHaveLength(1);
  expect(s.incidents).toBe(before.incidents);
  expect(s.lastId).toBe(5);
});

test('marks stale arrivals as not fresh', () => {
  const { applyServerMessage } = useConsole.getState();
  applyServerMessage(arrived(1, 'old', new Date(NOW.getTime() - 180_000)), NOW);
  applyServerMessage(arrived(2, 'new', new Date(NOW.getTime() - 90_000)), NOW);
  const [newer, older] = useConsole.getState().feed;
  expect(older!.fresh).toBe(false);
  expect(newer!.fresh).toBe(true);
});

test('clear removes the incident and adds a cleared feed item', () => {
  const { applyServerMessage } = useConsole.getState();
  applyServerMessage(arrived(1, 'a'), NOW);
  applyServerMessage(cleared(2, 'a'), NOW);
  const s = useConsole.getState();
  expect(s.incidents['a']).toBeUndefined();
  expect(s.feed[0]).toMatchObject({ id: 2, kind: 'cleared', incident: { key: 'a' } });
  expect(s.lastId).toBe(2);
});

test('clear of an unknown incident only advances lastId', () => {
  useConsole.getState().applyServerMessage(cleared(3, 'ghost'), NOW);
  const s = useConsole.getState();
  expect(s.feed).toHaveLength(0);
  expect(s.lastId).toBe(3);
});

test('cctv.url updates the override map', () => {
  const { applyServerMessage } = useConsole.getState();
  const msg = (url: string | null, reason: 'refreshed' | 'unavailable') => ({
    id: 0, type: 'cctv.url', ts: NOW.toISOString(), payload: { cctvId: 'c1', url, reason },
  }) as ServerMessage;
  applyServerMessage(msg('https://x/a.m3u8', 'refreshed'), NOW);
  expect(useConsole.getState().cctvUrlOverride).toEqual({ c1: 'https://x/a.m3u8' });
  applyServerMessage(msg(null, 'unavailable'), NOW);
  expect(useConsole.getState().cctvUrlOverride).toEqual({ c1: null });
});

test('hello and pong never touch lastId', () => {
  const { applyServerMessage } = useConsole.getState();
  applyServerMessage({ id: 0, type: 'hello', ts: NOW.toISOString(), payload: { delayMinutes: 60, latestId: 9 } } as ServerMessage, NOW);
  applyServerMessage({ id: 0, type: 'pong', ts: NOW.toISOString(), payload: {} } as ServerMessage, NOW);
  expect(useConsole.getState().lastId).toBe(0);
});

test('setStatus, select and setCctv', () => {
  const s = useConsole.getState();
  s.setStatus('retrying', 2000);
  s.select('a');
  s.setCctv('c1');
  expect(useConsole.getState()).toMatchObject({ status: 'retrying', retryInMs: 2000, selectedKey: 'a', cctvId: 'c1' });
});
