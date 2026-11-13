import { NextResponse } from 'next/server';
import { logFailure } from '@/lib/log';
import { createNeonDb, getActiveIncidents, lastCollectedAt, latestEmittedId } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { readTiming } from '@traffic-room/shared';
import type { Snapshot } from '@/store/console';

export const dynamic = 'force-dynamic';

const OK_HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' };
const NO_STORE = { 'Cache-Control': 'no-store' };

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      // 개발 전용 재생: 키도 DB도 없을 때만 픽스처로 채운다.
      const mode = process.env.ITS_MODE;
      if (process.env.NODE_ENV === 'production' || (mode && mode !== 'fixture')) throw new Error('no database');
      const { delayMinutes } = readTiming(process.env);
      const incidents = await createItsClient({ mode: 'fixture' }).events();
      const body: Snapshot = { incidents, latestId: 0, collectedAt: null, delayMinutes };
      return NextResponse.json(body, { headers: OK_HEADERS });
    }
    const db = createNeonDb(url);
    const now = new Date();
    const { delayMinutes } = readTiming(process.env);
    const [incidents, latestId, collected] = await Promise.all([
      getActiveIncidents(db, now),
      latestEmittedId(db, now),
      lastCollectedAt(db, 'events'),
    ]);
    const body: Snapshot = {
      incidents, latestId, collectedAt: collected ? collected.toISOString() : null, delayMinutes,
    };
    return NextResponse.json(body, { headers: OK_HEADERS });
  } catch (e) {
    logFailure('api/snapshot', e);
    return NextResponse.json(FAIL, { status: 503, headers: NO_STORE });
  }
}
