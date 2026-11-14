import { NextResponse } from 'next/server';
import { logFailure } from './log';

/** API 라우트(서버)만 쓰는 응답 머리 · 실패 응답 · 개발 전용 대체 판단. */

/** 스냅샷 · 교통 · 분석: CDN 60초. 15분마다 바뀌는 데이터라 1분 늦어도 괜찮고, DB(Neon) 조회를 크게 줄인다. */
export const API_CACHE = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' };
/** CCTV 목록: 하루 세 번만 바뀌어 1시간. */
export const CCTV_CACHE = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' };
/** 실패 응답은 CDN 이 붙잡지 않게 한다. */
export const NO_STORE = { 'Cache-Control': 'no-store' };
export const FAIL = { message: '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' };

/** 503 + no-store. `where` 와 오류를 주면 서버 로그에도 남긴다(코드 · 이름만). */
export function failResponse(where?: string, e?: unknown) {
  if (where) logFailure(where, e);
  return NextResponse.json(FAIL, { status: 503, headers: NO_STORE });
}

/**
 * DB 주소가 없을 때 저장해 둔 실제 응답(픽스처)이나 빈 값으로 채워도 되는지. 개발에서 ITS_MODE 가 없거나 fixture 일 때만 된다.
 * 운영이거나 실제 모드인데 DB 가 없으면 예시 데이터를 실제처럼 보이지 않게 오류로 던진다(라우트는 503).
 */
export function assertDevFixture(): void {
  const mode = process.env.ITS_MODE;
  if (process.env.NODE_ENV === 'production' || (mode && mode !== 'fixture')) throw new Error('no database');
}
