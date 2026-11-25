import { describe, expect, test } from 'vitest';
import {
  buildPageMetadata,
  buildRootMetadata,
  homeDescription,
  INSIGHTS_DESCRIPTION,
  isPreviewDeployment,
  SITE_NAME,
  SITE_URL,
} from './seo';

describe('isPreviewDeployment', () => {
  test('is true only for the preview environment', () => {
    expect(isPreviewDeployment('preview')).toBe(true);
    expect(isPreviewDeployment('production')).toBe(false);
    expect(isPreviewDeployment('development')).toBe(false);
    expect(isPreviewDeployment(undefined)).toBe(false);
  });
});

describe('homeDescription', () => {
  test('reads the delay from the number it is given', () => {
    expect(homeDescription(20)).toContain('약 20분 지연으로');
    expect(homeDescription(60)).toContain('약 1시간 지연으로');
  });

  test('never mixes the two delays', () => {
    for (const text of [homeDescription(20), homeDescription(60)]) {
      expect(text.includes('1시간') && text.includes('20분')).toBe(false);
    }
  });
});

describe('constants', () => {
  test('point at the production site', () => {
    expect(SITE_URL).toBe('https://traffic-room.vercel.app');
    expect(SITE_NAME).toBe('전국 도로 상황실');
    expect(INSIGHTS_DESCRIPTION).toBe('최근 24시간 고속도로 노선별 속도 · 구간 상태 · 돌발 발생 분석');
  });
});

describe('buildRootMetadata', () => {
  const meta = buildRootMetadata({ preview: false, delayMinutes: 20 });

  test('sets the canonical base, title template and description', () => {
    expect(String(meta.metadataBase)).toBe('https://traffic-room.vercel.app/');
    expect(meta.title).toEqual({ default: '전국 도로 상황실', template: '%s · 전국 도로 상황실' });
    expect(meta.description).toBe(homeDescription(20));
  });

  test('leaves robots alone outside previews', () => {
    expect(meta.robots).toBeUndefined();
  });

  test('keeps description out of the layout openGraph', () => {
    expect(meta.openGraph).toBeDefined();
    expect(meta.openGraph).not.toHaveProperty('description');
    expect(meta.openGraph).toMatchObject({ siteName: '전국 도로 상황실', locale: 'ko_KR', type: 'website' });
  });

  test('uses the large summary card', () => {
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  test('blocks indexing on previews', () => {
    expect(buildRootMetadata({ preview: true, delayMinutes: 20 }).robots).toEqual({ index: false, follow: false });
  });
});

describe('buildPageMetadata', () => {
  test('builds the full openGraph and twitter set for a titled page', () => {
    const meta = buildPageMetadata({ title: '분석', description: 'd', path: '/insights' });
    expect(meta.title).toBe('분석');
    expect(meta.alternates?.canonical).toBe('/insights');
    expect(meta.openGraph).toMatchObject({
      title: '분석 · 전국 도로 상황실',
      url: '/insights',
      description: 'd',
      siteName: '전국 도로 상황실',
      locale: 'ko_KR',
      type: 'website',
    });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: '분석 · 전국 도로 상황실', description: 'd' });
    expect(meta).not.toHaveProperty('robots');
  });

  test('falls back to the site name when there is no title', () => {
    const meta = buildPageMetadata({ description: 'd', path: '/' });
    expect(meta).not.toHaveProperty('title');
    expect(meta.openGraph).toMatchObject({ title: '전국 도로 상황실', url: '/' });
  });
});
