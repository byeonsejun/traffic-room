import type { Metadata, MetadataRoute } from 'next';
import { delayLabel } from '@traffic-room/shared';

export const SITE_URL = 'https://traffic-room.vercel.app';
export const SITE_NAME = '전국 도로 상황실';
export const INSIGHTS_DESCRIPTION = '최근 24시간 고속도로 노선별 속도 · 구간 상태 · 돌발 발생 분석';

const LOCALE = 'ko_KR';

/** README 첫 스크린샷을 1200x630 으로 자른 파일. 페이지 openGraph 가 레이아웃 것을 대체하므로 모든 메타에 직접 넣는다. */
export const OG_IMAGE = { url: '/og.png', width: 1200, height: 630, alt: '속도 색으로 빛나는 전국 고속도로' };

/** 미리보기 배포만 색인에서 뺀다. 로컬 · 운영은 그대로 색인한다. */
export function isPreviewDeployment(vercelEnv: string | undefined): boolean {
  return vercelEnv === 'preview';
}

/** 화면의 관제 문구와 같은 지연 표현을 쓴다. 숫자는 설정(readTiming)에서 받는다. */
export function homeDescription(delayMinutes: number): string {
  return `공공 교통 정보를 ${delayLabel(delayMinutes)}으로, 일어난 순서대로 다시 보여 주는 상황실입니다. 진행 중인 돌발상황, 고속도로 평균 속도, 가까운 CCTV를 한 화면에서 봅니다.`;
}

export function buildRootMetadata({ preview, delayMinutes }: { preview: boolean; delayMinutes: number }): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: homeDescription(delayMinutes),
    // Next 는 페이지의 openGraph 를 레이아웃 것에 합치지 않고 통째로 바꾼다. 그래서 description · url 은 페이지마다 만든다.
    openGraph: { siteName: SITE_NAME, locale: LOCALE, type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
    ...(preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export function buildPageMetadata({
  title,
  description,
  path,
}: {
  title?: string;
  description: string;
  path: string;
}): Metadata {
  const shareTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: { title: shareTitle, description, url: path, siteName: SITE_NAME, locale: LOCALE, type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images: [OG_IMAGE] },
  };
}

const AUTHOR_SITE = 'https://sejunb.com';
const REPO_URL = 'https://github.com/byeonsejun/traffic-room';

/** 막는 곳은 /api/ 뿐이다(데이터 응답이라 색인할 화면이 아니다). 미리보기는 통째로 막고 사이트맵도 알리지 않는다. */
export function buildRobots(preview: boolean): MetadataRoute.Robots {
  if (preview) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

/** 데이터는 15분마다 바뀌어도 페이지 자체는 그대로라 lastModified 를 넣지 않는다. */
export function buildSitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/` }, { url: `${SITE_URL}/insights` }];
}

export function buildLlmsTxt({ delayMinutes, intervalMinutes }: { delayMinutes: number; intervalMinutes: number }): string {
  const interval = intervalMinutes === 60 ? '1시간' : `${intervalMinutes}분`;
  return `# ${SITE_NAME}

> 국가교통정보센터(ITS) 공개 데이터로 전국 고속도로 속도와 돌발 상황, CCTV를 보여 주는 관제 화면입니다. API 호출 한도 때문에 ${interval}마다 수집하고, 새 상황은 ${delayLabel(delayMinutes)}으로 일어난 순서대로 다시 내보냅니다.

## 페이지

- [관제 화면](${SITE_URL}/): 진행 중인 돌발상황, 고속도로 평균 속도, 가까운 CCTV
- [분석](${SITE_URL}/insights): 최근 24시간 노선별 속도, 구간 상태, 시간대별 돌발 발생

## 만든 사람

- 변세준 · ${AUTHOR_SITE}
- 저장소: ${REPO_URL}

## 기술

Next.js 16, MapLibre GL, hls.js, ECharts, WebSocket · SSE 실시간 서버(Fastify), Neon Postgres

## 데이터

- 교통 정보 · CCTV: 국가교통정보센터(ITS) 공개 API
- 지도: OpenFreeMap · OpenStreetMap 기여자
`;
}

/** 화면에 보이는 값만 쓴다. 화면에 "무료"나 출처 이름이 없어서 offers · 출처는 넣지 않는다. */
export function buildWebApplicationJsonLd(delayMinutes: number): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: homeDescription(delayMinutes),
    inLanguage: 'ko-KR',
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Web',
  };
}
