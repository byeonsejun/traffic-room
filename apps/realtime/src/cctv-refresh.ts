import { canCall, getCctv, recordRun, updateCctvUrl, type Db } from '@traffic-room/db';
import type { ItsClient } from '@traffic-room/its';
import type { Timing } from '@traffic-room/shared';

export type CctvUrlResult = { url: string | null; reason: 'cached' | 'refreshed' | 'unavailable' };

export interface DailyQuota {
  /** 오늘(KST) 남은 횟수가 있으면 하나 쓰고 true. */
  tryTake(now: Date): boolean;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDay = (d: Date) => new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

/** 서버 메모리에만 두는 하루 상한. 재시작하면 초기화되지만 월 한도는 DB 의 canCall 이 지킨다. */
export function createDailyQuota(limit: number): DailyQuota {
  let day = '';
  let used = 0;
  return {
    tryTake(now) {
      const today = kstDay(now);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= limit) return false;
      used += 1;
      return true;
    },
  };
}

export interface RefreshDeps {
  db: Db;
  its: ItsClient;
  now: () => Date;
  quota: DailyQuota;
  timing: Timing;
}

const BBOX_MARGIN = 0.01;

/** DB 에 고속도로/국도 구분이 없어 이름으로 짐작한다. 모르면 고속도로로 본다. */
function cctvType(name: string): 'ex' | 'its' {
  return name.includes('국도') ? 'its' : 'ex';
}

/**
 * 만료된 CCTV 주소를 ITS 에서 새로 받아 온다.
 * - 오늘 상한이나 이달 예산이 다 찼으면 ITS 를 부르지 않고 unavailable 을 돌려준다
 *   (클라이언트는 이미 재생에 실패한 주소 때문에 요청한 것이라 같은 주소를 다시 줄 이유가 없다).
 * - 호출했지만 실패했거나 같은 이름이 없으면 저장된 주소를 cached 로 돌려준다.
 */
export async function refreshCctv(deps: RefreshDeps, cctvId: string): Promise<CctvUrlResult> {
  const { db, its, quota, timing } = deps;
  const cctv = await getCctv(db, cctvId);
  if (!cctv) return { url: null, reason: 'unavailable' };

  const at = deps.now();
  if (!(await canCall(db, 'cctv', at, timing.monthlyLimit)) || !quota.tryTake(at)) {
    return { url: null, reason: 'unavailable' };
  }

  const bbox = {
    minX: cctv.lon - BBOX_MARGIN, maxX: cctv.lon + BBOX_MARGIN,
    minY: cctv.lat - BBOX_MARGIN, maxY: cctv.lat + BBOX_MARGIN,
  };
  let list;
  try {
    list = await its.cctvs(cctvType(cctv.name), bbox);
  } catch {
    await recordRun(db, 'cctv', false, 0, at);
    return { url: cctv.url, reason: 'cached' };
  }
  await recordRun(db, 'cctv', true, list.length, at);

  // 좌표가 미세하게 달라 id 가 바뀔 수 있으므로 이름으로 맞춘다.
  const match = list.find((c) => c.name === cctv.name);
  if (!match) return { url: cctv.url, reason: 'cached' };
  await updateCctvUrl(db, cctv.id, match.url, at);
  return { url: match.url, reason: 'refreshed' };
}
