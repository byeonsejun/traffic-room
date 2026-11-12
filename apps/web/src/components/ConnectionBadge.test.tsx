import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionBadge } from './ConnectionBadge';

afterEach(cleanup);

test.each([
  ['connecting', '연결하는 중'],
  ['waking', '서버를 깨우는 중이에요. 최대 1분 걸려요'],
  ['open', '실시간 연결됨'],
] as const)('badge text for %s', (s, text) => {
  render(<ConnectionBadge status={s} />);
  expect(screen.getByRole('status').textContent).toBe(text);
});

test('retrying shows seconds until the next attempt', () => {
  render(<ConnectionBadge status="retrying" retryInMs={4000} />);
  expect(screen.getByRole('status').textContent).toBe('4초 뒤 다시 연결해요');
});

test('without a realtime server it says the screen shows the latest collection', () => {
  render(<ConnectionBadge status="connecting" live={false} />);
  expect(screen.getByRole('status').textContent).toBe('수집본으로 보는 중');
});
