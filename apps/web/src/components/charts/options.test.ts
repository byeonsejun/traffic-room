import { describe, expect, test } from 'vitest';
import { chartTheme } from './theme';
import { levelBarOption } from './LevelBar';
import { speedTrendOption } from './SpeedTrend';

type AnyOption = Record<string, any>;

const bucket = (hour: number, avgSpeed: number) => ({
  dataAt: `2026-11-13T${String(hour).padStart(2, '0')}:00:00.000Z`,
  avgSpeed, ok: 10, slow: 5, jam: 1, jamKm: 3,
});

describe('speedTrendOption', () => {
  const buckets = [bucket(0, 88), bucket(1, 84.4), bucket(2, 61)];
  const o = speedTrendOption(buckets) as AnyOption;

  test('one line series with a point per bucket on a single y axis', () => {
    expect(o.series).toHaveLength(1);
    expect(o.series[0].type).toBe('line');
    expect(o.series[0].data).toHaveLength(buckets.length);
    expect([o.yAxis].flat()).toHaveLength(1);
  });

  test('hover reads every hour through an axis tooltip', () => {
    expect(o.tooltip.trigger).toBe('axis');
  });

  test('the latest point keeps a visible end dot, the others show only on hover', () => {
    const data = o.series[0].data as AnyOption[];
    expect(data.at(-1)!.value).toEqual([buckets[2]!.dataAt, 61]);
    expect(data.at(-1)!.itemStyle?.opacity).toBeUndefined();
    expect(data[0]!.itemStyle.opacity).toBe(0);
  });

  test('the background stays transparent and the line uses the accent, not a status color', () => {
    expect(o.backgroundColor).toBe('transparent');
    expect(o.series[0].lineStyle.color).toBe(chartTheme.accent);
  });
});

describe('levelBarOption', () => {
  const o = levelBarOption({ ok: 5610, slow: 2671, jam: 683 }) as AnyOption;

  test('three stacked segments in status token order', () => {
    expect(o.series.map((s: AnyOption) => s.name)).toEqual(['원활', '서행', '정체']);
    expect(o.series.map((s: AnyOption) => s.itemStyle.color)).toEqual([
      chartTheme.status.ok, chartTheme.status.slow, chartTheme.status.jam,
    ]);
    expect(new Set(o.series.map((s: AnyOption) => s.stack)).size).toBe(1);
  });

  test('the legend names each level with its link count', () => {
    expect(o.legend.formatter('원활')).toBe('원활 5,610');
    expect(o.legend.formatter('정체')).toBe('정체 683');
    expect(o.legend.textStyle.color).toBe(chartTheme.text);
  });

  test('a segment too thin for its share label prints none', () => {
    const label = (i: number) => o.series[i].label.formatter();
    expect(label(0)).toBe('63%');
    expect(label(2)).toBe('');
  });
});
