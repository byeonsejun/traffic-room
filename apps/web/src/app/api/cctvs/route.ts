import { NextResponse } from 'next/server';
import { CCTV_CACHE, assertDevFixture, failResponse } from '@/lib/api-route';
import { createNeonDb, getCctvs } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      assertDevFixture();
      return NextResponse.json(await createItsClient({ mode: 'fixture' }).cctvs('ex'), { headers: CCTV_CACHE });
    }
    return NextResponse.json(await getCctvs(createNeonDb(url)), { headers: CCTV_CACHE });
  } catch (e) {
    return failResponse('api/cctvs', e);
  }
}
