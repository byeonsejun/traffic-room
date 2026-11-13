import { NextResponse } from 'next/server';
import { logFailure } from '@/lib/log';
import { createNeonDb, getInsights, type Insights } from '@traffic-room/db';
import { readTiming } from '@traffic-room/shared';

export const dynamic = 'force-dynamic';

const OK_HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' };
const NO_STORE = { 'Cache-Control': 'no-store' };

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

type InsightsResponse = Insights & { delayMinutes: number; intervalMinutes: number };

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    const { delayMinutes, intervalMinutes } = readTiming(process.env);
    if (!url) {
      // 개발 전용: 지어낸 기록 없이 빈 값과 설정만 준다.
      const mode = process.env.ITS_MODE;
      if (process.env.NODE_ENV === 'production' || (mode && mode !== 'fixture')) throw new Error('no database');
      const body: InsightsResponse = { buckets: [], routes: [], incidentsByHour: [], delayMinutes, intervalMinutes };
      return NextResponse.json(body, { headers: OK_HEADERS });
    }
    const now = new Date();
    // 교통도 돌발처럼 지연해서 보여 준다. 아직 화면에 오지 않은 스냅샷은 요약에서도 뺀다.
    const insights = await getInsights(createNeonDb(url), now, { trafficUntil: new Date(now.getTime() - delayMinutes * 60_000) });
    const body: InsightsResponse = { ...insights, delayMinutes, intervalMinutes };
    return NextResponse.json(body, { headers: OK_HEADERS });
  } catch (e) {
    logFailure('api/insights', e);
    return NextResponse.json(FAIL, { status: 503, headers: NO_STORE });
  }
}
