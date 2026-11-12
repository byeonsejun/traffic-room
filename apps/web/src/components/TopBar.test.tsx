import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TopBar } from './TopBar';

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-11-12 15:30 KST
  vi.setSystemTime(new Date('2026-11-12T06:30:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bar = (collectedAt: string | null | undefined) =>
  render(<TopBar status="open" live={true} collectedAt={collectedAt} />);

test('shows the last collection time in KST next to the delay note', () => {
  // 14:05 KST, 1시간 25분 전
  bar('2026-11-12T05:05:00Z');
  const el = screen.getByText('마지막 수집 14:05');
  expect(el.className).not.toContain('stale');
  expect(screen.getByText('약 1시간 지연')).toBeTruthy();
});

test('uses 24h clock at midnight', () => {
  vi.setSystemTime(new Date('2026-11-12T15:30:00Z'));
  bar('2026-11-12T15:00:00Z'); // 00:00 KST on the 13th
  expect(screen.getByText('마지막 수집 00:00')).toBeTruthy();
});

test('older than 3 hours is flagged as paused with the date', () => {
  // 11:29 KST, 4시간 1분 전
  bar('2026-11-12T02:29:00Z');
  const el = screen.getByText('마지막 수집 11월 12일 11:29 · 수집 일시 중지');
  expect(el.className).toContain('stale');
});

test('exactly 3 hours is still fresh', () => {
  bar('2026-11-12T03:30:00Z');
  const el = screen.getByText('마지막 수집 12:30');
  expect(el.className).not.toContain('stale');
});

test('no collection time yet renders nothing extra', () => {
  bar(null);
  expect(screen.queryByText(/마지막 수집/)).toBeNull();
});
