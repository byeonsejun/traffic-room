import { NextResponse } from 'next/server';
import { createNeonDb, getActiveIncidents, lastCollectedAt, latestEmittedId } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { DELAY_MINUTES } from '@traffic-room/shared';
import type { Snapshot } from '@/store/console';

export const revalidate = 60;

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      // 개발 전용 재생: 키도 DB도 없을 때만 픽스처로 채운다.
      const mode = process.env.ITS_MODE;
      if (mode && mode !== 'fixture') throw new Error('no database');
      const incidents = await createItsClient({ mode: 'fixture' }).events();
      const body: Snapshot = { incidents, latestId: 0, collectedAt: null, delayMinutes: DELAY_MINUTES };
      return NextResponse.json(body);
    }
    const db = createNeonDb(url);
    const now = new Date();
    const [incidents, latestId, collected] = await Promise.all([
      getActiveIncidents(db, now),
      latestEmittedId(db, now),
      lastCollectedAt(db, 'events'),
    ]);
    const body: Snapshot = {
      incidents, latestId, collectedAt: collected ? collected.toISOString() : null, delayMinutes: DELAY_MINUTES,
    };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(FAIL, { status: 503 });
  }
}
