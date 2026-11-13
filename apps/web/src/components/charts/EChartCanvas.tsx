'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 관제 왼쪽과 분석 페이지에서 쓰는 것만 등록한다.
echarts.use([
  LineChart, BarChart, HeatmapChart,
  GridComponent, TooltipComponent, VisualMapComponent, LegendComponent,
  CanvasRenderer,
]);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** ECharts 인스턴스 하나. 틀 크기를 따라 다시 그리고, 화면에서 빠지면 정리한다. */
export default function EChartCanvas({ option }: { option: EChartsCoreOption }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const node = el.current!;
    const c = echarts.init(node, null, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c || !el.current) return;
    // 캔버스 글자도 본문 글꼴(next/font 가 만든 이름)을 그대로 쓴다.
    const fontFamily = getComputedStyle(el.current).fontFamily;
    const base = option as { textStyle?: object };
    c.setOption(
      { ...option, textStyle: { ...base.textStyle, fontFamily }, ...(reducedMotion() ? { animation: false } : {}) },
      { notMerge: true },
    );
  }, [option]);

  return <div ref={el} className="echart-canvas" />;
}
