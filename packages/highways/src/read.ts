import { readFileSync } from 'node:fs';
import type { HighwaysFile } from './types.ts';

export type HighwaysIndex = {
  size: number;
  get(linkId: string): { route: string; lengthM: number } | undefined;
};

// 수집기가 구간 번호로 노선 이름과 길이를 찾을 때 쓴다.
export function loadHighways(path: string): HighwaysIndex {
  const file = JSON.parse(readFileSync(path, 'utf8')) as HighwaysFile;
  const map = new Map<string, { route: string; lengthM: number }>();
  for (const [linkId, routeIndex, lengthM] of file.links) {
    map.set(linkId, { route: file.routes[routeIndex] as string, lengthM });
  }
  return { size: map.size, get: (linkId) => map.get(linkId) };
}
