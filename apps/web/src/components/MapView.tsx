'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GeoJSONSource, MapSourceDataEvent, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Incident } from '@traffic-room/shared';
import { FLOW_LEVELS, dashAt, flowLayerId, prefersReducedMotion, startFlow } from '@/lib/flow';
import { toGeoJson as highwaysGeoJson, type HighwaysFile } from '@/lib/highways';
import { logFailure } from '@/lib/log';
import { hhmm } from '@/lib/time';
import { categoryColor, tokens } from '@/lib/tokens';
import { isLoudArrival, useConsole } from '@/store/console';

const KOREA_BOUNDS: [number, number, number, number] = [124.5, 33.0, 131.0, 38.7];
// 끌거나 줄여도 한국 밖으로 나가지 않게 묶는다.
const MAX_BOUNDS: [[number, number], [number, number]] = [[123.5, 32.5], [132.5, 39.3]];
const MIN_ZOOM = 5.5;
const SOURCE = 'incidents';
const HW_SOURCE = 'highways';
const HW_PATH = '/highways.json';
const PULSE_MS = 1400 * 3;
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
// 속도 색은 처음 들어올 때 바탕선 위로 서서히 떠오른다.
const SHOWN_OPACITY: Record<string, number> = { 'hw-glow': 0.5, 'hw-speed': 1, ...Object.fromEntries(FLOW_LEVELS.map((_, i) => [flowLayerId(i), 0.9])) };

/** 바탕선 → 번짐 → 속도선 → 단계별 흐름. 모두 돌발 점 아래에 둔다. */
function addHighwayLayers(map: MlMap, still: boolean) {
  const fade = { duration: still ? 0 : 1500, delay: 0 };
  map.addSource(HW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const add = (layer: Record<string, unknown>) =>
    map.addLayer({ source: HW_SOURCE, type: 'line', ...layer } as Parameters<MlMap['addLayer']>[0], 'incidents-halo');
  add({
    id: 'hw-base',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': BASE_COLOR, 'line-width': LINE_WIDTH },
  });
  add({
    id: 'hw-glow', filter: hasSpeed,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': speedColor, 'line-color-transition': fade,
      'line-width': zoomed(6, 12, 22), 'line-blur': zoomed(5, 9, 16), 'line-offset': DIRECTION_OFFSET,
      'line-opacity': 0, 'line-opacity-transition': fade,
    },
  });
  add({
    id: 'hw-speed', filter: hasSpeed,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': speedColor, 'line-color-transition': fade, 'line-width': LINE_WIDTH,
      'line-offset': DIRECTION_OFFSET, 'line-opacity': 0, 'line-opacity-transition': fade,
    },
  });
  FLOW_LEVELS.forEach((_, i) =>
    add({
      id: flowLayerId(i), filter: ['==', ['get', 'lv'], i],
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        // 속도선보다 가늘게 해서 색 테두리 안에 밝은 빛줄기가 흐르게 한다.
        'line-color': flowColor, 'line-color-transition': fade, 'line-width': zoomed(0.9, 2, 4),
        'line-offset': DIRECTION_OFFSET, 'line-dasharray': dashAt(0),
        'line-opacity': 0, 'line-opacity-transition': fade,
      },
    }),
  );
}

type Props = {
  speeds: Map<string, number> | null;
  trafficDataAt: string | null;
  trafficError: boolean;
};

export function MapView({ speeds, trafficDataAt, trafficError }: Props) {
  const incidents = useConsole((s) => s.incidents);
  const feed = useConsole((s) => s.feed);
  const select = useConsole((s) => s.select);
  const selectedKey = useConsole((s) => s.selectedKey);
  const selected = useConsole((s) => (s.selectedKey ? s.incidents[s.selectedKey] : undefined));

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Set<Marker>());
  const pulsed = useRef(new Set<number>());
  // 지도 load 때 넣을 최신 목록. 렌더 중이 아니라 커밋 뒤에 갱신한다.
  const latest = useRef(incidents);
  useEffect(() => {
    latest.current = incidents;
  }, [incidents]);
  const [ready, setReady] = useState(false);
  const highways = useRef<HighwaysFile | null>(null);
  const [highwaysReady, setHighwaysReady] = useState(false);
  const revealed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFlow = () => {};
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
            addHighwayLayers(map, prefersReducedMotion());
            highways.current = file;
            stopFlow = startFlow(map);
            setHighwaysReady(true);
          })
          .catch((e: unknown) => {
            if (!cancelled) logFailure('highways', e);
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

    return () => {
      cancelled = true;
      ac.abort();
      stopFlow();
      pulses.forEach((m) => m.remove());
      pulses.clear();
      map?.remove();
      mapRef.current = null;
      highways.current = null;
      revealed.current = false;
      setReady(false);
      setHighwaysReady(false);
    };
  }, [select]);

  useEffect(() => {
    const map = mapRef.current;
    const file = highways.current;
    if (!highwaysReady || !map || !file) return;
    (map.getSource(HW_SOURCE) as GeoJSONSource | undefined)?.setData(highwaysGeoJson(file, speeds));
    if (!speeds || revealed.current) return;
    // 바탕선만 있던 화면에 속도 색이 처음 올라올 때 한 번 서서히 띄운다.
    // 레이어를 막 추가한 같은 틱에 바꾸면 전환 없이 바로 켜지므로, 새 데이터가 타일로 다 만들어진 뒤에 올린다.
    const reveal = (e: MapSourceDataEvent) => {
      if (e.sourceId !== HW_SOURCE || !e.isSourceLoaded) return;
      map.off('sourcedata', reveal);
      revealed.current = true;
      for (const [id, opacity] of Object.entries(SHOWN_OPACITY)) map.setPaintProperty(id, 'line-opacity', opacity);
    };
    map.on('sourcedata', reveal);
    return () => {
      map.off('sourcedata', reveal);
    };
  }, [speeds, highwaysReady]);

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
      <Legend dataAt={trafficDataAt} error={trafficError} />
    </>
  );
}

const LEGEND = [
  { label: '원활', range: '70+', color: tokens.flow },
  { label: '서행', range: '40–70', color: tokens.slow },
  { label: '정체', range: '<40', color: tokens.jam },
];

function Legend({ dataAt, error }: { dataAt: string | null; error: boolean }) {
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
      {error ? (
        <p className="is-error">교통 정보를 불러오지 못했어요</p>
      ) : dataAt ? (
        <p>{`교통 ${hhmm(dataAt)} 기준`}</p>
      ) : null}
    </div>
  );
}
