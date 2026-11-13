import { describe, expect, test } from 'vitest';
import {
  HEAT_COLORS, heatmapOption, heatRows, historyHours, incidentHoursOption, levelAreaOption, shortRoute, slotHourLabel,
  slowRoutesOption, yesterdayDelta,
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
  const rows = heatRows(routes, 60);
  const o = heatmapOption(rows) as AnyOption;

  test('twenty routes are cut to the twelve with the most records, slowest first', () => {
    expect(o.yAxis.data).toHaveLength(12);
    expect(o.yAxis.data[0]).toBe('노선00');
    expect(o.yAxis.data).not.toContain('노선12');
    expect([o.yAxis].flat()).toHaveLength(1);
  });

  test('one visual map from a near-neutral fast end to the brightest #FF4D4F for the slowest', () => {
    expect(HEAT_COLORS).toEqual(['#26374d', '#5f494c', '#a44c1d', '#d64740', '#ff4d4f']);
    expect([o.visualMap].flat()).toHaveLength(1);
    expect(o.visualMap.seriesIndex).toEqual([0, 1]);
    expect(o.visualMap.pieces.slice(0, 5).map((p: AnyOption) => p.color)).toEqual(HEAT_COLORS);
    // 기록 없는 칸(-1)은 색 단계가 아니라 패널색 조각으로 간다
    expect(o.visualMap.pieces[5]).toMatchObject({ lt: 0, label: '기록 없음' });
    expect(o.series[1].data.every((d: number[]) => d[2] === -1)).toBe(true);
    expect(o.visualMap.pieces[0].gte).toBe(85);
    expect(HEAT_COLORS.at(-1)).toBe('#ff4d4f');
  });

  test('no cell is invented: only recorded (route, slot) pairs are coloured; empty slots are a separate outline series', () => {
    const shown = new Set(o.yAxis.data as string[]);
    const recorded = routes.filter((r) => shown.has(r.route.replace('고속도로', ''))).length;
    expect(o.series[0].data).toHaveLength(recorded);
    expect(o.series[1].name).toBe('기록 없음');
    expect(o.series[0].data.length + o.series[1].data.length).toBe(12 * 24);
    // 11번 노선은 11시부터만 있다. 그 앞 칸은 기록 없음 칸이다.
    const row = (o.yAxis.data as string[]).indexOf('노선11');
    const cols = (o.series[0].data as number[][]).filter((d) => d[1] === row).map((d) => d[0]);
    expect(Math.min(...cols)).toBe(11);
    expect(o.series[1].itemStyle.borderColor).toBeDefined();
  });

  test('a collection gap stays an empty column instead of being closed up', () => {
    const gap = [at(0), at(1), at(4)].map((dataAt) => ({ dataAt, route: '경부고속도로', avgSpeed: 90 }));
    const g = heatmapOption(heatRows(gap, 60)) as AnyOption;
    expect(g.xAxis.data).toEqual([at(0), at(1), at(2), at(3), at(4)]);
    expect(g.series[0].data.map((d: number[]) => d[0])).toEqual([0, 1, 4]);
  });

  test('the cell tooltip names the full route, the record time and the speed', () => {
    const y = (o.yAxis.data as string[]).indexOf('노선11');
    const html = o.tooltip.formatter({ seriesIndex: 0, value: [11, y, 77.4] });
    expect(html).toContain('노선11고속도로');
    expect(html).toContain('20:00'); // 11시 UTC = 20시 KST
    expect(html).toContain(`${30 + 11 * 4 + 2} km/h`);
    expect(o.tooltip.formatter({ seriesIndex: 1, value: [0, y, 0] })).toContain('기록 없음');
  });

  test('route names are escaped before they reach tooltip HTML', () => {
    const bad = heatmapOption(heatRows([{ dataAt: at(0), route: '<img src=x>고속도로', avgSpeed: 50 }], 60)) as AnyOption;
    expect(bad.tooltip.formatter({ seriesIndex: 0, value: [0, 0, 50] })).not.toContain('<img');
  });
});

describe('time grid', () => {
  const t = (h: number, m: number) => new Date(T0 + h * H + m * 60_000).toISOString();
  const r = (dataAt: string, avgSpeed = 80) => ({ dataAt, route: '경부고속도로', avgSpeed });

  test(':45-only records land in their own clock hour, and the tooltip shows the record time', () => {
    const rows = heatRows([r(t(0, 45)), r(t(1, 45)), r(t(2, 45))], 60);
    expect(rows.grid.slots.map((s) => new Date(s).toISOString())).toEqual([at(0), at(1), at(2)]);
    expect(rows.cells.map((c) => c.x)).toEqual([0, 1, 2]);
    const o = heatmapOption(rows) as AnyOption;
    expect(o.tooltip.formatter({ seriesIndex: 0, value: [1, 0, 80] })).toContain('10:45'); // 01:45 UTC
  });

  test('mixed :00 and :45 in one slot keep the newer record', () => {
    const rows = heatRows([r(t(0, 0), 50), r(t(0, 45), 90), r(t(1, 0), 70)], 60);
    expect(rows.cells).toEqual([
      { x: 0, y: 0, speed: 90, dataAt: t(0, 45) },
      { x: 1, y: 0, speed: 70, dataAt: t(1, 0) },
    ]);
  });

  test('axis labels go on the slot that contains a KST hour divisible by 3, even off the hour', () => {
    // 23:45 UTC = 08:45 KST 칸(60분)은 09시를 품는다
    expect(slotHourLabel(T0 - 15 * 60_000, 60)).toBe('09시');
    expect(slotHourLabel(T0, 60)).toBe('09시'); // 00:00 UTC = 09:00 KST
    expect(slotHourLabel(T0 + H, 60)).toBeNull();
    expect(slotHourLabel(T0 + 15 * 60_000, 15)).toBeNull(); // 09:15 칸
  });

  test('historyHours counts slots, not records', () => {
    expect(historyHours([t(0, 0), t(0, 45), t(1, 0)].map((dataAt) => ({ dataAt })), 60)).toBe(2);
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
  const o = levelAreaOption([bucket(0), bucket(1, 70, { ok: 40, slow: 40, jam: 20 }), bucket(2)], 60) as AnyOption;

  test('three stacked series from jam up to flow on one 0–100% axis', () => {
    expect(o.series.map((s: AnyOption) => s.name)).toEqual(['정체', '서행', '원활']);
    expect(new Set(o.series.map((s: AnyOption) => s.stack)).size).toBe(1);
    expect([o.yAxis].flat()).toHaveLength(1);
    expect(o.yAxis.min).toBe(0);
    expect(o.yAxis.max).toBe(100);
    expect(o.series[0].data[1]).toEqual([1, 20]);
  });

  test('a crosshair tooltip and a legend for the three series', () => {
    expect(o.tooltip.trigger).toBe('axis');
    expect(o.legend.data).toEqual(['원활', '서행', '정체']);
    expect(o.tooltip.formatter([{ value: [1, 20] }])).toContain('10:00');
  });

  test('a gap longer than 1.5 × interval breaks the area', () => {
    const g = levelAreaOption([bucket(0), bucket(1), bucket(4)], 60) as AnyOption;
    expect(g.series[0].data).toEqual([[0, 10], [1, 10], [2, null], [4, 10]]);
  });

  test('a 45-then-75-minute spacing stays joined', () => {
    const b = (min: number) => ({ ...bucket(0), dataAt: new Date(T0 + min * 60_000).toISOString() });
    const g = levelAreaOption([b(0), b(45), b(120)], 60) as AnyOption;
    // 0분과 45분은 같은 칸(더 새 45분), 다음 기록은 75분 뒤 → 빈 점 없이 잇는다
    expect(g.series[0].data).toEqual([[0, 10], [2, 10]]);
  });
});

describe('incidentHoursOption', () => {
  const now = new Date(T0 + 23.5 * H);
  const o = incidentHoursOption([
    { hour: at(20), total: 3, byCategory: { accident: 1, breakdown: 2, weather: 0, construction: 0, report: 0, other: 0 } },
  ], now, 0) as AnyOption;

  test('24 hourly columns ending at the current hour; hours without incidents are zero', () => {
    expect(o.xAxis.data).toHaveLength(24);
    expect(o.xAxis.data.at(-1)).toBe(at(23));
    expect(o.series[0].data.filter((d: AnyOption) => d.value > 0)).toHaveLength(1);
  });

  test('with a delay the axis ends at the hour of now − delay, like the traffic charts', () => {
    const d = incidentHoursOption([], new Date(T0 + 23.5 * H), 60) as AnyOption;
    expect(d.xAxis.data).toHaveLength(24);
    expect(d.xAxis.data.at(-1)).toBe(at(22));
    expect(d.xAxis.data[0]).toBe(at(-1));
  });

  test('the bar tooltip lists the count by type', () => {
    const html = o.tooltip.formatter({ dataIndex: 20 });
    expect(html).toContain('3건');
    expect(html).toContain('교통사고');
    expect(html).toContain('고장·낙하물');
    expect(html).not.toContain('공사');
  });
});
