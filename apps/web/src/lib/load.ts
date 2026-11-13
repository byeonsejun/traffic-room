export const FALLBACK = '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';

/** JSON 을 받아 온다. 실패하면 서버가 준 문구(없으면 FALLBACK)로 에러를 던진다. */
export async function load<T>(path: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  const body = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok || body === null) throw new Error(body?.message ?? FALLBACK);
  return body;
}
