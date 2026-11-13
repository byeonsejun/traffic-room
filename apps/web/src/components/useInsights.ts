import { useEffect, useState } from 'react';
import type { Insights } from '@traffic-room/db';
import { load } from '@/lib/load';

export type TrafficBucket = Insights['buckets'][number];
type InsightsResponse = Insights & { delayMinutes: number; intervalMinutes: number };
export type InsightsData = Insights & {
  intervalMinutes: number;
  /** 받아 온 시각(ms). 시간대별 돌발 칸이 어느 시각까지인지 정한다. */
  loadedAt: number;
};
/** loading: 아직 한 번도 못 받음 · ok: 받은 기록이 있음 · error: 처음 받기부터 실패 */
export type InsightsState = { status: 'loading' | 'ok' | 'error'; data: InsightsData };

const EMPTY: InsightsData = { buckets: [], routes: [], incidentsByHour: [], intervalMinutes: 60, loadedAt: 0 };

/**
 * 24시간 교통 요약. 처음 한 번 받고, 지표가 가리키는 교통 스냅샷이 바뀌면 다시 받는다.
 * 다시 받기가 실패하면 마지막으로 받은 기록을 그대로 둔다. 받기 전 · 실패를 "기록 0시간"으로 읽지 않게 상태를 함께 준다.
 */
export function useInsights(snapshotId: number | null): InsightsState {
  const [state, setState] = useState<InsightsState>({ status: 'loading', data: EMPTY });
  useEffect(() => {
    const ac = new AbortController();
    // 스냅샷 id 를 붙여 CDN 캐시(60초)가 바뀌기 전 응답을 돌려주지 않게 한다.
    const path = snapshotId === null ? '/api/insights' : `/api/insights?id=${snapshotId}`;
    load<InsightsResponse>(path, ac.signal).then(
      (r) => setState({
        status: 'ok',
        data: {
          buckets: r.buckets, routes: r.routes, incidentsByHour: r.incidentsByHour,
          intervalMinutes: r.intervalMinutes, loadedAt: Date.now(),
        },
      }),
      () => {
        if (ac.signal.aborted) return;
        setState((s) => (s.status === 'ok' ? s : { ...s, status: 'error' }));
      },
    );
    return () => ac.abort();
  }, [snapshotId]);
  return state;
}
