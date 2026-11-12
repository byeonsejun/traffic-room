// 임시 진단용 라우트: Vercel 서울(icn1)에서 ITS 서버에 닿는지만 확인한다.
// 공개 테스트 키(apiKey=test)만 쓰므로 월 호출 한도를 쓰지 않는다. 확인 후 지운다.
export const dynamic = 'force-dynamic';
export const preferredRegion = 'icn1';

const targets = {
  www: 'https://www.its.go.kr/',
  api: 'https://openapi.its.go.kr:9443/eventInfo?apiKey=test&type=all&eventType=all&getType=json',
  cctv: 'https://cctvsec.ktict.co.kr/',
  datagokr: 'https://apis.data.go.kr/',
  dataex: 'https://data.ex.co.kr/',
  utic: 'https://www.utic.go.kr/',
  seoul: 'http://openapi.seoul.go.kr:8088/',
} as const;

async function probe(url: string) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual', cache: 'no-store' });
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : 'unknown', ms: Date.now() - started };
  }
}

export async function GET() {
  const entries = await Promise.all(
    Object.entries(targets).map(async ([name, url]) => [name, await probe(url)] as const),
  );
  return Response.json(
    { region: process.env.VERCEL_REGION ?? 'local', results: Object.fromEntries(entries) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
