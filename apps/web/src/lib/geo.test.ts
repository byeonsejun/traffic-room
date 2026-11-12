import { expect, test } from 'vitest';
import type { Cctv } from '@traffic-room/shared';
import { distanceKm, nearestCctvs } from './geo.ts';

const cam = (id: string, lon: number, lat: number): Cctv => ({
  id, name: id, lon, lat, url: 'https://x/' + id, fetchedAt: '2026-11-12T00:00:00Z',
});

test('distanceKm is haversine (Seoul to Busan is about 325km)', () => {
  const d = distanceKm([126.978, 37.5665], [129.0756, 35.1796]);
  expect(d).toBeGreaterThan(320);
  expect(d).toBeLessThan(330);
  expect(distanceKm([127, 37], [127, 37])).toBe(0);
});

test('nearestCctvs picks the closest by great-circle distance', () => {
  const point: [number, number] = [127.171, 36.79];
  const list = [
    cam('far', 129.0, 35.1),
    cam('c', 127.2, 36.8),
    cam('a', 127.172, 36.791),
    cam('b', 127.18, 36.78),
    cam('d', 126.5, 37.5),
  ];
  expect(nearestCctvs(point, list, 3).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  expect(nearestCctvs(point, list, 10)).toHaveLength(5);
  expect(list[0]!.id).toBe('far');
});
