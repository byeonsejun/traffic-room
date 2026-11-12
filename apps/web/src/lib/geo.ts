import type { Cctv } from '@traffic-room/shared';

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two [lon, lat] points (haversine). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestCctvs(point: [number, number], list: Cctv[], n: number): Cctv[] {
  return list
    .map((c) => ({ c, d: distanceKm(point, [c.lon, c.lat]) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, n)
    .map((x) => x.c);
}
