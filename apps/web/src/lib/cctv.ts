import type { Cctv, Incident } from '@traffic-room/shared';
import { nearestCctvs } from './geo';

/** 돌발을 고르지 않았을 때 트는 CCTV. */
export const DEFAULT_CCTV_NAME = '[경부선] 서초';
const NEAREST = 3;

/**
 * CCTV 패널에 띄울 후보와 지금 트는 CCTV. 패널과 지도 핀이 같은 답을 쓰도록 여기 한 곳에서만 정한다.
 * 돌발을 골랐으면 가까운 3곳(가까운 순), 아니면 기본 CCTV(없으면 첫 번째). 칩으로 고른 id 가 후보에 있으면 그것.
 */
export function pickCctvs(
  cctvs: Cctv[],
  incident: Pick<Incident, 'lon' | 'lat'> | undefined,
  cctvId: string | null,
): { candidates: Cctv[]; active: Cctv | undefined } {
  let candidates: Cctv[];
  if (incident) candidates = nearestCctvs([incident.lon, incident.lat], cctvs, NEAREST);
  else {
    const def = cctvs.find((c) => c.name === DEFAULT_CCTV_NAME) ?? cctvs[0];
    candidates = def ? [def] : [];
  }
  return { candidates, active: candidates.find((c) => c.id === cctvId) ?? candidates[0] };
}
