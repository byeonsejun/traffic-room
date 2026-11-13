'use client';

import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { TrafficSummary } from '@traffic-room/shared';
import { EChart } from './EChart';
import { boxKey, chartTheme, formatCount, tooltipAbove, tooltipBase, tooltipRow } from './theme';

export type LevelCounts = Pick<TrafficSummary, 'ok' | 'slow' | 'jam'>;

const HEIGHT = 52;
const BAR = 22;
/** 칸 안에 비율 글자를 넣을 최소 몫. 이보다 좁으면 글자를 빼고 범례 · 툴팁 · 표가 값을 맡는다. */
const MIN_LABEL_SHARE = 0.12;

const pct = (n: number, total: number) => `${Math.round((n / total) * 100)}%`;

/**
 * 본선 구간을 원활 · 서행 · 정체로 나눈 막대 하나. 칸 사이는 2px 바탕색 틈으로 나누고,
 * 범례가 이름과 구간 수를, 넓은 칸은 안쪽에 비율을 보여 준다.
 */
export function levelBarOption(counts: LevelCounts): EChartsCoreOption {
  const levels = [
    { name: '원활', n: counts.ok, color: chartTheme.status.ok },
    { name: '서행', n: counts.slow, color: chartTheme.status.slow },
    { name: '정체', n: counts.jam, color: chartTheme.status.jam },
  ];
  const total = levels.reduce((s, l) => s + l.n, 0);
  const shown = levels.filter((l) => l.n > 0);
  const first = shown[0]?.name;
  const lastName = shown.at(-1)?.name;
  const byName = new Map(levels.map((l) => [l.name, l]));

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 0, right: 0, top: 0, height: BAR },
    xAxis: { type: 'value', show: false, max: Math.max(total, 1) },
    yAxis: { type: 'category', show: false, data: ['구간'] },
    legend: {
      left: 0, bottom: 0, padding: 0, itemGap: 14, itemWidth: 8, itemHeight: 8, icon: 'roundRect',
      selectedMode: false,
      textStyle: { color: chartTheme.text, fontSize: chartTheme.fontSize, padding: [0, 0, 0, -1] },
      formatter: (name: string) => `${name} ${formatCount(byName.get(name)?.n ?? 0)}`,
    },
    tooltip: {
      ...tooltipBase,
      ...tooltipAbove,
      trigger: 'item',
      formatter: (p: { seriesName: string; color: string }) => {
        const l = byName.get(p.seriesName)!;
        return tooltipRow(boxKey(l.color), `${formatCount(l.n)}구간`, `${l.name} · ${total ? pct(l.n, total) : '0%'}`);
      },
    },
    series: levels.map((l) => ({
      type: 'bar',
      name: l.name,
      stack: 'levels',
      barWidth: BAR,
      data: [l.n],
      itemStyle: {
        color: l.color,
        // 맞닿은 칸 사이 2px 틈. 테두리를 바탕색으로 칠해 선이 아니라 빈 틈처럼 보이게 한다.
        borderColor: chartTheme.surface, borderWidth: 1,
        borderRadius: [l.name === first ? 4 : 0, l.name === lastName ? 4 : 0, l.name === lastName ? 4 : 0, l.name === first ? 4 : 0],
      },
      emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
      label: {
        show: true, position: 'insideLeft', distance: 8,
        color: chartTheme.surface, fontSize: 11, fontWeight: 600,
        formatter: () => (total && l.n / total >= MIN_LABEL_SHARE ? pct(l.n, total) : ''),
      },
    })),
  };
}

export function LevelBar({ counts }: { counts: LevelCounts }) {
  const { ok, slow, jam } = counts;
  const option = useMemo(() => levelBarOption({ ok, slow, jam }), [ok, slow, jam]);
  const table = useMemo(() => {
    const total = ok + slow + jam;
    return {
      columns: ['상태', '구간 수', '비율'],
      rows: ([['원활', ok], ['서행', slow], ['정체', jam]] as const).map(([name, n]) =>
        [name, formatCount(n), total ? pct(n, total) : '0%']),
    };
  }, [ok, slow, jam]);
  return <EChart option={option} height={HEIGHT} ariaLabel="구간 상태별 구간 수" table={table} />;
}
