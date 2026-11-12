import type { Incident } from '@traffic-room/shared';
import type { IncidentPlan } from '@traffic-room/db';

/** ITS 가 빈 목록을 돌려줬는데 우리는 진행 중인 건을 갖고 있을 때. 전부 해제로 처리하면 안 된다. */
export class EmptyFetchError extends Error {
  constructor() {
    super('ITS 응답이 비어 있어 상태를 바꾸지 않습니다');
    this.name = 'EmptyFetchError';
  }
}

export interface PlanInput {
  activeKeys: string[];
  fetched: Incident[];
  collectedAt: Date;
  prevCollectedAt: Date | null;
  delayMinutes: number;
}

const MIN = 60_000;
/** Actions 스케줄이 늦게 도는 경우를 봐주는 여유 */
const SCHEDULE_SLACK_MS = 5 * MIN;

export function planIncidentChanges(input: PlanInput): IncidentPlan {
  const { activeKeys, fetched, collectedAt, prevCollectedAt, delayMinutes } = input;
  if (fetched.length === 0 && activeKeys.length > 0) throw new EmptyFetchError();

  const delayMs = delayMinutes * MIN;
  const active = new Set(activeKeys);
  const plan: IncidentPlan = { quiet: [], arriving: [], seen: [], cleared: [] };
  const present = new Set<string>();

  for (const incident of fetched) {
    if (present.has(incident.key)) continue;
    present.add(incident.key);

    if (active.has(incident.key)) {
      plan.seen.push(incident.key);
      continue;
    }
    // 첫 실행이거나, 이전 수집 전에 이미 시작된 건은 조용히 현재 상태로만 넣는다.
    if (prevCollectedAt === null) {
      plan.quiet.push(incident);
      continue;
    }
    const startedMs = incident.startedAt === null ? null : Date.parse(incident.startedAt);
    if (startedMs !== null && startedMs <= prevCollectedAt.getTime() - SCHEDULE_SLACK_MS) {
      plan.quiet.push(incident);
      continue;
    }
    const base = (startedMs ?? collectedAt.getTime()) + delayMs;
    plan.arriving.push({ incident, emitAt: new Date(Math.max(base, collectedAt.getTime())) });
  }

  for (const key of activeKeys) {
    if (!present.has(key)) plan.cleared.push({ key, emitAt: new Date(collectedAt.getTime() + delayMs) });
  }
  return plan;
}
