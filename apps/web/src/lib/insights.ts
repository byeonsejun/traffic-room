import type { EChartsCoreOption } from 'echarts/core';
import type { Insights } from '@traffic-room/db';
import { speedLevel, type Category } from '@traffic-room/shared';
import { boxKey, chartTheme, formatCount, lineKey, tooltipBase, tooltipRow } from '@/components/charts/theme';
import { hhmm } from './time';
import { CATEGORY_LABEL, categoryColor, tokens } from './tokens';

export type TrafficBucket = Insights['buckets'][number];
export type RouteBucket = Insights['routes'][number];
export type IncidentHour = Insights['incidentsByHour'][number];

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 분석 화면이 다루는 기간. 기록이 이만큼 차야 "어제 같은 시각" 비교가 생긴다. */
export const HISTORY_HOURS = 24;
const WINDOW = HISTORY_HOURS * HOUR;

const ms = (iso: string) => new Date(iso).getTime();
const latestMs = (rows: { dataAt: string }[]) => rows.reduce((m, r) => Math.max(m, ms(r.dataAt)), -Infinity);
/** 마지막 기록에서 24시간 안쪽만. API 는 경계 여유로 26시간을 준다. */
const inWindow = <T extends { dataAt: string }>(rows: T[]): T[] => {
  const last = latestMs(rows);
  return rows.filter((r) => ms(r.dataAt) > last - WINDOW);
};

/** 기록이 덮는 시간(0~24). 버킷 수가 아니라 버킷 수 × 수집 간격으로 센다. */
export function historyHours(buckets: { dataAt: string }[], intervalMinutes: number): number {
  const n = inWindow(buckets).length;
  return Math.min(HISTORY_HOURS, Math.ceil((n * intervalMinutes) / 60));
}

/**
 * `now` 시각 버킷의 평균 속도와 24시간 전 버킷의 차이(km/h, 반올림).
 * 두 시각 모두 수집 간격의 절반 안쪽에 버킷이 있어야 하고, 하나라도 없으면 비교하지 않는다.
 */
export function yesterdayDelta(buckets: TrafficBucket[], now: Date, intervalMinutes = 60): number | null {
  const near = (t: number) => buckets.find((b) => Math.abs(ms(b.dataAt) - t) <= (intervalMinutes * MIN) / 2);
  const today = near(now.getTime());
  const yesterday = near(now.getTime() - WINDOW);
  if (!today || !yesterday) return null;
  return Math.round(today.avgSpeed - yesterday.avgSpeed);
}

/** 좁은 축 라벨용 노선 이름. "경부고속도로" → "경부". 전체 이름은 툴팁과 표에 남긴다. */
export const shortRoute = (name: string) => name.replace(/고속도로/, '').trim() || name;

/** 노선 이름은 원천 API 에서 온 글자라 툴팁 HTML 에 넣기 전에 바꾼다. */
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 기록 시각들의 간격. 가장 짧은 간격을 수집 간격으로 본다(빠진 회차는 그보다 길다).
 * 기록이 하나뿐이면 1시간으로 둔다.
 */
function stepOf(times: number[]): number {
  let step = Infinity;
  for (let i = 1; i < times.length; i++) step = Math.min(step, times[i]! - times[i - 1]!);
  return Number.isFinite(step) && step >= 5 * MIN ? step : HOUR;
}
const sortedTimes = (rows: { dataAt: string }[]) => [...new Set(rows.map((r) => ms(r.dataAt)))].sort((a, b) => a - b);

/** 처음부터 끝까지 간격마다 한 칸. 수집이 빠진 회차도 칸으로 남아 빈 채로 보인다. */
function timeSlots(rows: { dataAt: string }[]): { slots: number[]; step: number } {
  const times = sortedTimes(rows);
  if (!times.length) return { slots: [], step: HOUR };
  const step = stepOf(times);
  const n = Math.min(Math.round((times.at(-1)! - times[0]!) / step) + 1, Math.ceil(WINDOW / step) + 1);
  return { slots: Array.from({ length: n }, (_, i) => times[0]! + i * step), step };
}

const kstHour = (t: number) => (new Date(t).getUTCHours() + 9) % 24;
const onTheHour = (t: number) => new Date(t).getUTCMinutes() === 0;

const axisText = { color: chartTheme.mute, fontSize: 11 };
const hairline = { lineStyle: { color: tokens.line, width: 1, type: 'solid' as const } };

// ---------------------------------------------------------------- 노선 × 시간

/**
 * 히트맵 색. #2BD47D 와 같은 색상(OKLCH h 154)에서 밝기만 다섯 단계로 내렸다.
 * 어두울수록 느리다. dataviz validate_palette.js --ordinal --mode dark --surface #111B28 로 확인:
 * 밝기 단조 · 이웃 단계 ΔL ≥ 0.06 · 가장 어두운 칸도 패널과 2.13:1 · 색상 차 1°.
 */
export const HEAT_COLORS = ['#1f5a37', '#227748', '#259558', '#24b46a', '#2bd47d'] as const;
/** 단계 경계. 40 · 70 은 정체 · 서행 · 원활 경계와 같고, 사이를 15km/h 씩 나눴다. */
const HEAT_PIECES = [
  { lt: 40, label: '40 미만' },
  { gte: 40, lt: 55, label: '40–55' },
  { gte: 55, lt: 70, label: '55–70' },
  { gte: 70, lt: 85, label: '70–85' },
  { gte: 85, label: '85 이상' },
].map((p, i) => ({ ...p, color: HEAT_COLORS[i] }));

/** names: 위에서부터 노선, slots: 칸 시각, cells: [칸 번호, 노선 번호, 속도] — 기록 있는 칸만. */
export type HeatRows = { names: string[]; slots: number[]; cells: [number, number, number][] };

/**
 * 히트맵에 올릴 노선과 칸. 노선은 최근 24시간 기록 수가 많은 순으로 topN 개(같으면 이름순),
 * 화면에는 24시간 평균이 느린 노선부터 위에 놓는다. 기록이 없는 칸은 만들지 않는다.
 */
export function heatRows(routes: RouteBucket[], topN = 12): HeatRows {
  const recent = inWindow(routes);
  const stats = new Map<string, { n: number; sum: number }>();
  for (const r of recent) {
    const s = stats.get(r.route) ?? { n: 0, sum: 0 };
    s.n += 1;
    s.sum += r.avgSpeed;
    stats.set(r.route, s);
  }
  const names = [...stats.entries()]
    .sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b, 'ko'))
    .slice(0, topN)
    .sort(([, x], [, y]) => x.sum / x.n - y.sum / y.n)
    .map(([name]) => name);
  const row = new Map(names.map((n, i) => [n, i]));
  const { slots, step } = timeSlots(recent);
  const cells: [number, number, number][] = [];
  for (const r of recent) {
    const y = row.get(r.route);
    // 수집 시각이 몇 초 어긋나도 가장 가까운 칸에 놓는다.
    if (y !== undefined) cells.push([Math.round((ms(r.dataAt) - slots[0]!) / step), y, r.avgSpeed]);
  }
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { names, slots, cells };
}

/** compact: 좁은 화면(폰). 범례를 줄이고 시각 라벨을 6시간마다 둔다. */
export function heatmapOption(routes: RouteBucket[], topN = 12, { compact = false } = {}): EChartsCoreOption {
  const { names, slots, cells: data } = heatRows(routes, topN);
  const colorFor = (v: number) => HEAT_PIECES.find((p) => (p.lt === undefined || v < p.lt) && (p.gte === undefined || v >= p.gte))!.color;
  // 칸이 좁아지면(15분 간격) 시각 라벨은 3시간마다(좁은 화면은 6시간마다) 하나.
  const labelEvery = (t: number) => onTheHour(t) && kstHour(t) % (compact ? 6 : 3) === 0;

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 8, top: 34, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: slots.map((t) => new Date(t).toISOString()),
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: {
        ...axisText,
        interval: (i: number) => labelEvery(slots[i]!),
        formatter: (iso: string) => `${String(kstHour(ms(iso))).padStart(2, '0')}시`,
      },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: names.map(shortRoute),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.text, fontSize: 12, margin: 10 },
    },
    visualMap: {
      type: 'piecewise',
      dimension: 2,
      pieces: HEAT_PIECES,
      orient: 'horizontal',
      left: 0,
      top: 0,
      itemWidth: compact ? 10 : 14,
      itemHeight: 10,
      itemGap: compact ? 8 : 14,
      itemSymbol: 'roundRect',
      textGap: compact ? 3 : 5,
      textStyle: { color: chartTheme.text, fontSize: compact ? 10 : 11 },
      // 단계를 눌러 끄면 그 칸들은 선 색으로 물러난다.
      outOfRange: { color: tokens.line },
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: { value: [number, number, number] }) => {
        const [x, y, v] = p.value;
        const route = escapeHtml(names[y] ?? '');
        return `<div style="color:${tokens.mute};margin-bottom:4px">${route} · ${hhmm(new Date(slots[x]!).toISOString())}</div>` +
          tooltipRow(boxKey(colorFor(v)), `${Math.round(v)} km/h`, LEVEL_LABEL[speedLevel(v)]);
      },
    },
    series: [{
      type: 'heatmap',
      name: '노선 평균 속도',
      data,
      progressive: 0,
      // 칸 사이 2px 패널색 틈. 테두리가 아니라 빈 틈으로 보인다.
      itemStyle: { borderColor: tokens.panel, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: tokens.ink, borderWidth: 1.5 } },
    }],
  };
}

// ---------------------------------------------------------------- 느린 노선

const LEVEL_LABEL = { ok: '원활', slow: '서행', jam: '정체' } as const;
const levelColor = (v: number) => chartTheme.status[speedLevel(v)];

/** 가장 최근 기록 시각의 노선 평균 속도에서 느린 n개, 느린 것부터. */
export function slowRoutes(routes: RouteBucket[], n = 7): RouteBucket[] {
  const last = latestMs(routes);
  return routes.filter((r) => ms(r.dataAt) === last).sort((a, b) => a.avgSpeed - b.avgSpeed).slice(0, n);
}

export function slowRoutesOption(routes: RouteBucket[], n = 7): EChartsCoreOption {
  const rows = slowRoutes(routes, n);
  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 64, top: 0, bottom: 0, containLabel: true },
    xAxis: { type: 'value', show: false, min: 0, max: (v: { max: number }) => Math.max(100, v.max) },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => shortRoute(r.route)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.text, fontSize: 12, margin: 12 },
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex]!;
        return `<div style="color:${tokens.mute};margin-bottom:4px">${escapeHtml(r.route)} · ${hhmm(r.dataAt)} 기준</div>` +
          tooltipRow(boxKey(levelColor(r.avgSpeed)), `${Math.round(r.avgSpeed)} km/h`, LEVEL_LABEL[speedLevel(r.avgSpeed)]);
      },
    },
    series: [{
      type: 'bar',
      name: '노선 평균 속도',
      barWidth: 12,
      // 막대 뒤 옅은 바탕: 100km/h 까지의 자리를 보여 줘 짧은 막대가 얼마나 짧은지 읽힌다.
      showBackground: true,
      backgroundStyle: { color: 'rgba(124, 138, 155, 0.08)', borderRadius: 4 },
      data: rows.map((r) => ({
        value: r.avgSpeed,
        itemStyle: { color: levelColor(r.avgSpeed), borderRadius: [0, 4, 4, 0] },
      })),
      label: {
        show: true,
        position: 'right',
        distance: 10,
        color: chartTheme.text,
        fontSize: 12,
        formatter: (p: { value: number }) => `${Math.round(p.value)} km/h`,
      },
      emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
    }],
  };
}

// ---------------------------------------------------------------- 상태 비율 추이

// 면 진하기: 넓게 깔리는 원활은 옅게, 얇은 정체 · 서행 띠는 진하게 해 눈이 문제 구간으로 가게 한다.
const LEVELS = [
  { key: 'jam', name: '정체', color: chartTheme.status.jam, fill: 0.5 },
  { key: 'slow', name: '서행', color: chartTheme.status.slow, fill: 0.36 },
  { key: 'ok', name: '원활', color: chartTheme.status.ok, fill: 0.12 },
] as const;

const share = (b: TrafficBucket, key: 'ok' | 'slow' | 'jam') => {
  const total = b.ok + b.slow + b.jam;
  return total ? Math.round((b[key] / total) * 1000) / 10 : 0;
};

/**
 * 24시간 원활 · 서행 · 정체 구간 비율을 아래에서부터 정체 → 서행 → 원활로 쌓는다.
 * 수집이 빠진 회차에는 빈 점을 넣어 면이 이어 붙지 않게 한다.
 */
export function levelAreaOption(buckets: TrafficBucket[]): EChartsCoreOption {
  const rows = inWindow(buckets).sort((a, b) => ms(a.dataAt) - ms(b.dataAt));
  const step = stepOf(sortedTimes(rows));
  const byTime = new Map(rows.map((b) => [b.dataAt, b]));
  const points = (key: 'ok' | 'slow' | 'jam') => {
    const out: [string, number | null][] = [];
    rows.forEach((b, i) => {
      if (i > 0 && ms(b.dataAt) - ms(rows[i - 1]!.dataAt) > step * 1.5) {
        out.push([new Date(ms(rows[i - 1]!.dataAt) + step).toISOString(), null]);
      }
      out.push([b.dataAt, share(b, key)]);
    });
    return out;
  };

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 12, top: 40, bottom: 4, containLabel: true },
    legend: {
      data: [...LEVELS].reverse().map((l) => l.name),
      left: 0, top: 0, padding: 0, itemGap: 16, itemWidth: 10, itemHeight: 10, icon: 'roundRect',
      selectedMode: false,
      textStyle: { color: chartTheme.text, fontSize: 12 },
    },
    xAxis: {
      type: 'time',
      axisLine: hairline,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...axisText, formatter: (t: number) => `${String(kstHour(t)).padStart(2, '0')}시`, hideOverlap: true },
      minInterval: 3 * HOUR,
    },
    yAxis: {
      type: 'value', min: 0, max: 100, interval: 25,
      axisLabel: { ...axisText, formatter: '{value}%' },
      splitLine: hairline,
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: tokens.ink, width: 1, type: 'solid', opacity: 0.5 }, animation: false },
      formatter: (ps: { axisValue: number; value: [string, number | null] }[]) => {
        const b = byTime.get(ps[0]?.value[0] ?? '');
        if (!b) return '';
        const head = `<div style="color:${tokens.mute};margin-bottom:4px">${hhmm(b.dataAt)} · 본선 ${formatCount(b.ok + b.slow + b.jam)}구간</div>`;
        return head + [...LEVELS].reverse()
          .map((l) => tooltipRow(boxKey(l.color), `${share(b, l.key)}%`, `${l.name} ${formatCount(b[l.key])}구간`)).join('');
      },
    },
    series: LEVELS.map((l) => ({
      type: 'line',
      name: l.name,
      stack: 'levels',
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1.5, color: l.color },
      itemStyle: { color: l.color },
      areaStyle: { color: l.color, opacity: l.fill },
      emphasis: { disabled: true },
      data: points(l.key),
    })),
  };
}

// ---------------------------------------------------------------- 시간대별 돌발

/** `now` 가 속한 시각까지 거슬러 24시간, 1시간 칸. 상황이 없던 시각은 0건이다(지어낸 값이 아니라 센 결과). */
export function incidentHours(incidentsByHour: IncidentHour[], now: Date): { hour: string; total: number; byCategory: IncidentHour['byCategory'] | null }[] {
  const end = Math.floor(now.getTime() / HOUR) * HOUR;
  const byHour = new Map(incidentsByHour.map((h) => [ms(h.hour), h]));
  return Array.from({ length: HISTORY_HOURS }, (_, i) => {
    const t = end - (HISTORY_HOURS - 1 - i) * HOUR;
    const h = byHour.get(t);
    return { hour: new Date(t).toISOString(), total: h?.total ?? 0, byCategory: h?.byCategory ?? null };
  });
}

export function incidentHoursOption(incidentsByHour: IncidentHour[], now: Date): EChartsCoreOption {
  const hours = incidentHours(incidentsByHour, now);
  const max = Math.max(0, ...hours.map((h) => h.total));
  const peak = max > 0 ? hours.findIndex((h) => h.total === max) : -1;
  const hh = (t: number) => String(kstHour(t)).padStart(2, '0');

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 4, top: 22, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: hours.map((h) => h.hour),
      axisLine: hairline,
      axisTick: { show: false },
      axisLabel: { ...axisText, interval: (i: number) => kstHour(ms(hours[i]!.hour)) % 3 === 0, formatter: (iso: string) => `${hh(ms(iso))}시` },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: axisText,
      splitLine: hairline,
    },
    // 막대가 낮아도 맞히기 쉽게, 그 시각 칸 전체가 툴팁 자리다.
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(124, 138, 155, 0.08)' } },
      formatter: (ps: { dataIndex: number } | { dataIndex: number }[]) => {
        const h = hours[[ps].flat()[0]!.dataIndex]!;
        const t = ms(h.hour);
        const head = `<div style="color:${tokens.mute};margin-bottom:4px">${hh(t)}:00–${hh(t + HOUR)}:00 발생</div>`;
        const rows = h.byCategory
          ? (Object.entries(h.byCategory) as [Category, number][]).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
            .map(([c, n]) => tooltipRow(boxKey(categoryColor(c)), `${n}건`, CATEGORY_LABEL[c])).join('')
          : '';
        return head + tooltipRow(lineKey(chartTheme.accent), `${h.total}건`, '전체') + rows;
      },
    },
    series: [{
      type: 'bar',
      name: '돌발 발생',
      barMaxWidth: 18,
      itemStyle: { color: chartTheme.accent, borderRadius: [4, 4, 0, 0] },
      emphasis: { itemStyle: { color: '#7dbcff' } },
      // 숫자는 가장 많은 시각 하나에만. 나머지는 축 · 툴팁 · 표가 맡는다.
      data: hours.map((h, i) => ({
        value: h.total,
        label: i === peak ? { show: true, position: 'top', color: chartTheme.text, fontSize: 12, formatter: `${h.total}건` } : undefined,
      })),
    }],
  };
}
