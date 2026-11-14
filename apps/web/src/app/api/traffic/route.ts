import { fileURLToPath } from 'node:url';
import { NextResponse } from 'next/server';
import type { TrafficResponse } from '@/lib/api';
import { API_CACHE, assertDevFixture, failResponse } from '@/lib/api-route';
import { createNeonDb, getLinkSpeeds, shownTrafficSnapshot } from '@traffic-room/db';
import { loadHighways } from '@traffic-room/highways/read';
import { createItsClient } from '@traffic-room/its';

export const dynamic = 'force-dynamic';

/**
 * `?id=N` 은 지표가 가리키는 스냅샷을 받으러 올 때 붙는다(CDN 캐시 열쇠). 여기서 아직 N 보다 옛것이 보이면
 * (DB 복제 지연 · 시계 차이) 그 옛 응답이 새 열쇠로 캐시되지 않게 no-store 503 으로 돌려보낸다. 브라우저가 잠시 뒤 다시 온다.
 */
export async function GET(req: Request) {
  const url = process.env.DATABASE_URL;
  const idParam = new URL(req.url).searchParams.get('id');
  const wanted = idParam ? Number(idParam) : Number.NaN;
  try {
    if (!url) {
      // 개발 전용 재생: 키도 DB도 없을 때만 픽스처로 채운다.
      assertDevFixture();
      const fetched = await createItsClient({ mode: 'fixture' }).traffic();
      // Turbopack 이 템플릿 경로를 잘못 묶으므로 리터럴 URL 을 쓴다. cwd 는 실행 위치마다 달라 믿지 않는다.
      const highways = loadHighways(fileURLToPath(new URL('../../../../public/highways.json', import.meta.url)));
      const body: TrafficResponse = {
        id: 0,
        dataAt: fetched.dataAt[0] as string,
        speeds: fetched.items.filter((i) => highways.get(i.linkId)).map((i) => [i.linkId, i.speed]),
      };
      return NextResponse.json(body, { headers: API_CACHE });
    }
    const db = createNeonDb(url);
    const now = new Date();
    const shown = await shownTrafficSnapshot(db, now);
    if (Number.isFinite(wanted) && (shown?.id ?? -Infinity) < wanted) {
      return failResponse();
    }
    if (!shown) return NextResponse.json({ id: null } satisfies TrafficResponse, { headers: API_CACHE });
    const body: TrafficResponse = {
      id: shown.id,
      dataAt: shown.dataAt.toISOString(),
      speeds: await getLinkSpeeds(db, shown.id),
    };
    return NextResponse.json(body, { headers: API_CACHE });
  } catch (e) {
    return failResponse('api/traffic', e);
  }
}
