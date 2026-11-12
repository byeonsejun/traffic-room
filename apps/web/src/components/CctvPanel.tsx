'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cctv, ClientMessage } from '@traffic-room/shared';
import { nearestCctvs } from '@/lib/geo';
import { useConsole } from '@/store/console';

const DEFAULT_NAME = '[경부선] 서초';
const GUIDE = '이 CCTV 영상을 지금 불러올 수 없어요. 다른 CCTV를 골라 보세요.';
const REFRESH_WAIT_MS = 10_000;
const HLS_TYPE = 'application/vnd.apple.mpegurl';

const chipLabel = (name: string) => name.replace(/\[.*?\]\s*/, '');

export function CctvPanel({ cctvs, send }: { cctvs: Cctv[]; send: (m: ClientMessage) => void }) {
  const incident = useConsole((s) => (s.selectedKey ? s.incidents[s.selectedKey] : undefined));
  const cctvId = useConsole((s) => s.cctvId);
  const override = useConsole((s) => s.cctvUrlOverride);
  const setCctv = useConsole((s) => s.setCctv);

  const candidates = useMemo(() => {
    if (incident) return nearestCctvs([incident.lon, incident.lat], cctvs, 3);
    const def = cctvs.find((c) => c.name === DEFAULT_NAME) ?? cctvs[0];
    return def ? [def] : [];
  }, [incident, cctvs]);
  const active = candidates.find((c) => c.id === cctvId) ?? candidates[0];

  const url = active ? (active.id in override ? override[active.id] : active.url) : null;
  const activeId = active?.id;

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 영상 effect 가 send 바뀜으로 다시 돌지 않게 ref 로 들고 있다. 렌더 뒤에 갱신한다.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const asked = useRef(new Set<string>());
  const pending = useRef<{ key: string; ov: unknown } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = !!activeId && failedKey === `${activeId}|${url}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeId || !url) return;
    const key = `${activeId}|${url}`;
    let cancelled = false;
    let hls: { destroy(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onFatal = () => {
      if (cancelled) return;
      if (!asked.current.has(activeId)) {
        asked.current.add(activeId);
        sendRef.current({ type: 'cctv.request', cctvId: activeId, refresh: true });
        // No usable answer (same url, silence, socket down) must not leave a blank player.
        pending.current = { key, ov: useConsole.getState().cctvUrlOverride };
        timer = setTimeout(() => setFailedKey(key), REFRESH_WAIT_MS);
      } else {
        setFailedKey(key);
      }
    };
    const onPlaying = () => asked.current.delete(activeId);
    video.addEventListener('playing', onPlaying);

    (async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (Hls.isSupported()) {
        const h = new Hls({ lowLatencyMode: true });
        hls = h;
        h.on(Hls.Events.ERROR, (_ev: unknown, data: { fatal?: boolean }) => {
          if (data?.fatal) onFatal();
        });
        h.loadSource(url);
        h.attachMedia(video);
      } else if (video.canPlayType(HLS_TYPE)) {
        video.src = url;
        video.addEventListener('error', onFatal);
      } else {
        onFatal();
        return;
      }
      video.play().catch(() => {});
    })().catch(onFatal);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      pending.current = null;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onFatal);
      hls?.destroy();
      video.removeAttribute('src');
    };
  }, [activeId, url]);

  // An answer carrying the url that just failed counts as failure right away.
  useEffect(() => {
    const p = pending.current;
    if (p && override !== p.ov && activeId && override[activeId] === url) setFailedKey(p.key);
  }, [override, activeId, url]);

  // Fullscreen: native API when allowed, otherwise a fixed overlay.
  const [native, setNative] = useState(false);
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const sync = () => setNative(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay]);

  const toggle = useCallback(() => {
    if (document.fullscreenEnabled && rootRef.current) {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void rootRef.current.requestFullscreen?.()?.catch?.(() => setOverlay(true));
    } else {
      setOverlay((v) => !v);
    }
  }, []);
  const big = native || overlay;

  return (
    <div ref={rootRef} className={`cctv-panel${overlay ? ' is-overlay' : ''}`}>
      <div className={`cam${!url || failed ? ' failed' : ''}`}>
        <video ref={videoRef} muted playsInline autoPlay />
        <span className="live">실시간</span>
        <button type="button" className="cam-full" onClick={toggle}>
          {big ? '작게 보기' : '크게 보기'}
        </button>
        {(!url || failed) && <div className="err">{GUIDE}</div>}
      </div>
      <div className="camname">{active?.name ?? ''}</div>
      {candidates.length > 1 && (
        <div className="chips">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              aria-pressed={c.id === active?.id}
              onClick={() => setCctv(c.id)}
            >
              {chipLabel(c.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
