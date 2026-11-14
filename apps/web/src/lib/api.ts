import type { Insights } from '@traffic-room/db';
import type { Incident } from '@traffic-room/shared';

/**
 * API 라우트와 그걸 받는 화면이 같이 보는 응답 모양. 한 곳에 둬서 라우트가 바뀌면 받는 쪽 타입 검사가 함께 깨지게 한다.
 * 화면 코드도 가져다 쓰므로 여기에는 타입만 둔다(라우트 전용 도구는 api-route.ts).
 */

/** `/api/snapshot`: 첫 화면을 채우는 진행 중 돌발과 이어 받을 이벤트 번호. */
export type Snapshot = {
  incidents: Incident[];
  latestId: number;
  collectedAt: string | null;
  delayMinutes: number;
};

/** `/api/traffic`. 아직 보여 줄 스냅샷이 없으면 id 만 null. */
export type TrafficResponse =
  | { id: number; dataAt: string; speeds: [string, number][] }
  | { id: null };

/** `/api/insights`. */
export type InsightsResponse = Insights & { delayMinutes: number; intervalMinutes: number };
