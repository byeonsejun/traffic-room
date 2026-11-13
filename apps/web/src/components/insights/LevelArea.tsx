'use client';

import { useMemo } from 'react';
import { levelAreaOption, type TrafficBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';

const HEIGHT = 240;
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : '—');

/** 24시간 구간 상태 비율. 아래에서부터 정체 · 서행 · 원활을 쌓고, 십자선 툴팁이 세 값을 함께 보여 준다. */
export function LevelArea({ buckets, status }: { buckets: TrafficBucket[]; status: LoadStatus }) {
  const option = useMemo(() => levelAreaOption(buckets), [buckets]);
  const table = useMemo(() => ({
    columns: ['시각', '원활', '서행', '정체'],
    rows: buckets.map((b) => {
      const total = b.ok + b.slow + b.jam;
      return [hhmm(b.dataAt), pct(b.ok, total), pct(b.slow, total), pct(b.jam, total)];
    }),
  }), [buckets]);

  return (
    <Card
      id="ins-area" title="구간 상태 비율" className="ins-area" status={status} empty={buckets.length === 0} height={HEIGHT}
      note="본선 구간 중 원활 · 서행 · 정체의 몫"
    >
      <EChart option={option} height={HEIGHT} ariaLabel="최근 24시간 구간 상태 비율" table={table} />
    </Card>
  );
}
