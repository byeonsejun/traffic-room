'use client';

import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Incident } from '@traffic-room/shared';
import { categoryColor } from '@/lib/tokens';
import { isLoudArrival, useConsole } from '@/store/console';

const KOREA_BOUNDS: [number, number, number, number] = [124.5, 33.0, 131.0, 38.7];
const SOURCE = 'incidents';
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

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MapView() {
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

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
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
      pulses.forEach((m) => m.remove());
      pulses.clear();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [select]);

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
    if (reducedMotion()) map.jumpTo({ center });
    else map.easeTo({ center, duration: 800 });
  }, [selectedKey, selLon, selLat, ready]);

  useEffect(() => {
    const top = feed[0];
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml || !top || !isLoudArrival(top)) return;
    if (pulsed.current.has(top.id)) return;
    pulsed.current.add(top.id);
    if (reducedMotion()) return;

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

  return <div ref={box} className="map-view" role="application" aria-label="전국 돌발 상황 지도" />;
}
