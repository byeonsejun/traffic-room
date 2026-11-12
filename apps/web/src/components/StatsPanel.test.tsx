import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useConsole } from '@/store/console';
import { StatsPanel } from './StatsPanel';

beforeEach(() => {
  vi.useFakeTimers();
  useConsole.setState(useConsole.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const count = () => document.querySelector('.count')!;

test('arrival bumps the count for 1.2 s', () => {
  render(<StatsPanel arrivalId={5} collectedAt={null} />);
  expect(count().classList.contains('is-bump')).toBe(true);
  act(() => vi.advanceTimersByTime(1200));
  expect(count().classList.contains('is-bump')).toBe(false);
});

test('a cleared item right after an arrival does not leave the count red', () => {
  const { rerender } = render(<StatsPanel arrivalId={5} collectedAt={null} />);
  act(() => vi.advanceTimersByTime(400));
  rerender(<StatsPanel arrivalId={undefined} collectedAt={null} />);
  act(() => vi.advanceTimersByTime(1200));
  expect(count().classList.contains('is-bump')).toBe(false);
});
