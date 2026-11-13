'use client';

import { useMemo } from 'react';
import { slowRoutes, slowRoutesOption, type RouteBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { speedLevel } from '@traffic-room/shared';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';
import { StatusLegend } from './StatusLegend';

const ROW = 44;
const LEVEL = { ok: '원활', slow: '서행', jam: '정체' } as const;

/** 가장 최근 기록에서 평균 속도가 낮은 노선 7개. 막대 색은 속도 단계, 범례가 색의 뜻을 적는다. */
export function SlowRoutes({ routes, status }: { routes: RouteBucket[]; status: LoadStatus }) {
  const rows = useMemo(() => slowRoutes(routes), [routes]);
  const option = useMemo(() => slowRoutesOption(routes), [routes]);
  const table = useMemo(() => ({
    columns: ['노선', '평균 속도(km/h)', '상태'],
    rows: rows.map((r) => [r.route, Math.round(r.avgSpeed), LEVEL[speedLevel(r.avgSpeed)]]),
  }), [rows]);
  const at = rows[0]?.dataAt;

  return (
    <Card
      id="ins-slow" title="지금 느린 노선" className="ins-slow" status={status} empty={rows.length === 0} height={7 * ROW}
      note={at ? <>교통 {hhmm(at)} 기준 · 노선 평균 속도 하위 {rows.length}개</> : '노선 평균 속도 하위 7개'}
    >
      <EChart option={option} height={Math.max(rows.length, 3) * ROW} ariaLabel="지금 느린 노선" table={table} />
      <StatusLegend />
    </Card>
  );
}
