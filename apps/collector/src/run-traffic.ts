import { canCall, latestTrafficSnapshot, pruneTraffic, recordRun, saveTrafficSnapshot } from '@traffic-room/db';
import type { HighwaysIndex } from '@traffic-room/highways';
import { depsFromEnv, errorCode } from './env.ts';
import type { RunDeps } from './run-events.ts';
import { pickHighways, summarize, validateTraffic } from './traffic.ts';

export interface TrafficResult {
  status: 'ok' | 'same' | 'rejected' | 'skipped-budget' | 'failed';
  links?: number; missing?: number; unknown?: number; dataAt?: Date; reason?: string; code?: string;
}

/** 받은 응답은 메모리에서 검증하고, 통과한 것만 저장한다. 실패하면 DB 는 그대로다. */
export async function runTraffic({ db, its, now, timing, highways }: RunDeps & { highways: HighwaysIndex }): Promise<TrafficResult> {
  const collectedAt = now();
  if (!(await canCall(db, 'traffic', collectedAt, timing.monthlyLimit))) return { status: 'skipped-budget' };
  try {
    const prev = await latestTrafficSnapshot(db);
    const fetched = await its.traffic();
    const { speeds, missing, unknown } = pickHighways(fetched, highways);
    const v = validateTraffic({ fetch: fetched, speeds, prev, hwSize: highways.size });
    if (!v.ok) {
      if (v.reason === 'not-newer') {
        await recordRun(db, 'traffic', true, 0, collectedAt);
        return { status: 'same', links: speeds.length, missing, unknown, reason: v.reason };
      }
      await recordRun(db, 'traffic', false, 0, collectedAt);
      return { status: 'rejected', links: speeds.length, missing, unknown, reason: v.reason };
    }
    const { summary, routes } = summarize(speeds, highways);
    const showAt = new Date(v.dataAt.getTime() + timing.delayMinutes * 60_000);
    await saveTrafficSnapshot(db, { dataAt: v.dataAt, collectedAt, showAt, summary, routes, speeds });
    await pruneTraffic(db, collectedAt);
    await recordRun(db, 'traffic', true, speeds.length, collectedAt);
    return { status: 'ok', links: speeds.length, missing, unknown, dataAt: v.dataAt };
  } catch (e) {
    await recordRun(db, 'traffic', false, 0, collectedAt);
    return { status: 'failed', code: errorCode(e) };
  }
}

if (import.meta.main) {
  let result;
  try {
    result = await runTraffic(depsFromEnv());
  } catch (e) {
    // DB 오류 문구에 접속 정보가 섞일 수 있어 code 만 남긴다.
    console.error('traffic failed code=' + errorCode(e));
    process.exit(1);
  }
  console.log(formatTrafficLine(result));
  if (result.status === 'failed') process.exit(1);
}

export function formatTrafficLine(r: TrafficResult): string {
  let line = `traffic ${r.status}`;
  if (r.links !== undefined) line += ` links=${r.links} missing=${r.missing} unknown=${r.unknown}`;
  if (r.dataAt) {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(r.dataAt);
    line += ` data=${hm}`;
  }
  if (r.reason) line += ` reason=${r.reason}`;
  if (r.code) line += ` code=${r.code}`;
  return line;
}
