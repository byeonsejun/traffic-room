import { NextResponse } from 'next/server';
import { createNeonDb, getCctvs } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';

export const revalidate = 3600;

const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

export async function GET() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) {
      const mode = process.env.ITS_MODE;
      if (mode && mode !== 'fixture') throw new Error('no database');
      return NextResponse.json(await createItsClient({ mode: 'fixture' }).cctvs('ex'));
    }
    return NextResponse.json(await getCctvs(createNeonDb(url)));
  } catch {
    return NextResponse.json(FAIL, { status: 503 });
  }
}
