import { DELAY_MINUTES } from '@traffic-room/shared';
import { applyIncidentPlan, canCall, getActiveKeys, lastCollectedAt, recordRun, type Db } from '@traffic-room/db';
import type { ItsClient } from '@traffic-room/its';
import { depsFromEnv, errorCode } from './env.ts';
import { planIncidentChanges } from './plan.ts';

export interface RunDeps { db: Db; its: ItsClient; now: () => Date }
export interface EventsResult { status: 'ok' | 'skipped-budget' | 'failed'; arrived: number; cleared: number; code?: string }

export async function runEvents({ db, its, now }: RunDeps): Promise<EventsResult> {
  const collectedAt = now();
  if (!(await canCall(db, 'events', collectedAt))) {
    return { status: 'skipped-budget', arrived: 0, cleared: 0 };
  }
  // 호출 전에 이전 성공 시각을 읽어 둔다(이번 실행 기록이 섞이지 않게).
  const prev = await lastCollectedAt(db, 'events');
  try {
    const fetched = await its.events();
    const activeKeys = await getActiveKeys(db);
    const plan = planIncidentChanges({ activeKeys, fetched, collectedAt, prevCollectedAt: prev, delayMinutes: DELAY_MINUTES });
    await applyIncidentPlan(db, plan, collectedAt);
    await recordRun(db, 'events', true, fetched.length, collectedAt);
    return { status: 'ok', arrived: plan.arriving.length, cleared: plan.cleared.length };
  } catch (e) {
    await recordRun(db, 'events', false, 0, collectedAt);
    return { status: 'failed', arrived: 0, cleared: 0, code: errorCode(e) };
  }
}

if (import.meta.main) {
  let result;
  try {
    result = await runEvents(depsFromEnv());
  } catch (e) {
    // DB 오류 문구에 접속 정보가 섞일 수 있어 code 만 남긴다.
    console.error('events failed code=' + errorCode(e));
    process.exit(1);
  }
  console.log(`events ${result.status} arrived=${result.arrived} cleared=${result.cleared}` + (result.code ? ` code=${result.code}` : ''));
  if (result.status === 'failed') process.exit(1);
}
