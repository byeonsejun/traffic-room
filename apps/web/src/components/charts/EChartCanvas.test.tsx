import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// 진짜 ECharts 대신 인스턴스가 받은 호출만 남긴다.
const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
const init = vi.hoisted(() => vi.fn(() => chart));
vi.mock('echarts/core', () => ({ init, use: vi.fn() }));
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, HeatmapChart: {} }));
vi.mock('echarts/components', () => ({
  GridComponent: {}, TooltipComponent: {}, VisualMapComponent: {}, LegendComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import EChartCanvas from './EChartCanvas';

const observers: { cb: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    observers.push(this);
  }
}

beforeEach(() => {
  observers.length = 0;
  init.mockClear();
  Object.values(chart).forEach((f) => f.mockClear());
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('one instance per mount; every option replaces the last one whole', () => {
  const first = { series: [{ type: 'line', data: [1] }] };
  const { rerender } = render(<EChartCanvas option={first} />);
  expect(init).toHaveBeenCalledTimes(1);
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ series: first.series }), { notMerge: true });

  const next = { series: [{ type: 'bar', data: [2] }] };
  rerender(<EChartCanvas option={next} />);
  expect(init).toHaveBeenCalledTimes(1);
  expect(chart.setOption).toHaveBeenCalledTimes(2);
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ series: next.series }), { notMerge: true });
});

test('follows the frame size and cleans up when it leaves the screen', () => {
  const { unmount } = render(<EChartCanvas option={{}} />);
  expect(observers).toHaveLength(1);
  expect(observers[0]!.observe).toHaveBeenCalledWith(document.querySelector('.echart-canvas'));
  observers[0]!.cb();
  expect(chart.resize).toHaveBeenCalled();

  unmount();
  expect(observers[0]!.disconnect).toHaveBeenCalled();
  expect(chart.dispose).toHaveBeenCalled();
});

test('reduced motion turns animation off', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
  render(<EChartCanvas option={{}} />);
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ animation: false }), { notMerge: true });
});
