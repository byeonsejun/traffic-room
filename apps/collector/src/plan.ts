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
/** 수집이 이보다 오래 멈췄다 돌아오면, 이보다 오래전에 시작된 건은 도착 연출 없이 넣는다. */
const STALE_GAP_MS = 2 * 60 * MIN;

const validDate = (d: Date | null): Date | null => (d !== null && !Number.isNaN(d.getTime()) ? d : null);

export function planIncidentChanges(input: PlanInput): IncidentPlan {
  const { activeKeys, fetched, collectedAt, delayMinutes } = input;
  if (validDate(collectedAt) === null) throw new RangeError('collectedAt 이 올바른 시각이 아닙니다');
  if (fetched.length === 0 && activeKeys.length > 0) throw new EmptyFetchError();
  const prevCollectedAt = validDate(input.prevCollectedAt);

  const delayMs = delayMinutes * MIN;
  const collectedMs = collectedAt.getTime();
  // 이 시각 이전(포함)에 시작된 새 건은 조용히 넣는다. 보통은 이전 수집 직전까지,
  // 수집이 2시간 넘게 멈췄다면 지금부터 2시간 전까지로 좁힌다.
  const quietUntil =
    prevCollectedAt === null
      ? null
      : collectedMs - prevCollectedAt.getTime() > STALE_GAP_MS
        ? collectedMs - STALE_GAP_MS - 1
        : prevCollectedAt.getTime() - SCHEDULE_SLACK_MS;
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
    if (quietUntil === null) {
      plan.quiet.push(incident);
      continue;
    }
    // 읽을 수 없거나 수집 시각보다 뒤인 시작 시각은 모르는 것으로 본다.
    const parsed = incident.startedAt === null ? NaN : Date.parse(incident.startedAt);
    const startedMs = Number.isNaN(parsed) || parsed > collectedMs ? null : parsed;
    if (startedMs !== null && startedMs <= quietUntil) {
      plan.quiet.push(incident);
      continue;
    }
    // 송출 시각은 늘 [수집 시각, 수집 시각 + 지연] 안에 둔다. 먼 미래 시각 하나가 로그의
    // 단조 증가 보정(repo)을 타고 뒤따르는 모든 이벤트를 붙잡아 두지 않게 한다.
    const base = (startedMs ?? collectedMs) + delayMs;
    const emitMs = Math.min(collectedMs + delayMs, Math.max(collectedMs, base));
    plan.arriving.push({ incident, emitAt: new Date(emitMs) });
  }

  for (const key of activeKeys) {
    if (!present.has(key)) plan.cleared.push({ key, emitAt: new Date(collectedMs + delayMs) });
  }
  return plan;
}
