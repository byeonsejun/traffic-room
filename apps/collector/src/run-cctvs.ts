import { canCall, recordRun, upsertCctvs } from '@traffic-room/db';
import type { Cctv } from '@traffic-room/shared';
import { errorCode } from '@traffic-room/shared';
import { depsFromEnv } from './env.ts';
import type { RunDeps } from './run-events.ts';

export interface CctvsResult { status: 'ok' | 'skipped-budget' | 'failed'; count: number; code?: string }

/** 고속도로(ex)와 국도(its)를 각 1회 호출한다. 호출마다 한 건씩 기록한다. */
export async function runCctvs({ db, its, now, timing }: RunDeps): Promise<CctvsResult> {
  const collected: Cctv[] = [];
  let failedCode: string | undefined;
  let skipped = false;

  for (const type of ['ex', 'its'] as const) {
    const at = now();
    if (!(await canCall(db, 'cctv', at, timing.monthlyLimit))) {
      skipped = true;
      break;
    }
    try {
      const list = await its.cctvs(type);
      collected.push(...list);
      await recordRun(db, 'cctv', true, list.length, at);
    } catch (e) {
      failedCode ??= errorCode(e);
      await recordRun(db, 'cctv', false, 0, at);
    }
  }

  // 한쪽이 실패해도 받아 온 것은 저장한다. 기존 행은 그대로 둔다.
  if (collected.length > 0) await upsertCctvs(db, collected);
  if (failedCode) return { status: 'failed', count: collected.length, code: failedCode };
  if (skipped) return { status: 'skipped-budget', count: collected.length };
  return { status: 'ok', count: collected.length };
}

if (import.meta.main) {
  let result;
  try {
    result = await runCctvs(depsFromEnv());
  } catch (e) {
    // DB 오류 문구에 접속 정보가 섞일 수 있어 code 만 남긴다.
    console.error('cctvs failed code=' + errorCode(e));
    process.exit(1);
  }
  console.log(`cctvs ${result.status} count=${result.count}` + (result.code ? ` code=${result.code}` : ''));
  if (result.status === 'failed') process.exit(1);
}
