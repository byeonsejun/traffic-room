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
/** 축 라벨 간격. 히트맵 · 상태 비율 · 돌발 차트가 모두 3시간마다 시각을 적는다. */
const LABEL_HOURS = 3;

const ms = (iso: string) => new Date(iso).getTime();
const latestMs = (rows: { dataAt: string }[]) => rows.reduce((m, r) => Math.max(m, ms(r.dataAt)), -Infinity);
/** 마지막 기록에서 24시간 안쪽만, 시각 순. API 는 경계 여유로 26시간을 준다. */
const inWindow = <T extends { dataAt: string }>(rows: T[]): T[] => {
  const last = latestMs(rows);
  return rows.filter((r) => ms(r.dataAt) > last - WINDOW).sort((a, b) => ms(a.dataAt) - ms(b.dataAt));
};

// ---------------------------------------------------------------- 시간 칸

/**
 * 수집 간격으로 나눈 시계 칸. 칸 번호는 floor(시각 / 간격)이다. 한국 시각은 UTC 에서 9시간(간격의 배수)
 * 떨어져 있어, 같은 식이 한국 시계의 00:00 · 00:15 … 경계와 맞는다. 기록이 정각에 오지 않아도(:45 등) 제 칸에 들어간다.
 */
export const slotOf = (t: number, intervalMinutes: number) => Math.floor(t / (intervalMinutes * MIN));
const slotStart = (slot: number, intervalMinutes: number) => slot * intervalMinutes * MIN;

export type TimeGrid = {
  intervalMinutes: number;
  /** 칸 시작 시각(ms), 처음 기록의 칸부터 마지막 기록의 칸까지 빠짐없이 */
  slots: number[];
  /** 시각 → 칸 차례(0부터). 그리드 밖이면 -1 */
  indexOf(t: number): number;
};

/** 기록이 있는 처음 칸부터 마지막 칸까지. 수집이 빠진 칸도 자리를 남겨 빈 채로 보인다. */
export function timeGrid(times: number[], intervalMinutes: number): TimeGrid {
  if (!times.length) return { intervalMinutes, slots: [], indexOf: () => -1 };
  const first = slotOf(Math.min(...times), intervalMinutes);
  const last = slotOf(Math.max(...times), intervalMinutes);
  const slots = Array.from({ length: last - first + 1 }, (_, i) => slotStart(first + i, intervalMinutes));
  return {
    intervalMinutes,
    slots,
    indexOf: (t) => {
      const i = slotOf(t, intervalMinutes) - first;
      return i >= 0 && i < slots.length ? i : -1;
    },
  };
}

const kstHour = (t: number) => (new Date(t).getUTCHours() + 9) % 24;
const hh = (t: number) => String(kstHour(t)).padStart(2, '0');

/**
 * 칸 안에 한국 시각 0 · 3 · 6 … 시 정각이 들어 있으면 그 시각, 없으면 null.
 * 칸 시작이 정각이 아니어도(08:45~09:45 칸) 그 안의 09시를 찾는다.
 */
export function slotHourLabel(start: number, intervalMinutes: number): string | null {
  const step = LABEL_HOURS * HOUR; // 9시간 차이가 3시간의 배수라 UTC 3시간 경계가 곧 한국 3시간 경계다
  const mark = Math.ceil(start / step) * step;
  return mark < start + intervalMinutes * MIN ? `${hh(mark)}시` : null;
}

/** 범주 축(칸마다 한 범주)에 3시간마다 라벨을 다는 설정. */
const slotAxisLabel = (slots: number[], intervalMinutes: number) => ({
  interval: (i: number) => slotHourLabel(slots[i]!, intervalMinutes) !== null,
  formatter: (_: string, i: number) => slotHourLabel(slots[i]!, intervalMinutes) ?? '',
});

/** 기록이 덮는 시간(0~24). 기록이 든 칸 수 × 수집 간격으로 센다(한 칸에 둘이 와도 한 번). */
export function historyHours(buckets: { dataAt: string }[], intervalMinutes: number): number {
  const slots = new Set(inWindow(buckets).map((b) => slotOf(ms(b.dataAt), intervalMinutes)));
  return Math.min(HISTORY_HOURS, Math.ceil((slots.size * intervalMinutes) / 60));
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

const axisText = { color: chartTheme.mute, fontSize: 11 };
const hairline = { lineStyle: { color: tokens.line, width: 1, type: 'solid' as const } };
const tipHead = (text: string) => `<div style="color:${tokens.mute};margin-bottom:4px">${text}</div>`;

// ---------------------------------------------------------------- 노선 × 시간

/**
 * 히트맵 색: 느림만 눈에 띄게. 빠른 칸(85 이상)은 패널보다 한 단 밝은 차가운 회청색, 70–85 는 조금 따뜻하고 흐린 색,
 * 55–70 호박빛 빨강, 40–55 빨강, 40 미만은 가장 밝은 #FF4D4F. 평범한 날은 지도가 조용하고 정체 시간만 불이 켜진다.
 * 밝기는 단조로 오르고 이웃 단계 ΔL ≥ 0.06 이다. 빠른 끝이 무채색에 가까워 검사기의 대비(2:1) · 한 색상 검사는
 * 통과하지 않는다 — 의미를 우선한 컨트롤러 결정이고, 값은 표로 보기와 툴팁이 함께 준다.
 * (validate_palette.js --ordinal --mode dark --surface #111B28 결과는 task-13-report.md 에 있다.) 순서는 빠름 → 느림.
 */
export const HEAT_COLORS = ['#26374d', '#5f494c', '#a44c1d', '#d64740', '#ff4d4f'] as const;
/** 단계 경계(km/h), 빠름 → 느림. 40 · 70 은 정체 · 서행 · 원활 경계와 같고, 사이를 15km/h 씩 나눴다. */
export const HEAT_PIECES = [
  { gte: 85, label: '85 이상' },
  { gte: 70, lt: 85, label: '70–85' },
  { gte: 55, lt: 70, label: '55–70' },
  { gte: 40, lt: 55, label: '40–55' },
  { gte: 0, lt: 40, label: '40 미만' },
].map((p, i) => ({ ...p, color: HEAT_COLORS[i] as string }));
const heatColor = (v: number) =>
  HEAT_PIECES.find((p) => (p.lt === undefined || v < p.lt) && (p.gte === undefined || v >= p.gte))!.color;

const NO_RECORD = -1;

export type HeatCell = { x: number; y: number; speed: number; dataAt: string };
/** names: 위에서부터 노선(전체 이름), grid: 시간 칸, cells: 기록 있는 칸만 */
export type HeatRows = { names: string[]; grid: TimeGrid; cells: HeatCell[] };

/**
 * 히트맵에 올릴 노선과 칸. 노선은 최근 24시간 기록 수가 많은 순으로 topN 개(같으면 이름순),
 * 화면에는 24시간 평균이 느린 노선부터 위에 놓는다. 각 기록은 제 시계 칸에 들어가고,
 * 한 칸에 둘이 오면 더 새 기록을 쓴다. 기록이 없는 칸은 만들지 않는다.
 */
export function heatRows(routes: RouteBucket[], intervalMinutes: number, topN = 12): HeatRows {
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
  const grid = timeGrid(recent.map((r) => ms(r.dataAt)), intervalMinutes);
  const byCell = new Map<string, HeatCell>();
  for (const r of recent) {
    const y = row.get(r.route);
    if (y === undefined) continue;
    const x = grid.indexOf(ms(r.dataAt));
    const key = `${x}|${y}`;
    const had = byCell.get(key);
    if (!had || ms(r.dataAt) > ms(had.dataAt)) byCell.set(key, { x, y, speed: r.avgSpeed, dataAt: r.dataAt });
  }
  const cells = [...byCell.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  return { names, grid, cells };
}

/** compact: 좁은 화면(폰). 축 라벨을 6시간마다 둔다. */
export function heatmapOption(rows: HeatRows, { compact = false } = {}): EChartsCoreOption {
  const { names, grid, cells } = rows;
  const { slots, intervalMinutes } = grid;
  const at = new Map(cells.map((c) => [`${c.x}|${c.y}`, c]));
  const empty: [number, number, number][] = [];
  // 기록 없는 칸은 값 -1 로 두어 색 단계 어디에도 들지 않게 한다(아래 visualMap 의 '기록 없음' 조각).
  names.forEach((_, y) => slots.forEach((__, x) => { if (!at.has(`${x}|${y}`)) empty.push([x, y, NO_RECORD]); }));
  const label = slotAxisLabel(slots, intervalMinutes);

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 8, top: 4, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: slots.map((t) => new Date(t).toISOString()),
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: {
        ...axisText,
        ...label,
        // 폰에서는 6시간마다
        interval: compact
          ? (i: number) => { const l = slotHourLabel(slots[i]!, intervalMinutes); return l !== null && Number.parseInt(l, 10) % 6 === 0; }
          : label.interval,
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
    // 범례는 카드 위 HTML(빠름 → 느림)이 맡는다. ECharts 히트맵은 계열마다 visualMap 이 있어야 해서
    // 하나로 두 계열을 다 맡고, 기록 없는 칸(-1)은 패널색 조각으로 보낸다.
    visualMap: {
      type: 'piecewise',
      show: false,
      seriesIndex: [0, 1],
      dimension: 2,
      pieces: [...HEAT_PIECES, { lt: 0, label: '기록 없음', color: tokens.panel }],
    },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: { seriesIndex: number; value: [number, number, number] }) => {
        const [x, y] = p.value;
        const route = escapeHtml(names[y] ?? '');
        const c = at.get(`${x}|${y}`);
        if (p.seriesIndex !== 0 || !c) {
          return tipHead(`${route} · ${hhmm(new Date(slots[x]!).toISOString())} 칸`) +
            `<div style="color:${tokens.ink}">기록 없음</div>`;
        }
        return tipHead(`${route} · ${hhmm(c.dataAt)}`) +
          tooltipRow(boxKey(heatColor(c.speed)), `${Math.round(c.speed)} km/h`, LEVEL_LABEL[speedLevel(c.speed)]);
      },
    },
    series: [
      {
        type: 'heatmap',
        name: '노선 평균 속도',
        data: cells.map((c) => [c.x, c.y, c.speed]),
        progressive: 0,
        // 칸 사이 2px 패널색 틈. 테두리가 아니라 빈 틈으로 보인다.
        itemStyle: { borderColor: tokens.panel, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: tokens.ink, borderWidth: 1.5 } },
      },
      {
        // 기록 없는 칸: 속은 패널색 그대로, 밝은 회청 테두리만. 속이 찬 가장 빠른 칸과 한눈에 다르다.
        type: 'heatmap',
        name: '기록 없음',
        data: empty,
        progressive: 0,
        itemStyle: { borderColor: '#4a5f78', borderWidth: 1, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: tokens.mute, borderWidth: 1 } },
      },
    ],
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
        return tipHead(`${escapeHtml(r.route)} · ${hhmm(r.dataAt)} 기준`) +
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

export const levelShare = (b: TrafficBucket, key: 'ok' | 'slow' | 'jam') => {
  const total = b.ok + b.slow + b.jam;
  return total ? Math.round((b[key] / total) * 1000) / 10 : 0;
};

/** 상태 비율 차트와 그 표가 함께 쓰는 기록: 최근 24시간, 시각 순. */
export const levelRows = (buckets: TrafficBucket[]) => inWindow(buckets);

/**
 * 24시간 원활 · 서행 · 정체 구간 비율을 아래에서부터 정체 → 서행 → 원활로 쌓는다.
 * x 는 시간 칸(범주 축)이고 점은 기록이 든 칸에만 찍는다. 이웃 기록 사이가 수집 간격의 1.5배를 넘을 때만
 * 빈 점을 넣어 면을 끊고, 그보다 가까우면(45분 · 75분처럼 조금 어긋난 수집) 그대로 잇는다.
 */
export function levelAreaOption(buckets: TrafficBucket[], intervalMinutes: number): EChartsCoreOption {
  const rows = levelRows(buckets);
  const grid = timeGrid(rows.map((b) => ms(b.dataAt)), intervalMinutes);
  const gapMs = 1.5 * intervalMinutes * MIN;
  // 칸 → 그 칸의 기록(둘이면 더 새것). 툴팁이 기록 자신의 시각을 보여 준다.
  const bySlot = new Map<number, TrafficBucket>();
  for (const b of rows) bySlot.set(grid.indexOf(ms(b.dataAt)), b);
  const shown = [...bySlot.entries()].sort(([a], [b]) => a - b);
  const points = (key: 'ok' | 'slow' | 'jam') => {
    const out: [number, number | null][] = [];
    shown.forEach(([x, b], i) => {
      const prev = shown[i - 1];
      if (prev && ms(b.dataAt) - ms(prev[1].dataAt) > gapMs) out.push([prev[0] + 1, null]);
      out.push([x, levelShare(b, key)]);
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
      type: 'category',
      boundaryGap: false,
      data: grid.slots.map((t) => new Date(t).toISOString()),
      axisLine: hairline,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...axisText, ...slotAxisLabel(grid.slots, intervalMinutes) },
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
      formatter: (ps: { dataIndex: number; value: [number, number | null] }[]) => {
        const b = bySlot.get(ps[0]?.value[0] ?? -1);
        if (!b) return '';
        const head = tipHead(`${hhmm(b.dataAt)} · 본선 ${formatCount(b.ok + b.slow + b.jam)}구간`);
        return head + [...LEVELS].reverse()
          .map((l) => tooltipRow(boxKey(l.color), `${levelShare(b, l.key)}%`, `${l.name} ${formatCount(b[l.key])}구간`)).join('');
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

/**
 * `now − 지연`이 속한 시각까지 거슬러 24시간, 1시간 칸. /api/insights 의 돌발 집계 창과 끝이 같다.
 * 상황이 없던 시각은 0건이다(지어낸 값이 아니라 센 결과).
 */
export function incidentHours(
  incidentsByHour: IncidentHour[], now: Date, delayMinutes: number,
): { hour: string; total: number; byCategory: IncidentHour['byCategory'] | null }[] {
  const end = Math.floor((now.getTime() - delayMinutes * MIN) / HOUR) * HOUR;
  const byHour = new Map(incidentsByHour.map((h) => [ms(h.hour), h]));
  return Array.from({ length: HISTORY_HOURS }, (_, i) => {
    const t = end - (HISTORY_HOURS - 1 - i) * HOUR;
    const h = byHour.get(t);
    return { hour: new Date(t).toISOString(), total: h?.total ?? 0, byCategory: h?.byCategory ?? null };
  });
}

export function incidentHoursOption(incidentsByHour: IncidentHour[], now: Date, delayMinutes: number): EChartsCoreOption {
  const hours = incidentHours(incidentsByHour, now, delayMinutes);
  const slots = hours.map((h) => ms(h.hour));
  const max = Math.max(0, ...hours.map((h) => h.total));
  const peak = max > 0 ? hours.findIndex((h) => h.total === max) : -1;

  return {
    backgroundColor: chartTheme.background,
    grid: { left: 4, right: 4, top: 22, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: hours.map((h) => h.hour),
      axisLine: hairline,
      axisTick: { show: false },
      axisLabel: { ...axisText, ...slotAxisLabel(slots, 60) },
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
        const head = tipHead(`${hh(t)}:00–${hh(t + HOUR)}:00 발생`);
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
