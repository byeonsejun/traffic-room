export interface RealtimeConfig {
  databaseUrl: string;
  port: number;
  mode: 'live' | 'fixture';
  allowedOrigins: string[];
}

export type ConfigResult =
  | { ok: true; config: RealtimeConfig; warnings: string[] }
  | { ok: false; error: string };

const NO_ORIGINS =
  'ALLOWED_ORIGINS 가 비어 있어 모든 브라우저 접속을 거절합니다. 화면 주소를 쉼표로 구분해 넣어 주세요.';

/** 환경변수를 읽는다. 돌려주는 문구에는 접속 문자열이나 키를 넣지 않는다. */
export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) return { ok: false, error: 'DATABASE_URL 환경변수가 필요합니다.' };
  const mode = env.ITS_MODE === 'live' ? 'live' : 'fixture';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  if (allowedOrigins.length === 0) {
    // 배포에서 비어 있으면 서버는 떠 있어도 아무도 붙지 못한다. 조용히 도는 대신 바로 멈춘다.
    if (mode === 'live') return { ok: false, error: NO_ORIGINS };
    warnings.push(NO_ORIGINS);
  }
  return { ok: true, warnings, config: { databaseUrl, port: Number(env.PORT ?? 8787), mode, allowedOrigins } };
}
