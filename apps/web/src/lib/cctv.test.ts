import { expect, test } from 'vitest';
import type { Cctv, Incident } from '@traffic-room/shared';
import { pickCctvs } from './cctv';

const cam = (id: string, name: string, lon: number, lat: number): Cctv => ({
  id, name, lon, lat, url: `https://x/${id}.m3u8`, fetchedAt: '2026-11-12T00:00:00Z',
});
const cams = [
  cam('first', '[국도] 첫번째', 128, 36),
  cam('seocho', '[경부선] 서초', 127.0, 37.48),
  cam('near3', '[경부선] 평택', 127.2, 36.8),
  cam('near1', '[경부선] 천안', 127.171, 36.791),
  cam('near2', '[경부선] 안성', 127.18, 36.78),
];
const inc = { lon: 127.171, lat: 36.79 } as Incident;

test('with an incident the three nearest come first and the nearest is active', () => {
  const { candidates, active } = pickCctvs(cams, inc, null);
  expect(candidates.map((c) => c.id)).toEqual(['near1', 'near2', 'near3']);
  expect(active?.id).toBe('near1');
});

test('a chip choice among the candidates wins over the nearest', () => {
  expect(pickCctvs(cams, inc, 'near3').active?.id).toBe('near3');
});

test('a stale choice that is not a candidate falls back to the nearest', () => {
  expect(pickCctvs(cams, inc, 'seocho').active?.id).toBe('near1');
});

test('without an incident the default camera plays, else the first one, else nothing', () => {
  expect(pickCctvs(cams, undefined, null).active?.id).toBe('seocho');
  expect(pickCctvs(cams.filter((c) => c.id !== 'seocho'), undefined, null).active?.id).toBe('first');
  expect(pickCctvs([], undefined, null)).toEqual({ candidates: [], active: undefined });
});
