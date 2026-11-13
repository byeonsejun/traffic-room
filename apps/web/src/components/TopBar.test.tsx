import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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

const bar = (collectedAt: string | null | undefined, delayMinutes = 60) =>
  render(<TopBar status="open" live={true} collectedAt={collectedAt} delayMinutes={delayMinutes} />);

test('shows the last collection time in KST next to the delay note', () => {
  // 14:05 KST, 1시간 25분 전
  bar('2026-11-12T05:05:00Z');
  const el = screen.getByText('마지막 수집 14:05');
  expect(el.className).not.toContain('stale');
  expect(screen.getByText('약 1시간 지연')).toBeTruthy();
});

test('shows the configured delay in minutes', () => {
  bar(null, 20);
  expect(screen.getByText('약 20분 지연')).toBeTruthy();
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

const timing = { delayMinutes: 60, intervalMinutes: 60 };
const withTraffic = (trafficDataAt: string | null) =>
  render(<TopBar status="open" live={true} delayMinutes={60} trafficDataAt={trafficDataAt} trafficTiming={timing} />);

test('shows the traffic time it is based on', () => {
  // 13:00 KST, 2시간 30분 전
  withTraffic('2026-11-12T04:00:00Z');
  act(() => { vi.advanceTimersByTime(1000); });
  const el = screen.getByText('교통 13:00 기준');
  expect(el.className).not.toContain('stale');
});

test('traffic older than delay + 2 × interval turns stale', () => {
  // 12:29 KST, 3시간 1분 전
  const { container } = withTraffic('2026-11-12T03:29:00Z');
  act(() => { vi.advanceTimersByTime(1000); });
  expect(container.querySelector('.traffic-at.stale')).not.toBeNull();
  expect(screen.getByText(/교통 12:29 기준/).textContent).toContain('갱신 늦음');
});

test('traffic turns stale as time passes without a new snapshot', () => {
  const { container } = withTraffic('2026-11-12T03:31:00Z'); // 2시간 59분 전
  act(() => { vi.advanceTimersByTime(1000); });
  expect(container.querySelector('.traffic-at.stale')).toBeNull();
  act(() => { vi.advanceTimersByTime(2 * 60_000); });
  expect(container.querySelector('.traffic-at.stale')).not.toBeNull();
});

test('no traffic time renders no traffic label', () => {
  withTraffic(null);
  expect(screen.queryByText(/교통 .* 기준/)).toBeNull();
});

test('관제 · 분석 tabs link both pages and mark the current one', () => {
  const { getByRole, rerender } = render(<TopBar status="open" live={true} delayMinutes={60} page="console" />);
  const nav = getByRole('navigation', { name: '화면' });
  expect(nav).toBeTruthy();
  expect(getByRole('link', { name: '관제' }).getAttribute('href')).toBe('/');
  expect(getByRole('link', { name: '관제' }).getAttribute('aria-current')).toBe('page');
  expect(getByRole('link', { name: '분석' }).getAttribute('href')).toBe('/insights');
  expect(getByRole('link', { name: '분석' }).getAttribute('aria-current')).toBeNull();

  rerender(<TopBar status="open" live={true} delayMinutes={60} page="insights" />);
  expect(getByRole('link', { name: '분석' }).getAttribute('aria-current')).toBe('page');
  expect(getByRole('link', { name: '관제' }).getAttribute('aria-current')).toBeNull();
});
