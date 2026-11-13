'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { HEAT_PIECES, heatmapOption, heatRows, type RouteBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';

const ROW = 24;
const CHROME = 28;

const NARROW = '(max-width: 640px)';
const subscribeNarrow = (onChange: () => void) => {
  const mq = window.matchMedia?.(NARROW);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
};
const isNarrow = () => window.matchMedia?.(NARROW).matches ?? false;
const notNarrow = () => false;

/** 빠름 → 느림 색 범례(km/h). 기록 없는 칸 표시도 함께 둔다. */
function HeatLegend() {
  return (
    <div className="heat-legend" aria-label="히트맵 색: 빠름에서 느림">
      <span className="end">빠름</span>
      <ul>
        {HEAT_PIECES.map((p) => (
          <li key={p.label}><i style={{ background: p.color }} aria-hidden="true" />{p.label}</li>
        ))}
      </ul>
      <span className="end">느림 <small>km/h</small></span>
      <span className="none"><i aria-hidden="true" />기록 없음</span>
    </div>
  );
}

/** 노선 × 시간 평균 속도. 최근 24시간, 기록이 많은 노선 12개. 느릴수록 밝은 빨강, 기록 없는 칸은 테두리만. */
export function RouteHeatmap({ routes, intervalMinutes, status }: {
  routes: RouteBucket[];
  intervalMinutes: number;
  status: LoadStatus;
}) {
  const rows = useMemo(() => heatRows(routes, intervalMinutes), [routes, intervalMinutes]);
  const compact = useSyncExternalStore(subscribeNarrow, isNarrow, notNarrow);
  const option = useMemo(() => heatmapOption(rows, { compact }), [rows, compact]);
  const table = useMemo(() => {
    const at = new Map(rows.cells.map((c) => [`${c.x}|${c.y}`, c]));
    return {
      columns: ['노선', ...rows.grid.slots.map((t) => `${hhmm(new Date(t).toISOString())} 칸`)],
      rows: rows.names.map((name, y) => [name, ...rows.grid.slots.map((_, x) => {
        const c = at.get(`${x}|${y}`);
        return c ? `${Math.round(c.speed)} (${hhmm(c.dataAt)})` : '—';
      })]),
    };
  }, [rows]);
  const height = Math.max(rows.names.length, 4) * ROW + CHROME;

  return (
    <Card
      id="ins-heat" title="노선 × 시간 평균 속도" className="ins-heat" status={status}
      empty={rows.names.length === 0} height={12 * ROW + CHROME}
      note={<>기록이 많은 노선 {rows.names.length || 12}개 · 느린 노선부터 · 느릴수록 밝은 빨강</>}
    >
      <HeatLegend />
      <EChart option={option} height={height} ariaLabel="최근 24시간 노선별 평균 속도" table={table} />
    </Card>
  );
}
