import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FLOW_LEVELS, FLOW_PATTERN, addFlowImages, flowFrame, flowImageId, flowLevel, startFlow } from './flow.ts';

let reduce = false;
beforeEach(() => {
  reduce = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fakeMap = () => ({ updateImage: vi.fn(), triggerRepaint: vi.fn(), setPaintProperty: vi.fn() });
const callsFor = (map: ReturnType<typeof fakeMap>, id: string) =>
  map.updateImage.mock.calls.filter(([i]) => i === id).length;
/** 프레임 가운데 줄에서 불투명한 x 들. */
const litColumns = (f: { width: number; height: number; data: Uint8Array }) => {
  const y = Math.floor(f.height / 2);
  const out: number[] = [];
  for (let x = 0; x < f.width; x += 1) if (f.data[(y * f.width + x) * 4 + 3]! > 0) out.push(x);
  return out;
};
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

test('levels split speeds at 20 · 40 · 70 · 100', () => {
  expect([0, 19, 20, 39, 40, 69, 70, 99, 100, 140].map((s) => flowLevel(s))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  expect(FLOW_LEVELS).toHaveLength(5);
  expect(FLOW_LEVELS[0]!.dashStepMs).toBe(0);
});

test('a flow frame is one short stroke and a long gap, as tall as the line', () => {
  const { width, height, dash } = FLOW_PATTERN;
  const f = flowFrame(3, 0);
  expect(f.width).toBe(width);
  expect(f.height).toBe(height);
  expect(f.data).toHaveLength(width * height * 4);
  // 획:틈 = 2:4 (선 두께의 배수), 획은 줄 전체 높이.
  expect(dash * 3).toBe(width);
  expect(litColumns(f)).toEqual(range(0, dash));
});

test('each step pushes the stroke forward along the line and wraps around', () => {
  const { width, dash, steps } = FLOW_PATTERN;
  const shift = width / steps;
  expect(litColumns(flowFrame(3, 1))).toEqual(range(shift, shift + dash));
  const last = flowFrame(3, steps - 1);
  const start = (steps - 1) * shift;
  expect(litColumns(last)).toEqual([...range(0, start + dash - width), ...range(start, width)]);
});

test('the stroke colour follows the speed colour of each level (light jam · slow · flow)', () => {
  const rgb = (lv: number) => {
    const f = flowFrame(lv, 0);
    const i = (Math.floor(f.height / 2) * f.width) * 4;
    return Array.from(f.data.subarray(i, i + 3));
  };
  expect(rgb(0)).toEqual([0xff, 0xc4, 0xc5]);
  expect(rgb(1)).toEqual([0xff, 0xc4, 0xc5]);
  expect(rgb(2)).toEqual([0xff, 0xe6, 0xae]);
  expect(rgb(3)).toEqual([0xc4, 0xf8, 0xdb]);
  expect(rgb(4)).toEqual([0xc4, 0xf8, 0xdb]);
});

test('addFlowImages registers one pattern image per level (only once)', () => {
  const have = new Set<string>();
  const map = { addImage: vi.fn((id: string) => have.add(id)), hasImage: (id: string) => have.has(id) };
  addFlowImages(map as never);
  addFlowImages(map as never);
  expect(map.addImage).toHaveBeenCalledTimes(FLOW_LEVELS.length);
  expect(map.addImage.mock.calls.map(([id]) => id)).toEqual(FLOW_LEVELS.map((_, i) => flowImageId(i)));
});

test('the loop only swaps pattern images — never a paint property, which would re-tile the source', () => {
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(2000);
  stop();
  expect(callsFor(map, flowImageId(0))).toBe(0);
  expect(callsFor(map, flowImageId(1))).toBeGreaterThan(0);
  expect(callsFor(map, flowImageId(4))).toBeGreaterThan(callsFor(map, flowImageId(1)));
  expect(map.triggerRepaint).toHaveBeenCalled();
  expect(map.setPaintProperty).not.toHaveBeenCalled();
});

test('stopping ends the loop', () => {
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(500);
  stop();
  const n = map.updateImage.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(map.updateImage.mock.calls.length).toBe(n);
});

test('under reduced motion the flow never starts', () => {
  reduce = true;
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(2000);
  stop();
  expect(map.updateImage).not.toHaveBeenCalled();
});
