import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FLOW_LEVELS, flowLevel, startFlow } from './flow.ts';

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

const fakeMap = () => ({ setPaintProperty: vi.fn() });
const callsFor = (map: ReturnType<typeof fakeMap>, layer: string) =>
  map.setPaintProperty.mock.calls.filter(([id]) => id === layer).length;

test('levels split speeds at 20 · 40 · 70 · 100', () => {
  expect([0, 19, 20, 39, 40, 69, 70, 99, 100, 140].map((s) => flowLevel(s))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  expect(FLOW_LEVELS).toHaveLength(5);
  expect(FLOW_LEVELS[0]!.dashStepMs).toBe(0);
});

test('faster levels step their dashes more often, the jam level stands still', () => {
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(2000);
  stop();
  expect(callsFor(map, 'hw-a-flow-0')).toBe(0);
  expect(callsFor(map, 'hw-a-flow-1')).toBeGreaterThan(0);
  expect(callsFor(map, 'hw-a-flow-4')).toBeGreaterThan(callsFor(map, 'hw-a-flow-1'));
  // 바뀌는 중에 두 겹의 점선이 어긋나 보이지 않게 숨은 쪽도 같은 박자로 민다.
  expect(callsFor(map, 'hw-b-flow-4')).toBe(callsFor(map, 'hw-a-flow-4'));
  for (const [, prop] of map.setPaintProperty.mock.calls) expect(prop).toBe('line-dasharray');
});

test('stopping ends the loop', () => {
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(500);
  stop();
  const n = map.setPaintProperty.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(map.setPaintProperty.mock.calls.length).toBe(n);
});

test('under reduced motion the flow never starts', () => {
  reduce = true;
  const map = fakeMap();
  const stop = startFlow(map as never);
  vi.advanceTimersByTime(2000);
  stop();
  expect(map.setPaintProperty).not.toHaveBeenCalled();
});
