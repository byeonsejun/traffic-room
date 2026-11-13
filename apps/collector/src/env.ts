import { createItsClient } from '@traffic-room/its';
import { createNeonDb } from '@traffic-room/db';
import { readTiming } from '@traffic-room/shared';

/** 진입점 공통: 환경변수에서 의존성을 만든다. 키와 접속 문자열은 어디에도 찍지 않는다. */
export function depsFromEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다.');
    process.exit(1);
  }
  const mode = process.env.ITS_MODE === 'live' ? 'live' : 'fixture';
  return {
    db: createNeonDb(url),
    its: createItsClient({ mode, apiKey: process.env.ITS_API_KEY }),
    now: () => new Date(),
    timing: readTiming(process.env),
  };
}

export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'unknown';
}
