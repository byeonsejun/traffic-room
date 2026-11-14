import { NextResponse } from 'next/server';
import type { InsightsResponse } from '@/lib/api';
import { API_CACHE, assertDevFixture, failResponse } from '@/lib/api-route';
import { createNeonDb, getInsights } from '@traffic-room/db';
import { readTiming } from '@traffic-room/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    const { delayMinutes, intervalMinutes } = readTiming(process.env);
    if (!url) {
      // 개발 전용: 지어낸 기록 없이 빈 값과 설정만 준다.
      assertDevFixture();
      const body: InsightsResponse = { buckets: [], routes: [], incidentsByHour: [], delayMinutes, intervalMinutes };
      return NextResponse.json(body, { headers: API_CACHE });
    }
    const now = new Date();
    // 교통도 돌발처럼 지연해서 보여 준다. 교통 기록과 시간대별 돌발 모두 지금 − 지연에서 끝난다.
    const insights = await getInsights(createNeonDb(url), now, { until: new Date(now.getTime() - delayMinutes * 60_000) });
    const body: InsightsResponse = { ...insights, delayMinutes, intervalMinutes };
    return NextResponse.json(body, { headers: API_CACHE });
  } catch (e) {
    return failResponse('api/insights', e);
  }
}
