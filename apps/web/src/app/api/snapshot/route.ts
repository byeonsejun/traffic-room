import { NextResponse } from 'next/server';
import type { Snapshot } from '@/lib/api';
import { API_CACHE, assertDevFixture, failResponse } from '@/lib/api-route';
import { createNeonDb, getActiveIncidents, lastCollectedAt, latestEmittedId } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { readTiming } from '@traffic-room/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      // 개발 전용 재생: 키도 DB도 없을 때만 픽스처로 채운다.
      assertDevFixture();
      const { delayMinutes } = readTiming(process.env);
      const incidents = await createItsClient({ mode: 'fixture' }).events();
      const body: Snapshot = { incidents, latestId: 0, collectedAt: null, delayMinutes };
      return NextResponse.json(body, { headers: API_CACHE });
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
    return NextResponse.json(body, { headers: API_CACHE });
  } catch (e) {
    return failResponse('api/snapshot', e);
  }
}
