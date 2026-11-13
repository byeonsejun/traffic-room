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
    // 같은 이벤트에 여러 리스너가 붙으면 차례로 모두 부르고, off 는 그 리스너 하나만 뗀다(실제 maplibre 처럼).
    // handlers 에는 키마다 모두를 부르는 함수 하나를 둬서 테스트가 handlers.get(key)!(…) 로 이벤트를 낸다.
    lists = new Map<string, Handler[]>();
    canvas = document.createElement('canvas');
    private sync(key: string) {
      const list = this.lists.get(key) ?? [];
      if (list.length === 0) this.handlers.delete(key);
      else this.handlers.set(key, (...args) => [...list].forEach((fn) => fn(...args)));
    }
    off(event: string, a?: unknown, b?: unknown) {
      const key = typeof a === 'string' ? `${event}:${a}` : event;
      const fn = (typeof a === 'string' ? b : a) as Handler | undefined;
      const list = this.lists.get(key) ?? [];
      this.lists.set(key, fn ? list.filter((f) => f !== fn) : []);
      this.sync(key);
    }
    on(event: string, a: unknown, b?: unknown) {
      const key = typeof a === 'function' ? event : `${event}:${String(a)}`;
      const fn = (typeof a === 'function' ? a : b) as Handler;
      this.lists.set(key, [...(this.lists.get(key) ?? []), fn]);
      this.sync(key);
    }
    /** 화면 좌표: 경도 1도 = 100px, 위도 1도 = -100px, (127, 37) 이 (400, 300). */
    project(ll: [number, number]) {
      return { x: 400 + (ll[0] - 127) * 100, y: 300 - (ll[1] - 37) * 100 };
    }
    addControl() {}
    images = new Set<string>();
    addImage = vi.fn((id: string) => { this.images.add(id); });
    hasImage(id: string) {
      return this.images.has(id);
    }
    updateImage = vi.fn();
    triggerRepaint = vi.fn();
    refreshTiles = vi.fn();
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
      return this.canvas;
    }
    getContainer() {
      return this.options.container as HTMLElement;
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
  expect(el.querySelector('.live-pin__label')!.textContent).toBe('실시간');
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
  expect(el.querySelector('.live-pin__label')!.textContent).toBe('연결 안 됨');
  expect(el.classList.contains('is-pulsing')).toBe(false);
  // 다른 CCTV 가 못 나오는 건 이 핀과 상관없다.
  act(() => useConsole.getState().setCctvUnavailable('near1'));
  expect(el.classList.contains('is-down')).toBe(false);
  expect(el.querySelector('.live-pin__label')!.textContent).toBe('실시간');
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

// 핀 위에 마우스를 올리면 CCTV 이름 툴팁. 핀은 pointer-events: none 이라 지도 mousemove 로 판정한다.
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
/** 지도 상자(0,0)~(800,600) 안, 핀은 (400,300) 근처에 알약 · 꼬리 · 점이 세로로 선 모양(가로 50 · 세로 34). */
function placePin(map: InstanceType<typeof h.FakeMap>, pinRect = rect(375, 266, 50, 34)) {
  vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
  const el = livePins()[0]!.element;
  const spy = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(pinRect);
  const tip = el.querySelector<HTMLElement>('.live-pin__tip')!;
  vi.spyOn(tip, 'getBoundingClientRect').mockImplementation(() => {
    const r = spy.getMockImplementation()?.() ?? pinRect;
    const w = 160;
    return rect(r.left + r.width / 2 - w / 2, r.top - 34, w, 28);
  });
  return { el, tip, move: (r: DOMRect) => spy.mockReturnValue(r) };
}
const hover = (map: InstanceType<typeof h.FakeMap>, x: number, y: number) =>
  act(() => map.handlers.get('mousemove')!({ originalEvent: { clientX: x, clientY: y }, point: { x, y } }));

test('hovering the live pin shows the CCTV name; moving off hides it', async () => {
  const { map } = await mountLoaded(withCams);
  const { el, tip } = placePin(map);
  expect(el.classList.contains('is-hover')).toBe(false);
  expect(tip.textContent).toBe('[경부선] 서초');
  hover(map, 400, 297); // 점 위
  expect(el.classList.contains('is-hover')).toBe(true);
  hover(map, 400, 270); // 알약 위
  expect(el.classList.contains('is-hover')).toBe(true);
  hover(map, 470, 297); // 핀 옆 빈 지도
  expect(el.classList.contains('is-hover')).toBe(false);
});

test('the tooltip stays out of the accessibility tree and does not take the pointer', async () => {
  const { map } = await mountLoaded(withCams);
  const { el, tip } = placePin(map);
  hover(map, 400, 297);
  // 패널이 이미 이름을 읽으므로 핀 전체(툴팁 포함)는 aria-hidden 그대로, 역할도 없다.
  expect(el.getAttribute('aria-hidden')).toBe('true');
  expect(el.contains(tip)).toBe(true);
  expect(tip.hasAttribute('role')).toBe(false);
  expect(el.hasAttribute('tabindex')).toBe(false);
  // 지도 쪽 커서도 건드리지 않는다(누를 수 있는 것처럼 보이지 않게).
  expect(map.handlers.has('click:live-pin')).toBe(false);
});

test('a grey "연결 안 됨" pin still shows the name on hover', async () => {
  const { map } = await mountLoaded(withCams);
  const { el, tip } = placePin(map);
  act(() => useConsole.getState().setCctvUnavailable('seocho'));
  hover(map, 400, 297);
  expect(el.classList.contains('is-down')).toBe(true);
  expect(el.classList.contains('is-hover')).toBe(true);
  expect(tip.textContent).toBe('[경부선] 서초');
});

test('the tooltip name follows the active CCTV', async () => {
  reduce = true;
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  await mountLoaded(withCams);
  const tip = livePins()[0]!.element.querySelector('.live-pin__tip')!;
  act(() => useConsole.getState().select('a'));
  expect(tip.textContent).toBe('[경부선] 천안');
  act(() => useConsole.getState().setCctv('near2'));
  expect(tip.textContent).toBe('[경부선] 안성');
});

test('leaving the map hides the tooltip', async () => {
  const { map } = await mountLoaded(withCams);
  const { el } = placePin(map);
  hover(map, 400, 297);
  act(() => map.handlers.get('mouseout')!({}));
  expect(el.classList.contains('is-hover')).toBe(false);
});

test('when the map moves under a still mouse the hover is checked again', async () => {
  const { map } = await mountLoaded(withCams);
  const { el, move } = placePin(map);
  hover(map, 400, 297);
  move(rect(575, 266, 50, 34)); // 지도를 끌어 핀이 오른쪽으로 갔다
  act(() => map.handlers.get('move')!({}));
  expect(el.classList.contains('is-hover')).toBe(false);
  move(rect(375, 266, 50, 34));
  act(() => map.handlers.get('move')!({}));
  expect(el.classList.contains('is-hover')).toBe(true);
});

test('a hidden pin (no active CCTV) never shows a tooltip', async () => {
  const { map, view } = await mountLoaded(withCams);
  const { el } = placePin(map);
  view.rerender(<MapView {...noTraffic} cctvs={[]} />);
  expect(el.hidden).toBe(true);
  hover(map, 400, 297);
  expect(el.classList.contains('is-hover')).toBe(false);
});

test('near the top edge the tooltip flips below the pin; near a side it is nudged inside', async () => {
  const { map } = await mountLoaded(withCams);
  const { el, tip, move } = placePin(map, rect(375, 10, 50, 34));
  hover(map, 400, 40);
  expect(el.classList.contains('is-below')).toBe(true);
  hover(map, 470, 40);
  move(rect(5, 266, 50, 34)); // 왼쪽 끝: 160px 툴팁이 가운데 정렬이면 상자 밖(-50)으로 나간다
  hover(map, 30, 297);
  expect(el.classList.contains('is-below')).toBe(false);
  expect(tip.style.getPropertyValue('--tip-dx')).toBe('58px');
});

test('a pin gliding away under a still mouse drops the tooltip', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  const { map } = await mountLoaded(withCams);
  const { el, move } = placePin(map);
  hover(map, 400, 297);
  expect(el.classList.contains('is-hover')).toBe(true);
  act(() => useConsole.getState().select('a'));
  move(rect(575, 266, 50, 34));
  now = 5_000;
  act(() => frames.shift()!(now));
  expect(el.classList.contains('is-hover')).toBe(false);
});

test('hiding the pin drops the tooltip, and a re-shown pin does not come back hovered', async () => {
  const { map, view } = await mountLoaded(withCams);
  const { el } = placePin(map);
  hover(map, 400, 297);
  view.rerender(<MapView {...noTraffic} cctvs={[]} />);
  expect(el.classList.contains('is-hover')).toBe(false);
  hover(map, 700, 500); // 숨은 동안 마우스가 다른 데로 갔다
  view.rerender(<MapView {...withCams} />);
  expect(el.hidden).toBe(false);
  expect(el.classList.contains('is-hover')).toBe(false);
});

test('a name change while hovering re-measures the tooltip position', async () => {
  reduce = true;
  useConsole.setState({ incidents: { a: inc('a', 'accident', 127.171, 36.79) } });
  const { map } = await mountLoaded(withCams);
  act(() => useConsole.getState().select('a'));
  const { tip } = placePin(map, rect(5, 266, 50, 34));
  hover(map, 30, 297);
  expect(tip.style.getPropertyValue('--tip-dx')).toBe('58px');
  vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue(rect(30 - 120, 232, 240, 28));
  act(() => useConsole.getState().setCctv('near2'));
  expect(tip.style.getPropertyValue('--tip-dx')).toBe('98px');
});

test('the tooltip flips only when it would really cross the top margin, and not if below has no room either', async () => {
  const { map } = await mountLoaded(withCams);
  // 툴팁 위 끝이 상자 위에서 9px: 8px 여백 안쪽이 아니므로 위에 둔다.
  const { el, tip, move } = placePin(map, rect(375, 43, 50, 34));
  hover(map, 400, 70);
  expect(el.classList.contains('is-below')).toBe(false);
  hover(map, 700, 500);
  // 아주 낮은 지도: 위도 아래도 자리가 없으면 위에 둔다.
  vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 60));
  move(rect(375, 10, 50, 34));
  void tip;
  hover(map, 400, 40);
  expect(el.classList.contains('is-below')).toBe(false);
});

test('touch taps do not open the tooltip', async () => {
  const { map } = await mountLoaded(withCams);
  const { el } = placePin(map);
  const box = map.getContainer();
  const pe = new Event('pointerdown') as Event & { pointerType: string };
  pe.pointerType = 'touch';
  act(() => { box.dispatchEvent(pe); });
  hover(map, 400, 297);
  expect(el.classList.contains('is-hover')).toBe(false);
  const pm = new Event('pointermove') as Event & { pointerType: string };
  pm.pointerType = 'mouse';
  act(() => { box.dispatchEvent(pm); });
  hover(map, 400, 297);
  expect(el.classList.contains('is-hover')).toBe(true);
});

// 돌발 점에 마우스를 올리면 그 상황 이름 툴팁. 점은 캔버스에 그려지므로 레이어 mousemove 로 받는다.
const mapTip = () => document.querySelector<HTMLElement>('.map-tip')!;
const overPoints = (map: InstanceType<typeof h.FakeMap>, ...keys: Array<[string, number, number]>) =>
  act(() => map.handlers.get('mousemove:incidents-core')!({
    features: keys.map(([key, lon, lat]) => ({ properties: { key }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
  }));
const leavePoints = (map: InstanceType<typeof h.FakeMap>) => act(() => map.handlers.get('mouseleave:incidents-core')!({}));
function sizeMap(map: InstanceType<typeof h.FakeMap>) {
  vi.spyOn(map.getContainer(), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
  vi.spyOn(mapTip(), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 160, 40));
}
const accident = { ...inc('a', 'accident', 127, 37), roadName: '경부선', message: '**추돌사고** 처리 중' };

test('hovering an incident point shows its category and title above the point', async () => {
  useConsole.setState({ incidents: { a: accident } });
  const { map } = await mountLoaded();
  sizeMap(map);
  const tip = mapTip();
  expect(tip.classList.contains('is-on')).toBe(false);
  overPoints(map, ['a', 127, 37]);
  expect(tip.classList.contains('is-on')).toBe(true);
  expect(tip.querySelector('.map-tip__cat')!.textContent).toBe('교통사고');
  expect(tip.querySelector('.map-tip__name')!.textContent).toBe('경부선 추돌사고 처리 중');
  // 점 (400,300) 위 가운데: left 320, top 300 - 12 - 40.
  expect(tip.style.left).toBe('320px');
  expect(tip.style.top).toBe('248px');
  leavePoints(map);
  expect(tip.classList.contains('is-on')).toBe(false);
});

test('the map tooltip is hidden from screen readers (the feed already lists incidents)', async () => {
  await mountLoaded();
  expect(mapTip().getAttribute('aria-hidden')).toBe('true');
  expect(mapTip().hasAttribute('role')).toBe(false);
});

test('overlapping points show the top one plus how many more', async () => {
  useConsole.setState({ incidents: { a: accident, b: inc('b', 'construction', 127, 37), c: inc('c', 'weather', 127, 37) } });
  const { map } = await mountLoaded();
  sizeMap(map);
  overPoints(map, ['a', 127, 37], ['b', 127, 37], ['b', 127, 37], ['c', 127, 37]);
  expect(mapTip().querySelector('.map-tip__cat')!.textContent).toBe('교통사고 · 외 2건');
});

test('moving to another point updates the tooltip; moving the map hides it', async () => {
  useConsole.setState({ incidents: { a: accident, b: { ...inc('b', 'weather', 128, 36), roadName: '중부선', message: '강풍' } } });
  const { map } = await mountLoaded();
  sizeMap(map);
  overPoints(map, ['a', 127, 37]);
  overPoints(map, ['b', 128, 36]);
  expect(mapTip().querySelector('.map-tip__name')!.textContent).toBe('중부선 강풍');
  expect(mapTip().style.left).toBe('420px');
  act(() => map.handlers.get('movestart')!({}));
  expect(mapTip().classList.contains('is-on')).toBe(false);
});

test('near the top edge the incident tooltip flips below the point', async () => {
  useConsole.setState({ incidents: { a: { ...accident, lat: 39.8 } } });
  const { map } = await mountLoaded();
  sizeMap(map);
  overPoints(map, ['a', 127, 39.8]); // y = 20
  expect(mapTip().classList.contains('is-below')).toBe(true);
  expect(mapTip().style.top).toBe('32px');
});

test('if the hovered incident goes away the tooltip closes; if it changes the text follows', async () => {
  useConsole.setState({ incidents: { a: accident } });
  const { map } = await mountLoaded();
  sizeMap(map);
  overPoints(map, ['a', 127, 37]);
  act(() => useConsole.setState({ incidents: { a: { ...accident, message: '정리 완료' } } }));
  expect(mapTip().querySelector('.map-tip__name')!.textContent).toBe('경부선 정리 완료');
  act(() => useConsole.setState({ incidents: {} }));
  expect(mapTip().classList.contains('is-on')).toBe(false);
});

test('touch taps on a point do not leave a tooltip behind', async () => {
  useConsole.setState({ incidents: { a: accident } });
  const { map } = await mountLoaded();
  sizeMap(map);
  const pe = new Event('pointerdown') as Event & { pointerType: string };
  pe.pointerType = 'touch';
  act(() => { map.getContainer().dispatchEvent(pe); });
  overPoints(map, ['a', 127, 37]);
  expect(mapTip().classList.contains('is-on')).toBe(false);
});

test('the incident tooltip anchors on the incident itself, and follows it when it moves', async () => {
  useConsole.setState({ incidents: { a: accident } });
  const { map } = await mountLoaded();
  sizeMap(map);
  // 렌더된 점 좌표는 타일 양자화로 조금 어긋날 수 있다. 자리는 돌발 자체 좌표로 잡는다.
  overPoints(map, ['a', 127.004, 37.003]);
  expect(mapTip().style.left).toBe('320px');
  act(() => useConsole.setState({ incidents: { a: { ...accident, lon: 128 } } }));
  expect(mapTip().style.left).toBe('420px');
});

test('label and anchor come from the same feature when the top hit has no key', async () => {
  useConsole.setState({ incidents: { b: { ...inc('b', 'weather', 128, 36), roadName: '중부선', message: '강풍' } } });
  const { map } = await mountLoaded();
  sizeMap(map);
  act(() => map.handlers.get('mousemove:incidents-core')!({
    features: [
      { properties: null, geometry: { type: 'Point', coordinates: [127, 37] } },
      { properties: { key: 'b' }, geometry: { type: 'Point', coordinates: [128, 36] } },
    ],
  }));
  expect(mapTip().querySelector('.map-tip__name')!.textContent).toBe('중부선 강풍');
  expect(mapTip().style.left).toBe('420px');
});

test('Enter selects the point the tooltip is showing, even after sliding between adjacent points', async () => {
  useConsole.setState({ incidents: { a: accident, b: inc('b', 'weather', 127.05, 37) } });
  const { map } = await mountLoaded();
  sizeMap(map);
  act(() => map.handlers.get('mouseenter:incidents-core')!({ features: [{ properties: { key: 'a' } }] }));
  overPoints(map, ['a', 127, 37]);
  overPoints(map, ['b', 127.05, 37]);
  act(() => { map.getCanvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  expect(useConsole.getState().selectedKey).toBe('b');
});

test('flow lines draw a pattern image per level, not a dasharray (changing a dasharray re-tiles the whole source)', async () => {
  const { map } = await mountLoaded();
  for (const set of ['a', 'b']) for (const i of [0, 1, 2, 3, 4]) {
    const paint = map.getLayer(`hw-${set}-flow-${i}`)!.paint;
    expect(paint['line-pattern']).toBe(`flow-${i}`);
    expect(paint).not.toHaveProperty('line-dasharray');
  }
  expect([...map.images]).toEqual(['flow-0', 'flow-1', 'flow-2', 'flow-3', 'flow-4']);
  expect(map.setPaintProperty.mock.calls.some(([, prop]) => prop === 'line-dasharray')).toBe(false);
});

test('the map retries base-map tiles that failed to load instead of leaving a hole', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { map } = await mountLoaded();
  act(() => map.handlers.get('error')!({ error: new Error('Failed to fetch'), sourceId: 'openmaptiles', tile: { tileID: { canonical: { z: 7, x: 109, y: 50 } } } }));
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(map.refreshTiles).toHaveBeenCalledWith('openmaptiles', [{ z: 7, x: 109, y: 50 }]);
  vi.useRealTimers();
});
