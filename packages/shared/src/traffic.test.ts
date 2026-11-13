import { describe, expect, it } from 'vitest';
import { delayLabel } from './timing.ts';
import { metricsSchema, speedLevel } from './traffic.ts';

describe('speedLevel', () => {
  it('70 이상은 원활, 40 이상 70 미만은 서행, 40 미만은 정체', () => {
    expect(speedLevel(70)).toBe('ok');
    expect(speedLevel(69.9)).toBe('slow');
    expect(speedLevel(40)).toBe('slow');
    expect(speedLevel(39)).toBe('jam');
  });
});

describe('delayLabel', () => {
  it('60분은 1시간, 그 밖은 분 단위', () => {
    expect(delayLabel(60)).toBe('약 1시간 지연');
    expect(delayLabel(20)).toBe('약 20분 지연');
  });
});

describe('metricsSchema', () => {
  const valid = {
    trafficSnapshotId: 3,
    trafficDataAt: '2026-11-13T01:00:00.000Z',
    nextTrafficAt: '2026-11-13T02:05:00.000Z',
    traffic: { avgSpeed: 62.4, ok: 100, slow: 20, jam: 5, jamKm: 12.3 },
    incidents: { total: 4, byCategory: { accident: 1, breakdown: 1, weather: 0, construction: 2, report: 0, other: 0 } },
    delayMinutes: 60,
    intervalMinutes: 60,
    collectedAt: '2026-11-13T08:20:00.000Z',
  };

  it('올바른 지표를 받는다', () => {
    expect(metricsSchema.safeParse(valid).success).toBe(true);
  });

  it('교통 데이터가 아직 없으면 null 을 허용한다', () => {
    const empty = { ...valid, trafficSnapshotId: null, trafficDataAt: null, nextTrafficAt: null, traffic: null };
    expect(metricsSchema.safeParse(empty).success).toBe(true);
  });

  it('카테고리 집계가 빠지면 거부한다', () => {
    const bad = { ...valid, incidents: { total: 1, byCategory: { accident: 1 } } };
    expect(metricsSchema.safeParse(bad).success).toBe(false);
  });
});
