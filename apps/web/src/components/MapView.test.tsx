import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { Category, Cctv, Incident, ServerMessage } from '@traffic-room/shared';
import { useConsole } from '@/store/console';
import { MapView } from './MapView';

// maplibre 는 WebGL 이 필요하다. 지도에 무엇을 부탁했는지만 기록하는 가짜로 바꾼다.
const h = vi.hoisted(() => {
  const state = {
    maps: [] as FakeMap[],
    markers: 0,
    instances: [] as Marker[],
  };
  type Handler = (...args: unknown[]) => void;
  type Layer = { id: string; paint: Record<string, unknown>; filter?: unknown };
  class FakeMap {
    handlers = new Map<string, Handler>();
    layers: Layer[] = [];
    before = new Map<string, string | undefined>();
    sources = new Map<string, { setData: ReturnType<typeof vi.fn>; data?: unknown }>();
    easeTo = vi.fn();
    jumpTo = vi.fn();
    setPaintProperty = vi.fn();
    touchZoomRotate = { disableRotation: () => {} };
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.maps.push(this);
    }
    off(event: string) {
      this.handlers.delete(event);
    }
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === 'function') this.handlers.set(event, a as Handler);
      else this.handlers.set(`${event}:${String(a)}`, b as Handler);
    }
    addControl() {}
    addSource(id: string, spec?: { data?: unknown }) {
      this.sources.set(id, { setData: vi.fn(), data: spec?.data });
    }
    addLayer(l: Layer, beforeId?: string) {
      this.layers.push(l);
      this.before.set(l.id, beforeId);
    }
    getLayer(id: string) {
      return this.layers.find((l) => l.id === id);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    getCanvas() {
      return document.createElement('canvas');
    }
    remove() {}
  }
  class Marker {
    element: HTMLElement;
    options: Record<string, unknown>;
    lngLats: Array<[number, number]> = [];
    removed = false;
    constructor(options: { element: HTMLElement } & Record<string, unknown>) {
      state.markers += 1;
      this.options = options;
      this.element = options.element;
      state.instances.push(this);
    }
    setLngLat(ll: [number, number]) {
      this.lngLats.push(ll);
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      this.removed = true;
    }
  }
  return { state, FakeMap, Marker };
});

vi.mock('maplibre-gl', () => ({
  Map: h.FakeMap,
  Marker: h.Marker,
  NavigationControl: class {},
  setWorkerUrl: () => {},
  getVersion: () => 'test',
}));

const inc = (key: string, category: Category, lon = 127.1, lat = 37.2): Incident => ({
  key, category, roadName: '경부선', direction: '서울', detail: '', message: '', lanesBlocked: '',
  lon, lat, startedAt: null,
});
const arrived = (id: number, incident: Incident): ServerMessage => ({
  id, type: 'incident.arrived', ts: new Date().toISOString(), payload: { incident },
});

let reduce = false;
const motionListeners = new Set<() => void>();
const setReduce = (v: boolean) => {
  reduce = v;
  motionListeners.forEach((fn) => fn());
};
let rafCalls = 0;

const highways = {
  source: 'test',
  routes: ['경부고속도로'],
  links: [
    ['A', 0, 500, [[127.0, 37.0], [127.01, 37.01]]],
    ['B', 0, 400, [[127.01, 37.01], [127.02, 37.02]]],
  ],
};
const fetchMock = vi.fn(async () => new Response(JSON.stringify(highways), { status: 200 }));

type Props = Parameters<typeof MapView>[0];
const noTraffic: Props = { speeds: null, trafficDataAt: null, trafficError: false };

async function mountLoaded(props: Props = noTraffic) {
  const view = render(<MapView {...props} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const map = h.state.maps.at(-1)!;
  await act(async () => {
    map.handlers.get('load')!();
    await vi.waitFor(() => expect(map.getLayer('hw-base')).toBeDefined());
  });
  return { map, view };
}

const DATA_AT = '2026-11-13T02:00:00.000Z';
const show = (view: { rerender: (ui: ReactElement) => void }, speeds: Map<string, number>) =>
  view.rerender(<MapView speeds={speeds} trafficDataAt={DATA_AT} trafficError={false} />);
/** 지도가 그 소스의 새 데이터를 타일로 다 만들었다고 알린다. */
const tiled = (map: InstanceType<typeof h.FakeMap>, sourceId: string) =>
  act(() => map.handlers.get('sourcedata')!({ sourceId, isSourceLoaded: true }));
/** 마지막으로 정한 레이어별 불투명도. */
const opacities = (map: InstanceType<typeof h.FakeMap>) => {
  const out: Record<string, unknown> = {};
  for (const [id, prop, v] of map.setPaintProperty.mock.calls) if (prop === 'line-opacity') out[id as string] = v;
  return out;
};
const featureProps = (map: InstanceType<typeof h.FakeMap>, sourceId: string) => {
  const calls = map.getSource(sourceId)!.setData.mock.calls;
  const fc = calls.at(-1)![0] as { features: Array<{ properties: unknown }> };
  return fc.features.map((f) => f.properties);
}

beforeEach(() => {
  h.state.maps.length = 0;
  h.state.markers = 0;
  h.state.instances.length = 0;
  reduce = false;
  motionListeners.clear();
  rafCalls = 0;
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return reduce && q.includes('reduce'); },
    addEventListener: (_: string, fn: () => void) => motionListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => motionListeners.delete(fn),
  }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', () => { rafCalls += 1; return rafCalls; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(highways), { status: 200 }));
  useConsole.setState(useConsole.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('selecting an incident moves the map to it', async () => {
  useConsole.setState({ incidents: { a: inc('a', 'accident', 128.5, 35.9) } });
  const { map } = await mountLoaded();
  act(() => useConsole.getState().select('a'));
  expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [128.5, 35.9] }));
});

test('under reduced motion selection jumps without animating', async () => {
  reduce = true;
  useConsole.setState({ incidents: { a: inc('a', 'accident', 128.5, 35.9) } });
  const { map } = await mountLoaded();
  act(() => useConsole.getState().select('a'));
  expect(map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ center: [128.5, 35.9] }));
  expect(map.easeTo).not.toHaveBeenCalled();
});

test('a fresh accident pulses and pans, a fresh construction stays quiet', async () => {
  const { map } = await mountLoaded();
  act(() => useConsole.getState().applyServerMessage(arrived(1, inc('w', 'construction')), new Date()));
  expect(h.state.markers).toBe(0);
  expect(map.easeTo).not.toHaveBeenCalled();
  act(() => useConsole.getState().applyServerMessage(arrived(2, inc('x', 'accident')), new Date()));
  expect(h.state.markers).toBe(1);
  expect(map.easeTo).toHaveBeenCalledTimes(1);
});

test('construction has no halo', async () => {
  const { map } = await mountLoaded();
  const halo = map.layers.find((l) => l.id === 'incidents-halo')!;
  expect(halo.paint['circle-radius']).toEqual(['case', ['==', ['get', 'category'], 'construction'], 0, 14]);
});

test('the map is held to Korea', async () => {
  const { map } = await mountLoaded();
  expect(map.options).toMatchObject({
    maxBounds: [[123.5, 32.5], [132.5, 39.3]],
    minZoom: 5.5,
    renderWorldCopies: false,
  });
});

test('highway lines stack base → two speed sets (glow → speed → flow), all under the incident dots', async () => {
  const { map } = await mountLoaded();
  expect(fetchMock).toHaveBeenCalledWith('/highways.json', expect.anything());
  const hw = map.layers.filter((l) => l.id.startsWith('hw-')).map((l) => l.id);
  const set = (s: string) => [`hw-${s}-glow`, `hw-${s}-speed`, ...[0, 1, 2, 3, 4].map((i) => `hw-${s}-flow-${i}`)];
  expect(hw).toEqual(['hw-base', ...set('a'), ...set('b')]);
  for (const id of hw) expect(map.before.get(id)).toBe('incidents-halo');
  // 바탕선은 모든 구간을 한 번만 받는다.
  const base = map.getSource('highways')!;
  expect((base.data as { features: Array<{ properties: unknown }> }).features.map((f) => f.properties))
    .toEqual([{ s: null, lv: null }, { s: null, lv: null }]);
  expect(base.setData).not.toHaveBeenCalled();
  expect(map.getLayer('hw-b-flow-3')!.filter).toEqual(['==', ['get', 'lv'], 3]);
  expect(map.getLayer('hw-a-speed')!.paint['line-opacity']).toBe(0);
  expect(map.getLayer('hw-a-speed')!.paint['line-opacity-transition']).toEqual({ duration: 1500, delay: 0 });
});

test('under reduced motion the sets switch without a transition', async () => {
  reduce = true;
  const { map } = await mountLoaded();
  expect(map.getLayer('hw-b-speed')!.paint['line-opacity-transition']).toEqual({ duration: 0, delay: 0 });
});

test('first speeds go into set A and fade in once tiled', async () => {
  const { map, view } = await mountLoaded();
  show(view, new Map([['A', 75]]));
  expect(map.getSource('highways-a')!.setData).toHaveBeenCalledTimes(1);
  expect(map.getSource('highways-b')!.setData).not.toHaveBeenCalled();
  expect(featureProps(map, 'highways-a')).toEqual([{ s: 75, lv: 3 }]);
  expect(opacities(map)).toEqual({});
  tiled(map, 'highways-a');
  expect(opacities(map)).toMatchObject({ 'hw-a-glow': 0.5, 'hw-a-speed': 1, 'hw-a-flow-0': 0.9, 'hw-a-flow-4': 0.9 });
  expect(opacities(map)).not.toHaveProperty('hw-b-speed');
});

test('new speeds are written to the hidden set, then the sets crossfade', async () => {
  const { map, view } = await mountLoaded();
  show(view, new Map([['A', 75]]));
  tiled(map, 'highways-a');
  const baseWrites = map.getSource('highways')!.setData.mock.calls.length;
  show(view, new Map([['A', 30]]));
  expect(map.getSource('highways')!.setData).toHaveBeenCalledTimes(baseWrites);
  expect(featureProps(map, 'highways-b')).toEqual([{ s: 30, lv: 1 }]);
  expect(map.getSource('highways-a')!.setData).toHaveBeenCalledTimes(1);
  // 새 색이 타일로 다 만들어질 때까지 옛 색을 그대로 둔다.
  expect(opacities(map)['hw-a-speed']).toBe(1);
  tiled(map, 'highways-b');
  expect(opacities(map)).toMatchObject({ 'hw-a-speed': 0, 'hw-a-glow': 0, 'hw-a-flow-3': 0, 'hw-b-speed': 1, 'hw-b-glow': 0.5, 'hw-b-flow-3': 0.9 });

  // 다음 갱신은 다시 A 로 간다.
  show(view, new Map([['A', 90]]));
  expect(featureProps(map, 'highways-a')).toEqual([{ s: 90, lv: 3 }]);
  tiled(map, 'highways-a');
  expect(opacities(map)).toMatchObject({ 'hw-a-speed': 1, 'hw-b-speed': 0 });
});

test('a sourcedata event from the visible set does not trigger the crossfade', async () => {
  const { map, view } = await mountLoaded();
  show(view, new Map([['A', 75]]));
  tiled(map, 'highways-a');
  show(view, new Map([['A', 30]]));
  tiled(map, 'highways-a');
  expect(opacities(map)['hw-a-speed']).toBe(1);
  expect(opacities(map)).not.toHaveProperty('hw-b-speed');
});

test('the flow loop starts only once speeds are revealed', async () => {
  const { map, view } = await mountLoaded();
  expect(rafCalls).toBe(0);
  show(view, new Map([['A', 75]]));
  expect(rafCalls).toBe(0);
  tiled(map, 'highways-a');
  expect(rafCalls).toBeGreaterThan(0);
});

test('turning on reduced motion at runtime stops the flow and drops transitions; turning it off restarts', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const { map, view } = await mountLoaded();
  show(view, new Map([['A', 75]]));
  tiled(map, 'highways-a');
  const transitions = () =>
    map.setPaintProperty.mock.calls.filter(([id, prop]) => id === 'hw-b-speed' && prop === 'line-opacity-transition').map(([, , v]) => v);

  act(() => setReduce(true));
  expect(cancel).toHaveBeenCalled();
  expect(transitions().at(-1)).toEqual({ duration: 0, delay: 0 });

  const before = rafCalls;
  act(() => setReduce(false));
  expect(rafCalls).toBeGreaterThan(before);
  expect(transitions().at(-1)).toEqual({ duration: 1500, delay: 0 });
});

test('the legend names each state and the traffic time', async () => {
  const { view } = await mountLoaded({ speeds: new Map(), trafficDataAt: DATA_AT, trafficError: false });
  for (const label of ['원활', '서행', '정체', '데이터 없음', '교통 11:00 기준']) expect(view.getByText(label)).toBeTruthy();
});

test('when traffic fails the legend says so', async () => {
  const { view } = await mountLoaded({ speeds: null, trafficDataAt: null, trafficError: true });
  expect(view.getByText('교통 정보를 불러오지 못했어요')).toBeTruthy();
});

test('when the road shapes fail to load the legend says so instead of staying empty', async () => {
  fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<MapView speeds={new Map([['A', 75]])} trafficDataAt={DATA_AT} trafficError={false} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const map = h.state.maps.at(-1)!;
  await act(async () => {
    map.handlers.get('load')!();
  });
  await vi.waitFor(() => expect(document.querySelector('.map-legend .is-error')?.textContent).toBe('도로 정보를 불러오지 못했어요'));
  expect(map.getLayer('hw-base')).toBeUndefined();
});

// 지금 CCTV 패널이 틀고 있는 CCTV 자리 핀
const cam = (id: string, name: string, lon: number, lat: number): Cctv => ({
  id, name, lon, lat, url: `https://x/${id}.m3u8`, fetchedAt: '2026-11-12T00:00:00Z',
});
const cams = [
  cam('seocho', '[경부선] 서초', 127.0, 37.48),
  cam('near1', '[경부선] 천안', 127.171, 36.791),
  cam('near2', '[경부선] 안성', 127.18, 36.78),
];
const withCams: Props = { ...noTraffic, cctvs: cams };
const livePins = () => h.state.instances.filter((m) => m.element.classList.contains('live-pin'));

test('one live pin sits on the active CCTV, anchored at its bottom', async () => {
  await mountLoaded(withCams);
  const pins = livePins();
  expect(pins).toHaveLength(1);
  expect(pins[0]!.options.anchor).toBe('bottom');
  expect(pins[0]!.lngLats.at(-1)).toEqual([127.0, 37.48]);
  const el = pins[0]!.element;
  expect(el.textContent).toBe('실시간');
  expect(el.getAttribute('aria-hidden')).toBe('true');
  expect(el.hasAttribute('role')).toBe(false);
  expect(el.hasAttribute('aria-label')).toBe(false);
  expect(el.hasAttribute('tabindex')).toBe(false);
  expect(el.classList.contains('is-down')).toBe(false);
});

test('the pin follows the active CCTV: incident → nearest, chip → that one (same marker)', async () => {
  reduce = true;
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  await mountLoaded(withCams);
  act(() => useConsole.getState().select('a'));
  const pin = livePins()[0]!;
  expect(pin.lngLats.at(-1)).toEqual([127.171, 36.791]);
  act(() => useConsole.getState().setCctv('near2'));
  expect(pin.lngLats.at(-1)).toEqual([127.18, 36.78]);
  expect(livePins()).toHaveLength(1);
});

test('with motion the pin glides to the new CCTV and lands exactly on it', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  await mountLoaded(withCams);
  const pin = livePins()[0]!;
  act(() => useConsole.getState().select('a'));
  expect(pin.lngLats.at(-1)).toEqual([127.0, 37.48]);
  now = 100;
  act(() => frames.shift()!(now));
  const mid = pin.lngLats.at(-1)!;
  expect(mid[0]).toBeGreaterThan(127.0);
  expect(mid[0]).toBeLessThan(127.171);
  now = 5_000;
  act(() => frames.shift()!(now));
  expect(pin.lngLats.at(-1)).toEqual([127.171, 36.791]);
});

test('when the panel cannot play the active CCTV the pin turns grey and stops saying 실시간', async () => {
  await mountLoaded(withCams);
  const el = livePins()[0]!.element;
  act(() => useConsole.getState().setCctvUnavailable('seocho'));
  expect(el.classList.contains('is-down')).toBe(true);
  expect(el.textContent).toBe('연결 안 됨');
  expect(el.classList.contains('is-pulsing')).toBe(false);
  // 다른 CCTV 가 못 나오는 건 이 핀과 상관없다.
  act(() => useConsole.getState().setCctvUnavailable('near1'));
  expect(el.classList.contains('is-down')).toBe(false);
  expect(el.textContent).toBe('실시간');
});

test('the live pin pulses, but not under reduced motion', async () => {
  await mountLoaded(withCams);
  expect(livePins()[0]!.element.classList.contains('is-pulsing')).toBe(true);
  cleanup();
  h.state.instances.length = 0;
  reduce = true;
  await mountLoaded(withCams);
  expect(livePins()[0]!.element.classList.contains('is-pulsing')).toBe(false);
});

test('no CCTVs, no pin; unmount removes the pin', async () => {
  const { view } = await mountLoaded();
  expect(livePins()).toHaveLength(0);
  view.rerender(<MapView {...withCams} />);
  const pin = livePins()[0]!;
  view.unmount();
  expect(pin.removed).toBe(true);
});

test('turning reduced motion on or off while watching toggles the pulse right away', async () => {
  await mountLoaded(withCams);
  const el = livePins()[0]!.element;
  expect(el.classList.contains('is-pulsing')).toBe(true);
  act(() => setReduce(true));
  expect(el.classList.contains('is-pulsing')).toBe(false);
  act(() => setReduce(false));
  expect(el.classList.contains('is-pulsing')).toBe(true);
});

test('unmounting mid-glide cancels the pending frame', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal('requestAnimationFrame', () => 4242);
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  const { view } = await mountLoaded(withCams);
  act(() => useConsole.getState().select('a'));
  cancel.mockClear();
  view.unmount();
  expect(cancel).toHaveBeenCalledWith(4242);
});
