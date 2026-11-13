import { tokens } from '@/lib/tokens';

/**
 * 관제 · 분석 차트가 같이 쓰는 색과 글자. 1차 디자인 토큰 안에서만 고른다.
 * 글자는 언제나 글자색 토큰이고, 계열 색은 선 · 막대 · 점에만 칠한다.
 */
export const chartTheme = {
  background: 'transparent',
  /** 차트가 놓이는 바탕. 맞닿은 막대 사이 틈과 점 테두리에 쓴다. */
  surface: tokens.asphalt,
  text: tokens.ink,
  mute: tokens.mute,
  axis: tokens.line,
  /** 상태가 아닌 값(평균 속도 등)의 계열 색. */
  accent: tokens.info,
  status: { ok: tokens.flow, slow: tokens.slow, jam: tokens.jam },
  fontSize: 12,
} as const;

/** 툴팁 상자. 패널 색 위에 선 하나, 글자는 본문 글꼴을 그대로 이어받는다. */
export const tooltipBase = {
  backgroundColor: tokens.panel,
  borderColor: tokens.line,
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: tokens.ink, fontSize: 12 },
  extraCssText: 'font-family: inherit; border-radius: 6px; box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);',
  confine: true,
  transitionDuration: 0.15,
} as const;

type TooltipSize = { contentSize: number[]; viewSize: number[] };
/** 작은 차트용 툴팁 자리: 그림을 가리지 않게 차트 바로 위에 띄우고, 가로로만 포인터를 따라간다. */
export const tooltipAbove = {
  confine: false,
  position: (point: number[], _params: unknown, _dom: unknown, _rect: unknown, size: TooltipSize) => {
    const [w, h] = size.contentSize as [number, number];
    const x = Math.min(Math.max(point[0]! - w / 2, 0), size.viewSize[0]! - w);
    return [x, -h - 8];
  },
} as const;

/** 툴팁 한 줄: 값이 먼저(굵게), 이름은 뒤에(흐리게). 값과 이름은 우리가 만든 숫자 · 시각 문자열이다. */
export const tooltipRow = (key: string, value: string, label: string) =>
  `<div style="display:flex;align-items:center;gap:8px;line-height:1.5">${key}` +
  `<b style="font-weight:600;color:${tokens.ink};font-variant-numeric:tabular-nums">${value}</b>` +
  `<span style="color:${tokens.mute}">${label}</span></div>`;

/** 툴팁 앞의 계열 표시: 선 계열은 짧은 선, 막대 계열은 작은 네모. */
export const lineKey = (color: string) =>
  `<i style="display:inline-block;width:10px;height:2px;border-radius:1px;background:${color}"></i>`;
export const boxKey = (color: string) =>
  `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color}"></i>`;

export const formatCount = (n: number) => n.toLocaleString('ko-KR');
