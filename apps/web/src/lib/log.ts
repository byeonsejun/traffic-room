/**
 * 실패를 서버 로그에 남긴다. 에러 문구에는 접속 문자열이나 키가 든 주소가 섞일 수 있어
 * code(문자열일 때) 나 에러 이름만 적는다.
 */
export function logFailure(where: string, e: unknown): void {
  const code = (e as { code?: unknown } | null)?.code;
  const label = typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown';
  console.error(`[${where}] 실패 code=${label}`);
}
