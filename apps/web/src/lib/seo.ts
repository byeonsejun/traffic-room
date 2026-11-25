import type { Metadata } from 'next';
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
