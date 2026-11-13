import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Incident } from '@traffic-room/shared';
import { useConsole, type FeedItem } from '@/store/console';
import { Feed } from './Feed';

const inc = (key: string, over: Partial<Incident> = {}): Incident => ({
  key, category: 'breakdown', roadName: '경부선', direction: '종점', detail: '고장',
  message: '화물차 고장 처리중', lanesBlocked: '갓길', lon: 127.1, lat: 36.8,
  startedAt: '2026-11-12T13:29:00.000Z', ...over,
});
const item = (id: number, kind: FeedItem['kind'], incident: Incident, fresh = false): FeedItem => ({
  id, kind, incident, at: '2026-11-12T14:29:00.000Z', fresh,
});

beforeEach(() => useConsole.setState(useConsole.getInitialState(), true));
afterEach(cleanup);

test('clicking a feed card selects the incident', () => {
  const a = inc('a');
  useConsole.setState({ incidents: { a }, feed: [item(1, 'arrived', a, true)], cctvId: 'old-cam' });
  render(<Feed />);
  fireEvent.click(screen.getByRole('button', { name: /경부선 화물차 고장 처리중/ }));
  expect(useConsole.getState().selectedKey).toBe('a');
  expect(useConsole.getState().cctvId).toBeNull();
});

test('cleared items read as resolved', () => {
  const b = inc('b', { roadName: '영동선', message: '강풍 주의', category: 'weather' });
  useConsole.setState({ feed: [item(2, 'cleared', b)] });
  render(<Feed />);
  const card = screen.getByText(/영동선 강풍 주의/).closest('.ev')!;
  expect(card.textContent).toContain('해제');
  expect(card.classList.contains('is-cleared')).toBe(true);
});

test('only fresh cards get the arrival animation', () => {
  const a = inc('a');
  const c = inc('c', { roadName: '중앙선' });
  useConsole.setState({ incidents: { a, c }, feed: [item(3, 'arrived', a, true), item(1, 'arrived', c, false)] });
  render(<Feed />);
  const cards = document.querySelectorAll('.ev');
  expect(cards[0]!.classList.contains('is-new')).toBe(true);
  expect(cards[1]!.classList.contains('is-new')).toBe(false);
});

test('a fresh construction card comes in quietly', () => {
  const w = inc('w', { category: 'construction' });
  useConsole.setState({ incidents: { w }, feed: [item(4, 'arrived', w, true)] });
  render(<Feed />);
  expect(document.querySelector('.ev')!.classList.contains('is-new')).toBe(false);
});

// 실시간 이벤트가 하나 오면 첫 화면의 최근 상황 8건이 통째로 사라져 피드가 한 줄만 남던 문제.
const recentSet = () => {
  const out: Record<string, Incident> = {};
  for (let n = 0; n < 10; n++) {
    out[`r${n}`] = inc(`r${n}`, { roadName: `도로${n}`, startedAt: `2026-11-12T0${n}:00:00.000Z` });
  }
  return out;
};

test('without live items, shows the most recent ongoing incidents under one heading', () => {
  useConsole.setState({ incidents: recentSet() });
  render(<Feed />);
  expect(screen.getByRole('heading', { name: '최근 시작된 상황' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '그 전에 시작된 상황' })).toBeNull();
  expect(document.querySelectorAll('.ev')).toHaveLength(8);
});

test('a live arrival goes on top and the earlier incidents stay below it', () => {
  const incidents = recentSet();
  const a = inc('a', { roadName: '순천완주선', startedAt: '2026-11-12T12:00:00.000Z' });
  useConsole.setState({ incidents: { ...incidents, a }, feed: [item(1, 'arrived', a, true)] });
  render(<Feed />);
  expect(screen.getByRole('heading', { name: '방금 들어온 상황' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '그 전에 시작된 상황' })).toBeTruthy();
  const cards = [...document.querySelectorAll('.ev')];
  expect(cards).toHaveLength(8);
  expect(cards[0]!.textContent).toContain('순천완주선');
  // 위에 이미 있는 상황은 아래 목록에 다시 나오지 않는다.
  expect(cards.filter((c) => c.textContent!.includes('순천완주선'))).toHaveLength(1);
  expect(cards[1]!.textContent).toContain('도로9');
});

test('once live items fill the list, the earlier section goes away', () => {
  const incidents = recentSet();
  const feed = Object.values(incidents).slice(0, 8).map((i, n) => item(n + 1, 'arrived', i));
  useConsole.setState({ incidents, feed });
  render(<Feed />);
  expect(screen.queryByRole('heading', { name: '그 전에 시작된 상황' })).toBeNull();
  expect(document.querySelectorAll('.ev')).toHaveLength(8);
});
