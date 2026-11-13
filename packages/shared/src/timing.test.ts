import { describe, expect, it } from 'vitest';
import { readTiming } from './timing.ts';

describe('readTiming', () => {
  it('환경변수가 없으면 기본값을 쓴다', () => {
    expect(readTiming({})).toEqual({ intervalMinutes: 60, delayMinutes: 60, monthlyLimit: 950 });
  });

  it('환경변수 값을 읽는다', () => {
    expect(readTiming({ COLLECT_INTERVAL_MINUTES: '15', DELAY_MINUTES: '20', ITS_MONTHLY_LIMIT: '2900' })).toEqual({
      intervalMinutes: 15,
      delayMinutes: 20,
      monthlyLimit: 2900,
    });
  });

  it('양의 정수가 아니면 기본값으로 되돌린다', () => {
    expect(readTiming({ DELAY_MINUTES: '-5', COLLECT_INTERVAL_MINUTES: 'abc', ITS_MONTHLY_LIMIT: '1.5' })).toEqual({
      intervalMinutes: 60,
      delayMinutes: 60,
      monthlyLimit: 950,
    });
    expect(readTiming({ DELAY_MINUTES: '0' }).delayMinutes).toBe(60);
  });
});
