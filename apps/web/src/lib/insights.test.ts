import { describe, expect, test } from 'vitest';
import {
  HEAT_COLORS, heatmapOption, historyHours, incidentHoursOption, levelAreaOption, shortRoute, slowRoutesOption,
  yesterdayDelta,
} from './insights';
import { chartTheme } from '@/components/charts/theme';

type AnyOption = Record<string, any>;

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 12, 0);
const at = (h: number) => new Date(T0 + h * H).toISOString();
const bucket = (h: number, avgSpeed = 80, levels = { ok: 60, slow: 30, jam: 10 }) => ({
  dataAt: at(h), avgSpeed, ...levels, jamKm: 12,
});

describe('historyHours', () => {
  test('nine hourly buckets cover nine hours', () => {
    expect(historyHours(Array.from({ length: 9 }, (_, h) => bucket(h)), 60)).toBe(9);
  });

  test('at 15-minute intervals the bucket count is not the hour count', () => {
    const quarter = Array.from({ length: 36 }, (_, i) => ({ ...bucket(0), dataAt: new Date(T0 + i * 15 * 60_000).toISOString() }));
    expect(historyHours(quarter, 15)).toBe(9);
  });

  test('older buckets beyond the 24-hour window do not count, and it caps at 24', () => {
    const day = Array.from({ length: 26 }, (_, h) => bucket(h));
    expect(historyHours(day, 60)).toBe(24);
    expect(historyHours([], 60)).toBe(0);
  });
});

describe('yesterdayDelta', () => {
  test('null when no bucket sits 24 hours before', () => {
    const nine = Array.from({ length: 9 }, (_, h) => bucket(h, 80));
    expect(yesterdayDelta(nine, new Date(at(8)))).toBeNull();
  });

  test('the speed difference against the bucket 24 hours earlier', () => {
    const day = Array.from({ length: 25 }, (_, h) => bucket(h, h === 0 ? 78 : 84.6));
    expect(yesterdayDelta(day, new Date(at(24)))).toBe(7);
  });

  test('a bucket further than half an interval away does not count as the same time', () => {
    const shifted = [{ ...bucket(0), dataAt: new Date(T0 - 31 * 60_000).toISOString() }, bucket(24)];
    expect(yesterdayDelta(shifted, new Date(at(24)), 60)).toBeNull();
  });
});

describe('shortRoute', () => {
  test('drops the 고속도로 suffix and keeps names without it', () => {
    expect(shortRoute('경부고속도로')).toBe('경부');
    expect(shortRoute('수도권제1순환고속도로')).toBe('수도권제1순환');
    expect(shortRoute('고속도로')).toBe('고속도로');
  });
});

/** 노선 n개, 24시간. 처음 노선일수록 기록이 많고 0번 노선이 가장 느리다. */
const routeSet = (n: number) => {
  const rows: { dataAt: string; route: string; avgSpeed: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let h = 0; h < 24; h++) {
      if (h < r) continue; // 뒤 노선일수록 기록 수가 적다
      rows.push({ dataAt: at(h), route: `노선${String(r).padStart(2, '0')}고속도로`, avgSpeed: 30 + r * 4 + (h % 3) });
    }
  }
  return rows;
};

describe('heatmapOption', () => {
  const routes = routeSet(20);
  const o = heatmapOption(routes) as AnyOption;

  test('twenty routes are cut to the twelve with the most records, slowest first', () => {
    expect(o.yAxis.data).toHaveLength(12);
    expect(o.yAxis.data[0]).toBe('노선00');
    expect(o.yAxis.data).not.toContain('노선12');
    expect([o.yAxis].flat()).toHaveLength(1);
  });

  test('one visual map in a single validated hue family ending at the flow green', () => {
    expect([o.visualMap].flat()).toHaveLength(1);
    expect(o.visualMap.pieces.map((p: AnyOption) => p.color)).toEqual(HEAT_COLORS);
    expect(HEAT_COLORS.at(-1)).toBe('#2bd47d');
    expect(o.visualMap.textStyle.color).toBe(chartTheme.text);
  });

  test('no cell is invented: only recorded (route, hour) pairs become data', () => {
    const shown = new Set(o.yAxis.data as string[]);
    const recorded = routes.filter((r) => shown.has(r.route.replace('고속도로', ''))).length;
    expect(o.series[0].data).toHaveLength(recorded);
    // 11번 노선은 11시부터만 있다. 그 앞 칸은 비어 있다.
    const row = (o.yAxis.data as string[]).indexOf('노선11');
    const cols = (o.series[0].data as number[][]).filter((d) => d[1] === row).map((d) => d[0]);
    expect(Math.min(...cols)).toBe(11);
  });

  test('a collection gap stays an empty column instead of being closed up', () => {
    const gap = [at(0), at(1), at(4)].map((dataAt) => ({ dataAt, route: '경부고속도로', avgSpeed: 90 }));
    const g = heatmapOption(gap) as AnyOption;
    expect(g.xAxis.data).toEqual([at(0), at(1), at(2), at(3), at(4)]);
    expect(g.series[0].data.map((d: number[]) => d[0])).toEqual([0, 1, 4]);
  });

  test('the cell tooltip names the full route, the time and the speed', () => {
    const html = o.tooltip.formatter({ value: [11, (o.yAxis.data as string[]).indexOf('노선11'), 77.4], color: '#000' });
    expect(html).toContain('노선11고속도로');
    expect(html).toContain('20:00'); // 11시 UTC = 20시 KST
    expect(html).toContain('77 km/h');
  });

  test('route names are escaped before they reach tooltip HTML', () => {
    const bad = heatmapOption([{ dataAt: at(0), route: '<img src=x>고속도로', avgSpeed: 50 }]) as AnyOption;
    expect(bad.tooltip.formatter({ value: [0, 0, 50] })).not.toContain('<img');
  });
});

describe('slowRoutesOption', () => {
  const routes = routeSet(12);
  const o = slowRoutesOption(routes) as AnyOption;
  const data = o.series[0].data as AnyOption[];

  test('seven routes from the latest time, slowest first', () => {
    expect(data).toHaveLength(7);
    const v = data.map((d) => d.value);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(o.yAxis.data[0]).toBe('노선00');
    expect([o.yAxis].flat()).toHaveLength(1);
  });

  test('bars wear the status color for their speed', () => {
    expect(data[0]!.itemStyle.color).toBe(chartTheme.status.jam); // 30 + 23 % 3 = 32
    expect(data.at(-1)!.itemStyle.color).toBe(chartTheme.status.slow); // 노선06: 54 + 2
  });
});

describe('levelAreaOption', () => {
  const o = levelAreaOption([bucket(0), bucket(1, 70, { ok: 40, slow: 40, jam: 20 }), bucket(2)]) as AnyOption;

  test('three stacked series from jam up to flow on one 0–100% axis', () => {
    expect(o.series.map((s: AnyOption) => s.name)).toEqual(['정체', '서행', '원활']);
    expect(new Set(o.series.map((s: AnyOption) => s.stack)).size).toBe(1);
    expect([o.yAxis].flat()).toHaveLength(1);
    expect(o.yAxis.min).toBe(0);
    expect(o.yAxis.max).toBe(100);
    expect(o.series[0].data[1]).toEqual([at(1), 20]);
  });

  test('a crosshair tooltip and a legend for the three series', () => {
    expect(o.tooltip.trigger).toBe('axis');
    expect(o.legend.data).toEqual(['원활', '서행', '정체']);
  });

  test('a missing hour breaks the area instead of bridging it', () => {
    const g = levelAreaOption([bucket(0), bucket(1), bucket(4)]) as AnyOption;
    expect(g.series[0].data.map((d: unknown[]) => d[1])).toEqual([10, 10, null, 10]);
  });
});

describe('incidentHoursOption', () => {
  const now = new Date(T0 + 23.5 * H);
  const o = incidentHoursOption([
    { hour: at(20), total: 3, byCategory: { accident: 1, breakdown: 2, weather: 0, construction: 0, report: 0, other: 0 } },
  ], now) as AnyOption;

  test('24 hourly columns ending at the current hour; hours without incidents are zero', () => {
    expect(o.xAxis.data).toHaveLength(24);
    expect(o.xAxis.data.at(-1)).toBe(at(23));
    expect(o.series[0].data.filter((d: AnyOption) => d.value > 0)).toHaveLength(1);
  });

  test('the bar tooltip lists the count by type', () => {
    const html = o.tooltip.formatter({ dataIndex: 20 });
    expect(html).toContain('3건');
    expect(html).toContain('교통사고');
    expect(html).toContain('고장·낙하물');
    expect(html).not.toContain('공사');
  });
});
