export type Timing = { intervalMinutes: number; delayMinutes: number; monthlyLimit: number };

const DEFAULTS: Timing = { intervalMinutes: 60, delayMinutes: 60, monthlyLimit: 950 };

// 양의 정수 문자열만 받는다. 그 밖(빈 값 · 음수 · 소수 · 문자)은 기본값.
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function readTiming(env: Record<string, string | undefined>): Timing {
  return {
    intervalMinutes: positiveInt(env.COLLECT_INTERVAL_MINUTES, DEFAULTS.intervalMinutes),
    delayMinutes: positiveInt(env.DELAY_MINUTES, DEFAULTS.delayMinutes),
    monthlyLimit: positiveInt(env.ITS_MONTHLY_LIMIT, DEFAULTS.monthlyLimit),
  };
}

export function delayLabel(minutes: number): string {
  return minutes === 60 ? '약 1시간 지연' : `약 ${minutes}분 지연`;
}
