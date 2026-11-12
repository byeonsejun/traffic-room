import { NextResponse } from 'next/server';
import { logFailure } from '@/lib/log';
import { createNeonDb, getCctvs } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';

export const dynamic = 'force-dynamic';

const OK_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' };
const NO_STORE = { 'Cache-Control': 'no-store' };

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      const mode = process.env.ITS_MODE;
      if (process.env.NODE_ENV === 'production' || (mode && mode !== 'fixture')) throw new Error('no database');
      return NextResponse.json(await createItsClient({ mode: 'fixture' }).cctvs('ex'), { headers: OK_HEADERS });
    }
    return NextResponse.json(await getCctvs(createNeonDb(url)), { headers: OK_HEADERS });
  } catch (e) {
    logFailure('api/cctvs', e);
    return NextResponse.json(FAIL, { status: 503, headers: NO_STORE });
  }
}
