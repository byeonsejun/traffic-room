'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { heatmapOption, heatRows, type RouteBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';

const ROW = 24;
const CHROME = 40 + 28;

const NARROW = '(max-width: 640px)';
const subscribeNarrow = (onChange: () => void) => {
  const mq = window.matchMedia?.(NARROW);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
};
const isNarrow = () => window.matchMedia?.(NARROW).matches ?? false;
const notNarrow = () => false;

/** 노선 × 시간 평균 속도. 최근 24시간, 기록이 많은 노선 12개. 기록 없는 칸은 비어 있다. */
export function RouteHeatmap({ routes, status }: { routes: RouteBucket[]; status: LoadStatus }) {
  const rows = useMemo(() => heatRows(routes), [routes]);
  const compact = useSyncExternalStore(subscribeNarrow, isNarrow, notNarrow);
  const option = useMemo(() => heatmapOption(routes, 12, { compact }), [routes, compact]);
  const table = useMemo(() => {
    const at = new Map(rows.cells.map(([x, y, v]) => [`${x}|${y}`, v]));
    return {
      columns: ['노선', ...rows.slots.map((t) => hhmm(new Date(t).toISOString()))],
      rows: rows.names.map((name, y) => [name, ...rows.slots.map((_, x) => {
        const v = at.get(`${x}|${y}`);
        return v === undefined ? '—' : Math.round(v);
      })]),
    };
  }, [rows]);
  const height = Math.max(rows.names.length, 4) * ROW + CHROME;

  return (
    <Card
      id="ins-heat" title="노선 × 시간 평균 속도" className="ins-heat" status={status}
      empty={rows.names.length === 0} height={12 * ROW + CHROME}
      note={<>노선별 평균 속도(km/h) · 기록이 많은 노선 {rows.names.length || 12}개 · 느린 노선부터</>}
    >
      <EChart option={option} height={height} ariaLabel="최근 24시간 노선별 평균 속도" table={table} />
    </Card>
  );
}
