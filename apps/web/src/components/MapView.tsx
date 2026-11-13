'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GeoJSONSource, MapSourceDataEvent, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Cctv, Incident } from '@traffic-room/shared';
import { FLOW_LEVELS, SPEED_SETS, dashAt, flowLayerId, prefersReducedMotion, startFlow, type SpeedSet } from '@/lib/flow';
import { toGeoJson as highwaysGeoJson, speedGeoJson, type HighwaysFile } from '@/lib/highways';
import { logFailure } from '@/lib/log';
import { hhmm } from '@/lib/time';
import { categoryColor, tokens } from '@/lib/tokens';
import { isLoudArrival, useConsole } from '@/store/console';
import { useActiveCctv } from './useActiveCctv';

const KOREA_BOUNDS: [number, number, number, number] = [124.5, 33.0, 131.0, 38.7];
// 끌거나 줄여도 한국 밖으로 나가지 않게 묶는다.
const MAX_BOUNDS: [[number, number], [number, number]] = [[123.5, 32.5], [132.5, 39.3]];
const MIN_ZOOM = 5.5;
const SOURCE = 'incidents';
const HW_SOURCE = 'highways';
const speedSource = (set: SpeedSet) => `highways-${set}`;
const FADE_MS = 1500;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const HW_PATH = '/highways.json';
const PULSE_MS = 1400 * 3;
// 지금 보는 CCTV 핀이 새 자리로 미끄러지는 시간. 지도 이동(800ms)과 비슷하게 맞춘다.
const PIN_GLIDE_MS = 700;
const NO_CCTVS: Cctv[] = [];
const WORKER_PATH = '/maplibre-gl-worker.mjs'; // scripts/copy-maplibre-worker.mjs 가 dev · build 전에 복사한다.

const toGeoJson = (incidents: Record<string, Incident>) => ({
  type: 'FeatureCollection' as const,
  features: Object.values(incidents).map((i) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [i.lon, i.lat] },
    properties: { key: i.key, category: i.category, color: categoryColor(i.category) },
  })),
});

// 데이터 없는 구간도 끊겨 보이지 않게 패널 선(#1D2A3A)보다 한 단 밝은 회색으로 깐다.
const BASE_COLOR = '#3D4F66';
// 단계 경계는 @traffic-room/shared 의 speedLevel 과 같다(정체 < 40 ≤ 서행 < 70 ≤ 원활).
const speedColor = ['step', ['get', 's'], tokens.jam, 40, tokens.slow, 70, tokens.flow];
// 흐르는 점선은 같은 색을 밝힌 빛줄기.
const flowColor = ['step', ['get', 's'], '#FFC4C5', 40, '#FFE6AE', 70, '#C4F8DB'];
const hasSpeed = ['==', ['typeof', ['get', 's']], 'number'];
const zoomed = (z6: number, z10: number, z14: number) =>
  ['interpolate', ['linear'], ['zoom'], 6, z6, 10, z10, 14, z14];
const LINE_WIDTH = zoomed(1.2, 3, 6);
// 구간은 방향마다 따로 있다. 확대하면 진행 방향 오른쪽(우측 통행)으로 반 폭씩 밀어 상 · 하행이 나란히 흐르게 한다.
const DIRECTION_OFFSET = ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 1.5, 14, 3];
// 한 벌이 보일 때 레이어마다의 불투명도. 숨은 벌은 모두 0.
const shownOpacity = (set: SpeedSet): Record<string, number> => ({
  [`hw-${set}-glow`]: 0.5,
  [`hw-${set}-speed`]: 1,
  ...Object.fromEntries(FLOW_LEVELS.map((_, i) => [flowLayerId(set, i), 0.9])),
});
const fadeFor = (still: boolean) => ({ duration: still ? 0 : FADE_MS, delay: 0 });

function setSetOpacity(map: MlMap, set: SpeedSet, visible: boolean) {
  for (const [id, opacity] of Object.entries(shownOpacity(set))) map.setPaintProperty(id, 'line-opacity', visible ? opacity : 0);
}

/**
 * 바탕선(모든 구간, 한 번만 받음) 위에 속도선 두 벌(A · B)을 깐다. 벌마다 번짐 → 속도선 → 단계별 흐름.
 * 처음에는 두 벌 다 불투명도 0 이고, 새 속도는 숨은 벌에 쓴 뒤 불투명도를 맞바꿔 서서히 바꾼다.
 * 모두 돌발 점 아래에 둔다.
 */
function addHighwayLayers(map: MlMap, file: HighwaysFile, still: boolean) {
  const fade = fadeFor(still);
  const empty = { type: 'FeatureCollection' as const, features: [] };
  map.addSource(HW_SOURCE, { type: 'geojson', data: highwaysGeoJson(file, null) });
  const add = (source: string, layer: Record<string, unknown>) =>
    map.addLayer({ source, type: 'line', ...layer } as Parameters<MlMap['addLayer']>[0], 'incidents-halo');
  add(HW_SOURCE, {
    id: 'hw-base',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': BASE_COLOR, 'line-width': LINE_WIDTH },
  });
  for (const set of SPEED_SETS) {
    const source = speedSource(set);
    map.addSource(source, { type: 'geojson', data: empty });
    add(source, {
      id: `hw-${set}-glow`, filter: hasSpeed,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': speedColor,
        'line-width': zoomed(6, 12, 22), 'line-blur': zoomed(5, 9, 16), 'line-offset': DIRECTION_OFFSET,
        'line-opacity': 0, 'line-opacity-transition': fade,
      },
    });
    add(source, {
      id: `hw-${set}-speed`, filter: hasSpeed,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': speedColor, 'line-width': LINE_WIDTH,
        'line-offset': DIRECTION_OFFSET, 'line-opacity': 0, 'line-opacity-transition': fade,
      },
    });
    FLOW_LEVELS.forEach((_, i) =>
      add(source, {
        id: flowLayerId(set, i), filter: ['==', ['get', 'lv'], i],
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          // 속도선보다 가늘게 해서 색 테두리 안에 밝은 빛줄기가 흐르게 한다.
          'line-color': flowColor, 'line-width': zoomed(0.9, 2, 4),
          'line-offset': DIRECTION_OFFSET, 'line-dasharray': dashAt(0),
          'line-opacity': 0, 'line-opacity-transition': fade,
        },
      }),
    );
  }
}

/** 흐름 루프 켜고 끄기. 이미 돌고 있거나 reduced motion 이면 켜지 않는다. */
function flowSwitch() {
  let stop: (() => void) | null = null;
  return {
    run(map: MlMap) {
      if (stop || prefersReducedMotion()) return;
      stop = startFlow(map);
    },
    halt() {
      stop?.();
      stop = null;
    },
  };
}

/** reduced motion 이 켜지고 꺼질 때 바꿈 전환 시간을 맞춘다. */
function setFade(map: MlMap, still: boolean) {
  const fade = fadeFor(still);
  for (const set of SPEED_SETS) for (const id of Object.keys(shownOpacity(set))) map.setPaintProperty(id, 'line-opacity-transition', fade);
}

type LivePin = {
  marker: Marker;
  el: HTMLElement;
  label: HTMLElement;
  at: [number, number];
  frame: number;
};

/**
 * 지금 CCTV 패널이 트는 CCTV 자리 핀. "실시간" 알약 → 짧은 꼬리 → 그 좌표의 점.
 * 꼬리 끝 점의 가운데가 요소 아래 변에 오게 해 두어 anchor bottom 이면 점이 정확히 그 좌표에 놓인다.
 */
function createLivePin(ml: typeof import('maplibre-gl'), map: MlMap, at: [number, number]): LivePin {
  const el = document.createElement('div');
  el.className = 'live-pin';
  // 보여 주기만 하는 표시다. CCTV 이름은 패널에 있으니 스크린 리더와 포인터 모두 지나치게 한다(CSS 도 pointer-events: none).
  el.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'live-pin__label';
  const tail = document.createElement('span');
  tail.className = 'live-pin__tail';
  const dot = document.createElement('span');
  dot.className = 'live-pin__dot';
  el.append(label, tail, dot);
  const marker = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat(at).addTo(map);
  return { marker, el, label, at, frame: 0 };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** 핀을 새 자리로 옮긴다. reduced motion 이면 바로, 아니면 잠깐 미끄러지듯. */
function moveLivePin(pin: LivePin, to: [number, number]) {
  cancelAnimationFrame(pin.frame);
  const from = pin.at;
  if (prefersReducedMotion() || (from[0] === to[0] && from[1] === to[1])) {
    pin.at = to;
    pin.marker.setLngLat(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / PIN_GLIDE_MS);
    const k = easeInOut(t);
    pin.at = t === 1 ? to : [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
    pin.marker.setLngLat(pin.at);
    if (t < 1) pin.frame = requestAnimationFrame(step);
  };
  pin.frame = requestAnimationFrame(step);
}

type Props = {
  /** CCTV 목록. 지금 패널이 트는 CCTV 자리에 핀을 꽂는다. */
  cctvs?: Cctv[];
  speeds: Map<string, number> | null;
  trafficDataAt: string | null;
  trafficError: boolean;
};

export function MapView({ cctvs = NO_CCTVS, speeds, trafficDataAt, trafficError }: Props) {
  const incidents = useConsole((s) => s.incidents);
  const feed = useConsole((s) => s.feed);
  const select = useConsole((s) => s.select);
  const selectedKey = useConsole((s) => s.selectedKey);
  const selected = useConsole((s) => (s.selectedKey ? s.incidents[s.selectedKey] : undefined));
  const { active: cctv } = useActiveCctv(cctvs);
  const cctvUnavailable = useConsole((s) => s.cctvUnavailable);

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Set<Marker>());
  const pulsed = useRef(new Set<number>());
  const livePin = useRef<LivePin | null>(null);
  // 지도 load 때 넣을 최신 목록. 렌더 중이 아니라 커밋 뒤에 갱신한다.
  const latest = useRef(incidents);
  useEffect(() => {
    latest.current = incidents;
  }, [incidents]);
  const [ready, setReady] = useState(false);
  const highways = useRef<HighwaysFile | null>(null);
  const [highwaysReady, setHighwaysReady] = useState(false);
  const [roadsError, setRoadsError] = useState(false);
  // 지금 보이는 속도선 벌. null 이면 아직 속도를 띄운 적이 없다.
  const visibleSet = useRef<SpeedSet | null>(null);
  // 흐름 루프는 속도가 처음 보일 때 시작한다. 교통을 못 받으면 쓸데없이 다시 그리지 않는다.
  const [flow] = useState(flowSwitch);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let motion: MediaQueryList | null = null;
    const ac = new AbortController();
    const pulses = markers.current;

    (async () => {
      const ml = await import('maplibre-gl');
      if (cancelled || !box.current) return;
      mlRef.current = ml;
      // 번들 안에서는 워커 기본 주소(import.meta.url 옆)가 깨지므로 public/ 에 복사한 워커를 쓴다.
      // 버전을 붙여 패키지를 올렸을 때 예전 워커가 캐시에서 나오지 않게 한다.
      ml.setWorkerUrl(`${WORKER_PATH}?v=${ml.getVersion()}`);
      map = new ml.Map({
        container: box.current,
        style: '/map-style.json',
        bounds: KOREA_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        maxBounds: MAX_BOUNDS,
        minZoom: MIN_ZOOM,
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: true },
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
      mapRef.current = map;

      let hovered: string | null = null;
      map.on('load', () => {
        if (!map) return;
        map.addSource(SOURCE, { type: 'geojson', data: toGeoJson(latest.current) });
        map.addLayer({
          id: 'incidents-halo', type: 'circle', source: SOURCE,
          // 공사는 수가 많고 오래 이어져 후광 없이 흐린 점만 둔다.
          paint: {
            'circle-radius': ['case', ['==', ['get', 'category'], 'construction'], 0, 14],
            'circle-opacity': 0.18,
            'circle-color': ['get', 'color'],
          },
        });
        map.addLayer({
          id: 'incidents-core', type: 'circle', source: SOURCE,
          paint: {
            'circle-radius': ['case', ['==', ['get', 'category'], 'construction'], 3, 4.5],
            'circle-opacity': ['case', ['==', ['get', 'category'], 'construction'], 0.6, 1],
            'circle-color': ['get', 'color'],
          },
        });
        map.on('click', 'incidents-core', (e) => {
          const key = e.features?.[0]?.properties?.key;
          if (typeof key === 'string') select(key);
        });
        map.on('mouseenter', 'incidents-core', (e) => {
          map!.getCanvas().style.cursor = 'pointer';
          const key = e.features?.[0]?.properties?.key;
          hovered = typeof key === 'string' ? key : null;
        });
        map.on('mouseleave', 'incidents-core', () => {
          map!.getCanvas().style.cursor = '';
          hovered = null;
        });
        setReady(true);

        // 1.5MB 라 지도와 돌발 점이 먼저 뜬 뒤에 받는다.
        fetch(HW_PATH, { signal: ac.signal })
          .then((r) => {
            if (!r.ok) throw new Error(`highways ${r.status}`);
            return r.json() as Promise<HighwaysFile>;
          })
          .then((file) => {
            if (cancelled || !map) return;
            addHighwayLayers(map, file, prefersReducedMotion());
            highways.current = file;
            setHighwaysReady(true);
            // 보는 중에 동작 줄이기 설정을 바꾸면 흐름과 바꿈 전환을 바로 따라 바꾼다.
            if (typeof window.matchMedia === 'function') {
              motion = window.matchMedia(REDUCED_MOTION);
              motion.addEventListener('change', onMotionChange);
            }
          })
          .catch((e: unknown) => {
            if (cancelled || (e instanceof Error && e.name === 'AbortError')) return;
            logFailure('highways', e);
            setRoadsError(true);
          });
      });

      // 키보드: 지도에 포커스를 두고 점 위에 포인터가 있거나 화면 중앙에 가장 가까운 점에서 Enter.
      map.getCanvas().addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || !map) return;
        if (hovered) return select(hovered);
        const c = map.getContainer();
        const r = 40;
        const hits = map.queryRenderedFeatures(
          [[c.clientWidth / 2 - r, c.clientHeight / 2 - r], [c.clientWidth / 2 + r, c.clientHeight / 2 + r]],
          { layers: ['incidents-core'] },
        );
        const key = hits[0]?.properties?.key;
        if (typeof key === 'string') select(key);
      });
    })();

    const onMotionChange = () => {
      if (!map) return;
      const still = prefersReducedMotion();
      setFade(map, still);
      if (still) flow.halt();
      else if (visibleSet.current) flow.run(map);
    };

    return () => {
      cancelled = true;
      ac.abort();
      motion?.removeEventListener('change', onMotionChange);
      flow.halt();
      pulses.forEach((m) => m.remove());
      pulses.clear();
      if (livePin.current) {
        cancelAnimationFrame(livePin.current.frame);
        livePin.current.marker.remove();
        livePin.current = null;
      }
      map?.remove();
      mapRef.current = null;
      highways.current = null;
      visibleSet.current = null;
      setReady(false);
      setHighwaysReady(false);
      setRoadsError(false);
    };
  }, [select, flow]);

  useEffect(() => {
    const map = mapRef.current;
    const file = highways.current;
    if (!highwaysReady || !map || !file) return;
    const shown = visibleSet.current;
    if (!speeds) {
      // 받아 둔 속도를 거두는 일은 지금 없지만, 그렇게 되면 바탕선만 남긴다.
      if (shown) setSetOpacity(map, shown, false);
      visibleSet.current = null;
      flow.halt();
      return;
    }
    // 새 속도는 숨은 벌에 쓴다. 보이는 벌은 새 색이 준비될 때까지 그대로 둔다.
    const next: SpeedSet = shown === 'a' ? 'b' : 'a';
    (map.getSource(speedSource(next)) as GeoJSONSource | undefined)?.setData(speedGeoJson(file, speeds));
    // 레이어를 막 추가하거나 데이터를 막 바꾼 같은 틱에 올리면 전환 없이 바로 켜지거나 빈 타일이 비치므로,
    // 새 데이터가 타일로 다 만들어진 뒤에 두 벌의 불투명도를 맞바꾼다(reduced motion 이면 바로 바뀐다).
    // 1.5초 전환이 끝나기 전에 또 갱신이 오면(시간당 한 번이라 거의 없다) 사라지던 벌에 새 속도를 쓰고,
    // 그 벌이 지금 불투명도에서 다시 떠오른다. 색은 맞지만 그 한 번은 매끄럽지 않을 수 있다.
    const swap = (e: MapSourceDataEvent) => {
      if (e.sourceId !== speedSource(next) || !e.isSourceLoaded) return;
      map.off('sourcedata', swap);
      setSetOpacity(map, next, true);
      if (shown) setSetOpacity(map, shown, false);
      visibleSet.current = next;
      flow.run(map);
    };
    map.on('sourcedata', swap);
    return () => {
      map.off('sourcedata', swap);
    };
  }, [speeds, highwaysReady, flow]);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(toGeoJson(incidents));
  }, [incidents, ready]);

  // 피드 · 지도 · 키보드 어디서 고르든 고른 돌발로 지도를 옮긴다.
  const selLon = selected?.lon;
  const selLat = selected?.lat;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedKey || selLon === undefined || selLat === undefined) return;
    const center: [number, number] = [selLon, selLat];
    if (prefersReducedMotion()) map.jumpTo({ center });
    else map.easeTo({ center, duration: 800 });
  }, [selectedKey, selLon, selLat, ready]);

  // 지금 보는 CCTV 핀: 처음 한 번 만들고, 패널이 다른 CCTV 를 틀면 setLngLat 으로 옮긴다.
  const camLon = cctv?.lon;
  const camLat = cctv?.lat;
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    const pin = livePin.current;
    if (camLon === undefined || camLat === undefined) {
      if (pin) pin.el.hidden = true;
      return;
    }
    const to: [number, number] = [camLon, camLat];
    if (!pin) {
      livePin.current = createLivePin(ml, map, to);
    } else if (pin.el.hidden) {
      pin.el.hidden = false;
      cancelAnimationFrame(pin.frame);
      pin.at = to;
      pin.marker.setLngLat(to);
    } else {
      moveLivePin(pin, to);
    }
  }, [ready, camLon, camLat]);

  // 보는 중에 동작 줄이기 설정을 바꾸면 핀 맥박도 바로 따라 켜고 끈다.
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED_MOTION);
    const sync = () => setStill(prefersReducedMotion());
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 패널이 이 CCTV 를 틀지 못하면 핀도 회색으로 바꾸고 "실시간"이라 하지 않는다.
  const hasCam = !!cctv;
  const down = !!cctv && cctvUnavailable === cctv.id;
  useEffect(() => {
    const pin = livePin.current;
    if (!ready || !pin || !hasCam) return;
    pin.label.textContent = down ? '연결 안 됨' : '실시간';
    pin.el.classList.toggle('is-down', down);
    pin.el.classList.toggle('is-pulsing', !down && !still);
  }, [ready, hasCam, camLon, camLat, down, still]);

  useEffect(() => {
    const top = feed[0];
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml || !top || !isLoudArrival(top)) return;
    if (pulsed.current.has(top.id)) return;
    pulsed.current.add(top.id);
    if (prefersReducedMotion()) return;

    const { lon, lat, category } = top.incident;
    const el = document.createElement('div');
    el.className = 'pulse-marker';
    el.style.setProperty('--pulse', categoryColor(category));
    el.setAttribute('aria-hidden', 'true');
    const ring = document.createElement('span');
    el.appendChild(ring);
    const marker = new ml.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
    markers.current.add(marker);
    const done = () => { marker.remove(); markers.current.delete(marker); };
    ring.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, PULSE_MS + 400);
    map.easeTo({ center: [lon, lat], duration: 1200 });
  }, [feed, ready]);

  return (
    <>
      <div ref={box} className="map-view" role="application" aria-label="전국 고속도로 소통과 돌발 상황 지도" />
      <Legend dataAt={trafficDataAt} error={trafficError} roadsError={roadsError} />
    </>
  );
}

const LEGEND = [
  { label: '원활', range: '70+', color: tokens.flow },
  { label: '서행', range: '40–70', color: tokens.slow },
  { label: '정체', range: '<40', color: tokens.jam },
];

function Legend({ dataAt, error, roadsError }: { dataAt: string | null; error: boolean; roadsError: boolean }) {
  return (
    <div className="map-legend" role="group" aria-label="도로 색 범례">
      <ul>
        {LEGEND.map((l) => (
          <li key={l.label} style={{ '--swatch': l.color } as CSSProperties}>
            <i aria-hidden="true" />
            <span>{l.label}</span>
            <small>{l.range}</small>
          </li>
        ))}
        <li className="is-none" style={{ '--swatch': BASE_COLOR } as CSSProperties}>
          <i aria-hidden="true" />
          <span>데이터 없음</span>
        </li>
      </ul>
      {roadsError && <p className="is-error">도로 정보를 불러오지 못했어요</p>}
      {error ? (
        <p className="is-error">교통 정보를 불러오지 못했어요</p>
      ) : dataAt ? (
        <p>{`교통 ${hhmm(dataAt)} 기준`}</p>
      ) : null}
    </div>
  );
}
