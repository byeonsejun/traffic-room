import { fileURLToPath } from 'node:url';
import { NextResponse } from 'next/server';
import { logFailure } from '@/lib/log';
import {
  createNeonDb, getLinkSpeeds, shownTrafficSnapshot, upcomingTrafficSnapshots,
} from '@traffic-room/db';
import { loadHighways } from '@traffic-room/highways';
import { createItsClient } from '@traffic-room/its';

export const dynamic = 'force-dynamic';

const OK_HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' };
const NO_STORE = { 'Cache-Control': 'no-store' };

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

type TrafficResponse =
  | { id: number; dataAt: string; nextShowAt: string | null; speeds: [string, number][] }
  | { id: null };

const DAY = 24 * 3_600_000;

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      // 개발 전용 재생: 키도 DB도 없을 때만 픽스처로 채운다.
      const mode = process.env.ITS_MODE;
      if (process.env.NODE_ENV === 'production' || (mode && mode !== 'fixture')) throw new Error('no database');
      const fetched = await createItsClient({ mode: 'fixture' }).traffic();
      // Turbopack 이 템플릿 경로를 잘못 묶으므로 리터럴 URL 을 쓴다. cwd 는 실행 위치마다 달라 믿지 않는다.
      const highways = loadHighways(fileURLToPath(new URL('../../../../public/highways.json', import.meta.url)));
      const body: TrafficResponse = {
        id: 0,
        dataAt: fetched.dataAt[0] as string,
        nextShowAt: null,
        speeds: fetched.items.filter((i) => highways.get(i.linkId)).map((i) => [i.linkId, i.speed]),
      };
      return NextResponse.json(body, { headers: OK_HEADERS });
    }
    const db = createNeonDb(url);
    const now = new Date();
    const shown = await shownTrafficSnapshot(db, now);
    if (!shown) return NextResponse.json({ id: null } satisfies TrafficResponse, { headers: OK_HEADERS });
    const [speeds, upcoming] = await Promise.all([
      getLinkSpeeds(db, shown.id),
      upcomingTrafficSnapshots(db, now, new Date(now.getTime() + DAY)),
    ]);
    const body: TrafficResponse = {
      id: shown.id,
      dataAt: shown.dataAt.toISOString(),
      nextShowAt: upcoming[0] ? upcoming[0].showAt.toISOString() : null,
      speeds,
    };
    return NextResponse.json(body, { headers: OK_HEADERS });
  } catch (e) {
    logFailure('api/traffic', e);
    return NextResponse.json(FAIL, { status: 503, headers: NO_STORE });
  }
}
