'use client';

import { useId, useState } from 'react';
import dynamic from 'next/dynamic';
import type { EChartsCoreOption } from 'echarts/core';

export type ChartTable = { columns: string[]; rows: (string | number)[][] };

// ECharts 는 차트가 화면에 놓일 때 따로 받아 온다. 지도 · 돌발 첫 화면 번들에는 들어가지 않는다.
const Canvas = dynamic(() => import('./EChartCanvas'), {
  ssr: false,
  loading: () => <div className="echart-canvas is-loading" />,
});

/**
 * 공통 차트 틀. 그림은 스크린 리더에 이름 하나로 읽히고, 같은 값을 "표로 보기"로 열어 볼 수 있다.
 */
export function EChart({ option, height, ariaLabel, table }: {
  option: EChartsCoreOption;
  height: number;
  ariaLabel: string;
  table: ChartTable;
}) {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  return (
    <div className="echart">
      <div className="echart-plot" role="img" aria-label={ariaLabel} style={{ height }}>
        <Canvas option={option} />
      </div>
      <button
        type="button" className="echart-toggle" aria-expanded={open} aria-controls={tableId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '표 닫기' : '표로 보기'}
      </button>
      {open && (
        <table id={tableId} className="echart-table">
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j}>{v}</td>))}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
