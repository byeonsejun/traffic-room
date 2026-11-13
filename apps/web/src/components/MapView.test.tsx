import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Category, Incident, ServerMessage } from '@traffic-room/shared';
import { useConsole } from '@/store/console';
import { MapView } from './MapView';

// maplibre 는 WebGL 이 필요하다. 지도에 무엇을 부탁했는지만 기록하는 가짜로 바꾼다.
const h = vi.hoisted(() => {
  const state = {
    maps: [] as FakeMap[],
    markers: 0,
  };
  type Handler = (...args: unknown[]) => void;
  type Layer = { id: string; paint: Record<string, unknown>; filter?: unknown };
  class FakeMap {
    handlers = new Map<string, Handler>();
    layers: Layer[] = [];
    before = new Map<string, string | undefined>();
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
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
    addSource(id: string) {
      this.sources.set(id, { setData: vi.fn() });
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
    constructor() {
      state.markers += 1;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
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

beforeEach(() => {
  h.state.maps.length = 0;
  h.state.markers = 0;
  reduce = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  fetchMock.mockClear();
  useConsole.setState(useConsole.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

test('highway lines stack base → glow → speed → flow, all under the incident dots', async () => {
  const { map } = await mountLoaded();
  expect(fetchMock).toHaveBeenCalledWith('/highways.json', expect.anything());
  const hw = map.layers.filter((l) => l.id.startsWith('hw-')).map((l) => l.id);
  expect(hw).toEqual(['hw-base', 'hw-glow', 'hw-speed', 'hw-flow-0', 'hw-flow-1', 'hw-flow-2', 'hw-flow-3', 'hw-flow-4']);
  for (const id of hw) expect(map.before.get(id)).toBe('incidents-halo');
  expect(map.getLayer('hw-flow-3')!.filter).toEqual(['==', ['get', 'lv'], 3]);
  expect(map.getLayer('hw-speed')!.paint['line-color-transition']).toEqual({ duration: 1500, delay: 0 });
});

test('under reduced motion colours change without a transition', async () => {
  reduce = true;
  const { map } = await mountLoaded();
  expect(map.getLayer('hw-speed')!.paint['line-color-transition']).toEqual({ duration: 0, delay: 0 });
});

test('new speeds are pushed into the highway source', async () => {
  const { map, view } = await mountLoaded();
  const setData = map.getSource('highways')!.setData;
  setData.mockClear();
  view.rerender(<MapView speeds={new Map([['A', 75]])} trafficDataAt="2026-11-13T02:00:00.000Z" trafficError={false} />);
  expect(setData).toHaveBeenCalledTimes(1);
  const fc = setData.mock.calls[0]![0] as { features: Array<{ properties: unknown }> };
  expect(fc.features.map((f) => f.properties)).toEqual([{ s: 75, lv: 3 }, { s: null, lv: null }]);
});

test('speed colours fade in only once the new data has been tiled', async () => {
  const { map, view } = await mountLoaded();
  view.rerender(<MapView speeds={new Map([['A', 75]])} trafficDataAt="2026-11-13T02:00:00.000Z" trafficError={false} />);
  const opacity = () => map.setPaintProperty.mock.calls.filter(([, prop]) => prop === 'line-opacity');
  expect(opacity()).toHaveLength(0);
  act(() => map.handlers.get('sourcedata')!({ sourceId: 'highways', isSourceLoaded: true }));
  expect(opacity().map(([id]) => id)).toEqual(expect.arrayContaining(['hw-glow', 'hw-speed', 'hw-flow-0', 'hw-flow-4']));
});

test('the legend names each state and the traffic time', async () => {
  const { view } = await mountLoaded({ speeds: new Map(), trafficDataAt: '2026-11-13T02:00:00.000Z', trafficError: false });
  for (const label of ['원활', '서행', '정체', '데이터 없음', '교통 11:00 기준']) expect(view.getByText(label)).toBeTruthy();
});

test('when traffic fails the legend says so', async () => {
  const { view } = await mountLoaded({ speeds: null, trafficDataAt: null, trafficError: true });
  expect(view.getByText('교통 정보를 불러오지 못했어요')).toBeTruthy();
});
