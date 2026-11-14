/**
 * 로그에 남길 오류 이름. 오류 문구에는 접속 문자열이나 키가 든 주소가 섞일 수 있어 code(문자열일 때)나 이름만 쓴다.
 * 수집기와 실시간 서버가 같이 쓴다.
 */
export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'unknown';
}
