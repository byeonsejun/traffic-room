'use client';

import { useMemo } from 'react';
import { levelAreaOption, levelRows, levelShare, type TrafficBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';

const HEIGHT = 240;

/** 24시간 구간 상태 비율. 아래에서부터 정체 · 서행 · 원활을 쌓고, 십자선 툴팁이 세 값을 함께 보여 준다. */
export function LevelArea({ buckets, intervalMinutes, status }: {
  buckets: TrafficBucket[];
  intervalMinutes: number;
  status: LoadStatus;
}) {
  const option = useMemo(() => levelAreaOption(buckets, intervalMinutes), [buckets, intervalMinutes]);
  // 표도 차트와 같은 24시간 창을 쓴다.
  const table = useMemo(() => ({
    columns: ['시각', '원활', '서행', '정체'],
    rows: levelRows(buckets).map((b) => [
      hhmm(b.dataAt), `${levelShare(b, 'ok')}%`, `${levelShare(b, 'slow')}%`, `${levelShare(b, 'jam')}%`,
    ]),
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
