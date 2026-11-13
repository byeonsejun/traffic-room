import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Cctv, Incident } from '@traffic-room/shared';
import { useConsole } from '@/store/console';

type Inst = { handlers: Record<string, (...a: unknown[]) => void>; loaded: string[]; destroyed: boolean };
const hlsState = vi.hoisted(() => ({ instances: [] as Inst[] }));
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported() { return true; }
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    inst: Inst = { handlers: {}, loaded: [], destroyed: false };
    constructor() { hlsState.instances.push(this.inst); }
    on(ev: string, fn: (...a: unknown[]) => void) { this.inst.handlers[ev] = fn; }
    loadSource(u: string) { this.inst.loaded.push(u); }
    attachMedia() {}
    destroy() { this.inst.destroyed = true; this.inst.handlers = {}; }
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
const live = () => hlsState.instances.filter((i) => !i.destroyed).at(-1);
const fatal = () => live()!.handlers['hlsError']!('hlsError', { fatal: true, type: 'networkError' });
const ready = (n: number) =>
  waitFor(() => {
    expect(hlsState.instances).toHaveLength(n);
    expect(live()).toBe(hlsState.instances[n - 1]);
  });
const answer = (cctvId: string, url: string | null, reason: 'cached' | 'refreshed' | 'unavailable') =>
  act(() => {
    useConsole.getState().applyServerMessage(
      { id: 0, type: 'cctv.url', ts: new Date().toISOString(), payload: { cctvId, url, reason } } as never,
      new Date(),
    );
  });

beforeEach(() => {
  useConsole.setState(useConsole.getInitialState(), true);
  hlsState.instances = [];
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

test('on fatal error it asks once; a different fresh url is loaded without guidance', async () => {
  const send = vi.fn();
  render(<CctvPanel cctvs={cams} send={send} />);
  await ready(1);
  act(() => fatal());
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: 'cctv.request', cctvId: 'seocho', refresh: true });
  answer('seocho', 'https://x/fresh.m3u8', 'refreshed');
  await ready(2);
  expect(hlsState.instances[0]!.destroyed).toBe(true);
  expect(live()!.loaded).toEqual(['https://x/fresh.m3u8']);
  expect(screen.queryByText(GUIDE)).toBeNull();
  act(() => fatal());
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByText(GUIDE)).toBeTruthy();
});

test('refresh answered with the same url shows guidance', async () => {
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  await ready(1);
  act(() => fatal());
  expect(screen.queryByText(GUIDE)).toBeNull();
  answer('seocho', 'https://x/seocho.m3u8', 'cached');
  expect(screen.getByText(GUIDE)).toBeTruthy();
});

test('no answer within 10s shows guidance', async () => {
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  await ready(1);
  vi.useFakeTimers();
  act(() => fatal());
  act(() => { vi.advanceTimersByTime(9_999); });
  expect(screen.queryByText(GUIDE)).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  expect(screen.getByText(GUIDE)).toBeTruthy();
});

test('shows guidance when no url is available', () => {
  useConsole.setState({ cctvUrlOverride: { seocho: null } });
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  expect(screen.getByText(GUIDE)).toBeTruthy();
});

test('reports the CCTV it cannot play to the store, and clears it once another one plays', async () => {
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  await ready(1);
  expect(useConsole.getState().cctvUnavailable).toBeNull();
  act(() => fatal());
  answer('seocho', 'https://x/seocho.m3u8', 'cached');
  expect(useConsole.getState().cctvUnavailable).toBe('seocho');
  act(() => {
    useConsole.setState({ incidents: { k: inc } });
    useConsole.getState().select('k');
  });
  expect(useConsole.getState().cctvUnavailable).toBeNull();
});

test('a CCTV with no url is reported as unavailable', () => {
  useConsole.setState({ cctvUrlOverride: { seocho: null } });
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  expect(useConsole.getState().cctvUnavailable).toBe('seocho');
});

test('a fresh url for the same CCTV clears the unavailable report', async () => {
  render(<CctvPanel cctvs={cams} send={vi.fn()} />);
  await ready(1);
  act(() => fatal());
  answer('seocho', 'https://x/seocho.m3u8', 'cached');
  expect(useConsole.getState().cctvUnavailable).toBe('seocho');
  answer('seocho', 'https://x/seocho-new.m3u8', 'refreshed');
  expect(useConsole.getState().cctvUnavailable).toBeNull();
  await ready(2);
  expect(live()!.loaded).toEqual(['https://x/seocho-new.m3u8']);
});
