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
