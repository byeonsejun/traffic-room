'use client';

import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { TrafficSummary } from '@traffic-room/shared';
import { hhmm } from '@/lib/time';
import { EChart } from './EChart';
import { chartTheme, lineKey, tooltipAbove, tooltipBase, tooltipRow } from './theme';

export type SpeedBucket = Pick<TrafficSummary, 'avgSpeed'> & { dataAt: string };

const HEIGHT = 56;

/**
 * 24시간 평균 속도 선. 선 하나 · y축 하나라 범례는 없고, 제목이 무엇을 그리는지 말한다.
 * 시간축이라 빠진 시각은 빈 간격 그대로 보인다. 마지막 점만 늘 찍고, 나머지 점은 마우스를 올릴 때만 뜬다.
 */
export function speedTrendOption(buckets: SpeedBucket[]): EChartsCoreOption {
  const last = buckets.length - 1;
  const { accent, surface, mute } = chartTheme;
  return {
    backgroundColor: chartTheme.background,
    grid: { left: 5, right: 5, top: 6, bottom: 5 },
    xAxis: { type: 'time', show: false },
    // 0부터 그리면 하루 변화가 납작해진다. 위아래로 조금 띄워 선이 틀에 닿지 않게 한다.
    yAxis: {
      type: 'value', show: false, scale: true,
      min: (v: { min: number }) => Math.floor(v.min - 3), max: (v: { max: number }) => Math.ceil(v.max + 2),
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      ...tooltipAbove,
      axisPointer: { type: 'line', lineStyle: { color: mute, width: 1, type: 'solid' }, animation: false },
      formatter: (ps: { value: [string, number] }[]) => {
        const [at, v] = ps[0]!.value;
        return tooltipRow(lineKey(accent), `${Math.round(v)} km/h`, `${hhmm(at)} 기준`);
      },
    },
    series: [{
      type: 'line',
      name: '평균 속도',
      showSymbol: true,
      showAllSymbol: true,
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 2, color: accent, cap: 'round', join: 'round' },
      itemStyle: { color: accent, borderColor: surface, borderWidth: 2 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(90, 169, 255, 0.2)' }, { offset: 1, color: 'rgba(90, 169, 255, 0)' }],
        },
      },
      emphasis: { scale: false, lineStyle: { width: 2 } },
      data: buckets.map((b, i) => (i === last
        ? { value: [b.dataAt, b.avgSpeed] }
        : { value: [b.dataAt, b.avgSpeed], itemStyle: { opacity: 0 }, emphasis: { itemStyle: { opacity: 1 } } })),
    }],
  };
}

const kstDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
/** 왼쪽 끝 시각. 마지막 기록과 날짜가 다르면 "어제"를 붙여 오른쪽 끝보다 이른 시각임을 분명히 한다. */
function rangeStart(buckets: SpeedBucket[]): string {
  const first = buckets[0]!.dataAt;
  const last = buckets[buckets.length - 1]!.dataAt;
  return kstDay(first) === kstDay(last) ? hhmm(first) : `어제 ${hhmm(first)}`;
}

export function SpeedTrend({ buckets }: { buckets: SpeedBucket[] }) {
  const option = useMemo(() => speedTrendOption(buckets), [buckets]);
  const table = useMemo(() => ({
    columns: ['시각', '평균 속도(km/h)'],
    rows: buckets.map((b) => [hhmm(b.dataAt), Math.round(b.avgSpeed)]),
  }), [buckets]);
  return (
    <div className="trend">
      <EChart option={option} height={HEIGHT} ariaLabel="최근 24시간 고속도로 평균 속도 추이" table={table} />
      <p className="trend-range" aria-hidden="true">
        <span>{rangeStart(buckets)}</span>
        <span>{hhmm(buckets[buckets.length - 1]!.dataAt)}</span>
      </p>
    </div>
  );
}
