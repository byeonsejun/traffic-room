import type { Map as MlMap } from 'maplibre-gl';

export type FlowLevel = { maxSpeed: number; dashStepMs: number };

/**
 * 속도를 다섯 단계로 나누고 단계마다 점선이 한 칸 나아가는 간격을 정한다.
 * 빠를수록 짧은 간격으로 흐르고, 20km/h 미만은 멈춰 선 점선으로 둔다.
 */
export const FLOW_LEVELS: FlowLevel[] = [
  { maxSpeed: 20, dashStepMs: 0 },
  { maxSpeed: 40, dashStepMs: 400 },
  { maxSpeed: 70, dashStepMs: 200 },
  { maxSpeed: 100, dashStepMs: 110 },
  { maxSpeed: Infinity, dashStepMs: 70 },
];

export function flowLevel(kmh: number, levels: FlowLevel[] = FLOW_LEVELS): number {
  const i = levels.findIndex((l) => kmh < l.maxSpeed);
  return i === -1 ? levels.length - 1 : i;
}

/**
 * 속도선은 두 벌(A · B)을 둔다. 새 속도는 숨은 벌에 쓰고 불투명도를 맞바꿔 서서히 바꾼다.
 * MapLibre 는 데이터에 따라 정한 색을 보간하지 않아서 이렇게 겹쳐 바꾼다.
 */
export type SpeedSet = 'a' | 'b';
export const SPEED_SETS: SpeedSet[] = ['a', 'b'];

export const flowLayerId = (set: SpeedSet, level: number) => `hw-${set}-flow-${level}`;

/**
 * 흐르는 점선은 선을 따라 반복되는 패턴 이미지다. 이미지 높이가 선 두께에 맞춰 늘어나므로
 * 높이 8px 기준으로 획 2배(16px) · 틈 4배(32px)를 그리면 예전 dasharray [2, 4] 와 같은 비율이 된다.
 *
 * 왜 dasharray 가 아니라 이미지인가: line-dasharray 는 MapLibre 에서 cross-faded-data-driven 속성이라
 * setPaintProperty 로 바꿀 때마다 그 소스의 타일을 처음부터 다시 만든다(Style._updateLayer → reload).
 * 1초에 30번쯤 바꾸던 탓에 가만히 있어도 타일을 초당 300개 다시 만들었고, 확대 · 축소 때 새 타일이 늦게 떴다.
 * updateImage 는 GPU 텍스처의 그 칸만 고치므로 타일을 다시 만들지 않는다.
 */
export const FLOW_PATTERN = { width: 48, height: 8, dash: 16, steps: 16 } as const;

type Rgb = [number, number, number];
// 획 색: 속도선 색을 밝힌 빛줄기. 경계는 속도선 색과 같다(정체 < 40 ≤ 서행 < 70 ≤ 원활).
const JAM_LIGHT: Rgb = [0xff, 0xc4, 0xc5];
const SLOW_LIGHT: Rgb = [0xff, 0xe6, 0xae];
const FLOW_LIGHT: Rgb = [0xc4, 0xf8, 0xdb];

/** level 단계의 획 색. 그 단계가 시작하는 속도로 정해서, 단계를 바꿔도 색 경계가 어긋나지 않는다. */
export function levelRgb(level: number, levels: FlowLevel[] = FLOW_LEVELS): Rgb {
  const from = level > 0 ? levels[level - 1]!.maxSpeed : 0;
  return from < 40 ? JAM_LIGHT : from < 70 ? SLOW_LIGHT : FLOW_LIGHT;
}

export const flowImageId = (level: number) => `flow-${level}`;

type Frame = { width: number; height: number; data: Uint8Array };
const frames = new Map<string, Frame>();

/**
 * level 단계의 step 번째 프레임. 획이 선 진행 방향으로 step × (폭/steps) 만큼 나아가 있다.
 * 바깥 1px 테두리는 늘 비운다. 지도는 타일을 만들 때 이미지 둘레에 가장자리 픽셀을 1px 복사해 두는데,
 * updateImage 는 안쪽만 다시 올리고 그 복사본은 첫 프레임 그대로 둬서, 비워 두지 않으면 이음매에 멈춘 조각이 비친다.
 */
export function flowFrame(level: number, step: number): Frame {
  const k = `${level}:${step}`;
  const hit = frames.get(k);
  if (hit) return hit;
  const { width, height, dash, steps } = FLOW_PATTERN;
  const [r, g, b] = levelRgb(level);
  const start = ((step % steps) * width) / steps;
  const data = new Uint8Array(width * height * 4);
  for (let x = 1; x < width - 1; x += 1) {
    if ((x - start + width) % width >= dash) continue;
    for (let y = 1; y < height - 1; y += 1) data.set([r, g, b, 255], (y * width + x) * 4);
  }
  const f = { width, height, data };
  frames.set(k, f);
  return f;
}

/** 단계마다 패턴 이미지를 한 번 등록한다(지도 load 뒤, 흐름 레이어보다 먼저). */
export function addFlowImages(map: Pick<MlMap, 'addImage' | 'hasImage'>) {
  FLOW_LEVELS.forEach((_, i) => {
    if (!map.hasImage(flowImageId(i))) map.addImage(flowImageId(i), flowFrame(i, 0));
  });
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 단계별 흐름 패턴을 단계마다 다른 간격으로 한 칸씩 민다. 루프는 하나만 돈다.
 * 두 벌(A · B)이 같은 이미지를 쓰므로 바뀌는 동안에도 점선이 어긋나지 않는다.
 * reduced motion 이면 시작하지 않는다. 돌려준 함수로 멈춘다.
 */
export function startFlow(map: Pick<MlMap, 'updateImage' | 'triggerRepaint'>, levels: FlowLevel[] = FLOW_LEVELS): () => void {
  if (prefersReducedMotion()) return () => {};
  // 이미지는 멈출 때의 칸에 남아 있으니, 다시 시작하면 칸 번호와 상관없이 첫 칸을 꼭 올린다.
  const shown = levels.map(() => -1);
  let stopped = false;
  let raf = 0;
  const tick = (now: number) => {
    if (stopped) return;
    let changed = false;
    levels.forEach((l, i) => {
      if (l.dashStepMs <= 0) return;
      const step = Math.floor(now / l.dashStepMs) % FLOW_PATTERN.steps;
      if (step === shown[i]) return;
      shown[i] = step;
      map.updateImage(flowImageId(i), flowFrame(i, step));
      changed = true;
    });
    if (changed) map.triggerRepaint();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
