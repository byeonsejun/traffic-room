import { speedLevel, type TrafficSummary } from '@traffic-room/shared';
import type { HighwaysIndex } from '@traffic-room/highways';
import type { TrafficFetch } from '@traffic-room/its';

export type LinkSpeed = { linkId: string; speed: number };
export type RejectReason = 'result' | 'multi-time' | 'not-newer' | 'too-few' | 'bad-speed' | 'too-many-zero';

/** 도로 모양(hw)에 있는 본선 구간만 남긴다. */
export function pickHighways(fetch: TrafficFetch, hw: HighwaysIndex): { speeds: LinkSpeed[]; missing: number; unknown: number } {
  // 같은 구간 번호가 겹치면 마지막 값을 쓴다(link_speeds 기본키 충돌과 음수 missing 방지).
  const kept = new Map<string, number>();
  let unknown = 0;
  for (const it of fetch.items) {
    if (hw.get(it.linkId)) kept.set(it.linkId, it.speed);
    else if (it.roadName.includes('고속도로')) unknown++;
  }
  const speeds = [...kept].map(([linkId, speed]) => ({ linkId, speed }));
  return { speeds, missing: hw.size - speeds.length, unknown };
}

/** 저장해도 되는 응답인지 메모리에서 먼저 검증한다. */
export function validateTraffic(input: {
  fetch: TrafficFetch;
  speeds: LinkSpeed[];
  prev: { dataAt: Date; linkCount: number } | null;
  hwSize: number;
}): { ok: true; dataAt: Date } | { ok: false; reason: RejectReason } {
  const { fetch, speeds, prev, hwSize } = input;
  // resultCode 오류는 normalizeTraffic 이 던진다. 여기서는 쓸 수 있는 구간이 하나도 없는 응답을 막는다.
  if (fetch.items.length === 0 || speeds.length === 0) return { ok: false, reason: 'result' };
  if (fetch.dataAt.length !== 1) return { ok: false, reason: 'multi-time' };
  const dataAt = new Date(fetch.dataAt[0]!);
  if (Number.isNaN(dataAt.getTime())) return { ok: false, reason: 'multi-time' };
  if (prev && dataAt.getTime() <= prev.dataAt.getTime()) return { ok: false, reason: 'not-newer' };
  if (speeds.some((s) => s.speed < 0 || s.speed > 200)) return { ok: false, reason: 'bad-speed' };
  const zeros = speeds.filter((s) => s.speed === 0).length;
  if (zeros / speeds.length >= 0.05) return { ok: false, reason: 'too-many-zero' };
  // 직전이 없으면 실측상 본선의 약 42% 만 응답에 있어 30% 를 기준으로 쓴다.
  const min = prev ? prev.linkCount * 0.8 : hwSize * 0.3;
  if (speeds.length < min) return { ok: false, reason: 'too-few' };
  return { ok: true, dataAt };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 평균은 구간 길이 가중 평균, jamKm 는 정체 구간 길이 합(km). */
export function summarize(
  speeds: LinkSpeed[],
  hw: HighwaysIndex,
): { summary: TrafficSummary; routes: { route: string; avgSpeed: number }[] } {
  let ok = 0, slow = 0, jam = 0, jamM = 0, sum = 0, len = 0;
  const byRoute = new Map<string, { sum: number; len: number }>();
  for (const s of speeds) {
    const info = hw.get(s.linkId);
    if (!info) continue;
    const level = speedLevel(s.speed);
    if (level === 'ok') ok++;
    else if (level === 'slow') slow++;
    else { jam++; jamM += info.lengthM; }
    sum += s.speed * info.lengthM;
    len += info.lengthM;
    const r = byRoute.get(info.route) ?? { sum: 0, len: 0 };
    r.sum += s.speed * info.lengthM;
    r.len += info.lengthM;
    byRoute.set(info.route, r);
  }
  return {
    summary: { avgSpeed: len > 0 ? round1(sum / len) : 0, ok, slow, jam, jamKm: round1(jamM / 1000) },
    routes: [...byRoute].map(([route, r]) => ({ route, avgSpeed: round1(r.sum / r.len) })),
  };
}
