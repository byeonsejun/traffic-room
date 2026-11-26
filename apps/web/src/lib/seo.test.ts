import { describe, expect, test } from 'vitest';
import {
  buildLlmsTxt,
  buildPageMetadata,
  buildRobots,
  buildRootMetadata,
  buildSitemap,
  buildWebApplicationJsonLd,
  homeDescription,
  INSIGHTS_DESCRIPTION,
  isPreviewDeployment,
  OG_IMAGE,
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

describe('OG_IMAGE', () => {
  test('is the 1200x630 public file with alt text', () => {
    expect(OG_IMAGE).toEqual({ url: '/og.png', width: 1200, height: 630, alt: '속도 색으로 빛나는 전국 고속도로' });
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

  test('carries the share image so a page without its own openGraph keeps it', () => {
    expect(meta.openGraph).toMatchObject({ images: [OG_IMAGE] });
    expect(meta.twitter).toMatchObject({ images: [OG_IMAGE] });
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
    expect(meta.openGraph).toMatchObject({ images: [OG_IMAGE] });
    expect(meta.twitter).toMatchObject({ images: [OG_IMAGE] });
    expect(meta).not.toHaveProperty('robots');
  });

  test('falls back to the site name when there is no title', () => {
    const meta = buildPageMetadata({ description: 'd', path: '/' });
    expect(meta).not.toHaveProperty('title');
    expect(meta.openGraph).toMatchObject({ title: '전국 도로 상황실', url: '/' });
  });
});

describe('buildRobots', () => {
  test('production blocks only /api/ and points at the sitemap', () => {
    expect(buildRobots(false)).toEqual({
      rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
      sitemap: 'https://traffic-room.vercel.app/sitemap.xml',
    });
  });

  test('preview blocks everything and offers no sitemap', () => {
    const robots = buildRobots(true);
    expect(robots).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    expect(robots).not.toHaveProperty('sitemap');
  });
});

describe('buildSitemap', () => {
  test('lists the two pages and no api route', () => {
    expect(buildSitemap().map((e) => e.url)).toEqual([
      'https://traffic-room.vercel.app/',
      'https://traffic-room.vercel.app/insights',
    ]);
  });

  test('does not claim a lastModified the page does not have', () => {
    for (const entry of buildSitemap()) expect(entry).not.toHaveProperty('lastModified');
  });
});

describe('buildLlmsTxt', () => {
  const text = buildLlmsTxt({ delayMinutes: 20, intervalMinutes: 15 });

  test('starts with the site name and a summary quote', () => {
    expect(text.startsWith('# 전국 도로 상황실\n')).toBe(true);
    expect(text).toMatch(/^> .+/m);
  });

  test('reads delay and interval from its arguments', () => {
    expect(text).toContain('약 20분 지연');
    expect(text).toContain('15분마다');
    expect(text).not.toContain('1시간');
    const hourly = buildLlmsTxt({ delayMinutes: 60, intervalMinutes: 60 });
    expect(hourly).toContain('약 1시간 지연');
    expect(hourly).toContain('1시간마다');
    expect(hourly).not.toContain('20분');
  });

  test('names the data sources, the pages and the author', () => {
    expect(text).toContain('국가교통정보센터(ITS)');
    expect(text).toContain('OpenFreeMap');
    expect(text).toContain('- [관제 화면](https://traffic-room.vercel.app/)');
    expect(text).toContain('- [분석](https://traffic-room.vercel.app/insights)');
    expect(text).toContain('https://sejunb.com');
    expect(text).toContain('https://github.com/byeonsejun/traffic-room');
  });
});

describe('buildWebApplicationJsonLd', () => {
  test('carries only what the screen shows', () => {
    expect(buildWebApplicationJsonLd(20)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: '전국 도로 상황실',
      url: 'https://traffic-room.vercel.app/',
      description: homeDescription(20),
      inLanguage: 'ko-KR',
      applicationCategory: 'TravelApplication',
      operatingSystem: 'Web',
    });
  });
});
