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

// 점선 한 주기(선 두께의 배수): 짧은 획 하나와 긴 틈. DASH_STEPS 번에 걸쳐 한 주기를 밀어낸다.
const DASH = 2;
const GAP = 4;
const PERIOD = DASH + GAP;
const DASH_STEPS = 16;

/**
 * 획이 선의 진행 방향으로 offset 만큼 밀린 dasharray. MapLibre 의 "animated line" 처럼
 * 길이 0 인 획을 앞에 두어 패턴의 시작을 옮긴다.
 */
export function dashAt(step: number): number[] {
  const o = ((step % DASH_STEPS) * PERIOD) / DASH_STEPS;
  if (o + DASH <= PERIOD) return [0, o, DASH, PERIOD - o - DASH];
  // 획이 주기 끝을 넘으면 앞쪽으로 넘어온 조각부터 그린다.
  return [o + DASH - PERIOD, PERIOD - DASH, PERIOD - o, 0];
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 단계별 흐름 레이어의 점선을 단계마다 다른 간격으로 한 칸씩 민다. 루프는 하나만 돈다.
 * 두 벌을 같은 박자로 밀어 바뀌는 동안 점선이 어긋나 보이지 않게 한다.
 * reduced motion 이면 시작하지 않는다. 돌려준 함수로 멈춘다.
 */
export function startFlow(map: Pick<MlMap, 'setPaintProperty'>, levels: FlowLevel[] = FLOW_LEVELS): () => void {
  if (prefersReducedMotion()) return () => {};
  const shown = levels.map(() => 0);
  let stopped = false;
  let raf = 0;
  const tick = (now: number) => {
    if (stopped) return;
    levels.forEach((l, i) => {
      if (l.dashStepMs <= 0) return;
      const step = Math.floor(now / l.dashStepMs) % DASH_STEPS;
      if (step === shown[i]) return;
      shown[i] = step;
      for (const set of SPEED_SETS) map.setPaintProperty(flowLayerId(set, i), 'line-dasharray', dashAt(step));
    });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
