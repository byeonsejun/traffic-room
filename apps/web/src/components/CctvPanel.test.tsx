import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Cctv, Incident } from '@traffic-room/shared';
import { useConsole } from '@/store/console';

const hlsState = vi.hoisted(() => ({ handlers: {} as Record<string, (...a: unknown[]) => void>, destroyed: 0 }));
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported() { return true; }
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    on(ev: string, fn: (...a: unknown[]) => void) { hlsState.handlers[ev] = fn; }
    loadSource() {}
    attachMedia() {}
    destroy() { hlsState.destroyed++; }
  }
  return { default: FakeHls };
});

import { CctvPanel } from './CctvPanel';

const cam = (id: string, name: string, lon: number, lat: number): Cctv => ({
  id, name, lon, lat, url: `https://x/${id}.m3u8`, fetchedAt: '2026-11-12T00:00:00Z',
});
const cams = [
  cam('first', '[국도] 첫번째', 128, 36),
  cam('seocho', '[경부선] 서초', 127.0, 37.48),
  cam('near1', '[경부선] 천안', 127.171, 36.791),
  cam('near2', '[경부선] 안성', 127.18, 36.78),
  cam('near3', '[경부선] 평택', 127.2, 36.8),
];
const inc: Incident = {
  key: 'k', category: 'breakdown', roadName: '경부선', direction: '상행', detail: '', message: '고장',
  lanesBlocked: '', lon: 127.171, lat: 36.79, startedAt: null,
};

const GUIDE = '이 CCTV 영상을 지금 불러올 수 없어요. 다른 CCTV를 골라 보세요.';
const fatal = () => hlsState.handlers['hlsError']!('hlsError', { fatal: true, type: 'networkError' });

beforeEach(() => {
  useConsole.setState(useConsole.getInitialState(), true);
  hlsState.handlers = {};
  hlsState.destroyed = 0;
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
});

test('plays the default camera when nothing is selected', async () => {
  const { container } = render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  expect(screen.getByText('[경부선] 서초')).toBeTruthy();
  expect(container.querySelector('video')).toBeTruthy();
  expect(screen.getByText('실시간')).toBeTruthy();
});

test('shows the 3 nearest cameras as chips for a selected incident and switching sets cctvId', () => {
  useConsole.setState({ incidents: { k: inc }, selectedKey: 'k' });
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  const chips = screen.getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'));
  expect(chips.map((c) => c.textContent)).toEqual(['천안', '안성', '평택']);
  expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(chips[1]!);
  expect(useConsole.getState().cctvId).toBe('near2');
});

test('fullscreen button falls back to an overlay when the API is missing, and Esc closes it', () => {
  Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
  const { container } = render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  const root = container.firstElementChild!;
  const btn = screen.getByRole('button', { name: '크게 보기' });
  fireEvent.click(btn);
  expect(root.classList.contains('is-overlay')).toBe(true);
  const back = screen.getByRole('button', { name: '작게 보기' });
  expect(document.activeElement === back || back === btn).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(root.classList.contains('is-overlay')).toBe(false);
  expect(screen.getByRole('button', { name: '크게 보기' })).toBeTruthy();
});

test('uses the Fullscreen API when available and syncs the label on fullscreenchange', () => {
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
  const { container } = render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  const root = container.firstElementChild as HTMLElement;
  const req = vi.fn().mockResolvedValue(undefined);
  root.requestFullscreen = req;
  fireEvent.click(screen.getByRole('button', { name: '크게 보기' }));
  expect(req).toHaveBeenCalled();
  Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true });
  act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
  expect(screen.getByRole('button', { name: '작게 보기' })).toBeTruthy();
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
  expect(screen.getByRole('button', { name: '크게 보기' })).toBeTruthy();
});

test('on fatal playback error it asks the server for a fresh url once', async () => {
  const send = vi.fn();
  render(<CctvPanel cctvs={cams} send={send} />);
  await waitFor(() => expect(hlsState.handlers['hlsError']).toBeTruthy());
  act(() => fatal());
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: 'cctv.request', cctvId: 'seocho', refresh: true });
  act(() => { useConsole.setState({ cctvUrlOverride: { seocho: 'https://x/fresh.m3u8' } }); });
  await waitFor(() => expect(hlsState.destroyed).toBeGreaterThan(0));
  await waitFor(() => expect(hlsState.handlers['hlsError']).toBeTruthy());
  act(() => fatal());
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByText(GUIDE)).toBeTruthy();
});

test('shows guidance when no url is available', () => {
  useConsole.setState({ cctvUrlOverride: { seocho: null } });
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  expect(screen.getByText(GUIDE)).toBeTruthy();
});
