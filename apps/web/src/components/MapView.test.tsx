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
  class FakeMap {
    handlers = new Map<string, Handler>();
    layers: Array<{ id: string; paint: Record<string, unknown> }> = [];
    easeTo = vi.fn();
    jumpTo = vi.fn();
    touchZoomRotate = { disableRotation: () => {} };
    constructor() {
      state.maps.push(this);
    }
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === 'function') this.handlers.set(event, a as Handler);
      else this.handlers.set(`${event}:${String(a)}`, b as Handler);
    }
    addControl() {}
    addSource() {}
    addLayer(l: { id: string; paint: Record<string, unknown> }) {
      this.layers.push(l);
    }
    getSource() {
      return { setData: () => {} };
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

async function mountLoaded() {
  render(<MapView />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const map = h.state.maps.at(-1)!;
  act(() => map.handlers.get('load')!());
  return map;
}

beforeEach(() => {
  h.state.maps.length = 0;
  h.state.markers = 0;
  reduce = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
  useConsole.setState(useConsole.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('selecting an incident moves the map to it', async () => {
  useConsole.setState({ incidents: { a: inc('a', 'accident', 128.5, 35.9) } });
  const map = await mountLoaded();
  act(() => useConsole.getState().select('a'));
  expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [128.5, 35.9] }));
});

test('under reduced motion selection jumps without animating', async () => {
  reduce = true;
  useConsole.setState({ incidents: { a: inc('a', 'accident', 128.5, 35.9) } });
  const map = await mountLoaded();
  act(() => useConsole.getState().select('a'));
  expect(map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ center: [128.5, 35.9] }));
  expect(map.easeTo).not.toHaveBeenCalled();
});

test('a fresh accident pulses and pans, a fresh construction stays quiet', async () => {
  const map = await mountLoaded();
  act(() => useConsole.getState().applyServerMessage(arrived(1, inc('w', 'construction')), new Date()));
  expect(h.state.markers).toBe(0);
  expect(map.easeTo).not.toHaveBeenCalled();
  act(() => useConsole.getState().applyServerMessage(arrived(2, inc('x', 'accident')), new Date()));
  expect(h.state.markers).toBe(1);
  expect(map.easeTo).toHaveBeenCalledTimes(1);
});

test('construction has no halo', async () => {
  const map = await mountLoaded();
  const halo = map.layers.find((l) => l.id === 'incidents-halo')!;
  expect(halo.paint['circle-radius']).toEqual(['case', ['==', ['get', 'category'], 'construction'], 0, 14]);
});
