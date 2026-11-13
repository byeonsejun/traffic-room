import { useEffect, useState } from 'react';
import type { Insights } from '@traffic-room/db';
import { load } from '@/lib/load';

export type TrafficBucket = Insights['buckets'][number];

/**
 * 24시간 교통 요약. 처음 한 번 받고, 지표가 가리키는 교통 스냅샷이 바뀌면 다시 받는다.
 * 다시 받기가 실패하면 마지막으로 받은 기록을 그대로 둔다.
 */
export function useInsights(snapshotId: number | null): TrafficBucket[] {
  const [buckets, setBuckets] = useState<TrafficBucket[]>([]);
  useEffect(() => {
    const ac = new AbortController();
    // 스냅샷 id 를 붙여 CDN 캐시(60초)가 바뀌기 전 응답을 돌려주지 않게 한다.
    const path = snapshotId === null ? '/api/insights' : `/api/insights?id=${snapshotId}`;
    load<Insights>(path, ac.signal).then((r) => setBuckets(r.buckets), () => {});
    return () => ac.abort();
  }, [snapshotId]);
  return buckets;
}
