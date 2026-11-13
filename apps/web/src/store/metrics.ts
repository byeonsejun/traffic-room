import { create } from 'zustand';
import type { Metrics, Timing } from '@traffic-room/shared';

type MetricsState = {
  /** SSE 로 받은 마지막 지표. 끊겨도 지우지 않고 마지막 값을 그대로 둔다. */
  metrics: Metrics | null;
  apply(m: Metrics): void;
};

export const useMetrics = create<MetricsState>()((set) => ({
  metrics: null,
  apply: (metrics) => set({ metrics }),
}));

/**
 * 보이는 교통 데이터가 갱신이 멈춘 것으로 볼 만큼 오래됐는지.
 * 정상이면 데이터 시각은 지금 − 지연 − 간격 안쪽에 있으니, 수집을 한 번 더 놓친 만큼(간격 × 2)까지 봐 준다.
 */
export function isTrafficStale(
  dataAt: string,
  now: Date,
  timing: Pick<Timing, 'delayMinutes' | 'intervalMinutes'>,
): boolean {
  const limitMs = (timing.delayMinutes + 2 * timing.intervalMinutes) * 60_000;
  return now.getTime() - new Date(dataAt).getTime() > limitMs;
}
