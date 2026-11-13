'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cctv, ClientMessage } from '@traffic-room/shared';
import { useConsole } from '@/store/console';
import { useActiveCctv } from './useActiveCctv';

const GUIDE = '이 CCTV 영상을 지금 불러올 수 없어요. 다른 CCTV를 골라 보세요.';
const REFRESH_WAIT_MS = 10_000;
// 미디어 오류 복구 뒤 이만큼 지나 또 나면 새 오류로 보고 처음부터 복구한다(hls.js 권장).
const RECOVER_WINDOW_MS = 3_000;
const HLS_TYPE = 'application/vnd.apple.mpegurl';

const chipLabel = (name: string) => name.replace(/\[.*?\]\s*/, '');

export function CctvPanel({ cctvs, send }: { cctvs: Cctv[]; send: (m: ClientMessage) => void }) {
  const override = useConsole((s) => s.cctvUrlOverride);
  const setCctv = useConsole((s) => s.setCctv);
  const setUnavailable = useConsole((s) => s.setCctvUnavailable);
  const { candidates, active } = useActiveCctv(cctvs);

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
  // 안내문을 띄운 CCTV 를 지도에도 알린다. 지도 핀은 이 CCTV 를 "실시간"이라 하지 않는다.
  const unavailable = activeId && (!url || failed) ? activeId : null;
  useEffect(() => {
    setUnavailable(unavailable);
  }, [unavailable, setUnavailable]);
  useEffect(() => () => setUnavailable(null), [setUnavailable]);

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
    // 복구 뒤 영상이 다시 흐르지 않고 멈춰 있으면(오류도 안 나면) 실패로 본다. 멈춘 화면 위에 "실시간"을 두지 않게.
    let recoverTimer: ReturnType<typeof setTimeout> | undefined;
    const onPlaying = () => {
      asked.current.delete(activeId);
      clearTimeout(recoverTimer);
    };
    video.addEventListener('playing', onPlaying);

    (async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (Hls.isSupported()) {
        const h = new Hls({ lowLatencyMode: true });
        hls = h;
        // 미디어 오류(디코딩 등)는 주소를 새로 받기 전에 그 자리에서 되살려 본다(hls.js 권장 순서):
        // 먼저 recoverMediaError, 곧바로 또 나면 오디오 코덱을 바꿔 한 번 더, 그래도 나면 아래 onFatal 로.
        let lastRecover = -Infinity;
        let swapped = false;
        h.on(Hls.Events.ERROR, (_ev: unknown, data: { fatal?: boolean; type?: string }) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            const now = Date.now();
            const fresh = now - lastRecover > RECOVER_WINDOW_MS;
            if (fresh || !swapped) {
              if (fresh) swapped = false;
              else {
                h.swapAudioCodec();
                swapped = true;
              }
              lastRecover = now;
              h.recoverMediaError();
              clearTimeout(recoverTimer);
              recoverTimer = setTimeout(onFatal, REFRESH_WAIT_MS);
              return;
            }
          }
          clearTimeout(recoverTimer);
          onFatal();
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
      clearTimeout(recoverTimer);
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
  // 고른 CCTV 가 없으면(목록이 비었을 때) 끊겼다고 하지 않는다.
  const down = !!activeId && (!url || failed);

  return (
    <div ref={rootRef} className={`cctv-panel${overlay ? ' is-overlay' : ''}`}>
      <div className={`cam${down ? ' failed' : ''}`}>
        <video ref={videoRef} muted playsInline autoPlay />
        {/* 영상이 안 나오는데 "실시간"이라 하지 않는다. 지도 핀과 같은 회색 "연결 안 됨". */}
        <span className={`live${down ? ' is-down' : ''}`}>{down ? '연결 안 됨' : '실시간'}</span>
        <button type="button" className="cam-full" onClick={toggle}>
          {big ? '작게 보기' : '크게 보기'}
        </button>
        {/* 안내 영역은 늘 두고 글만 바꿔야 화면 낭독기가 읽어 준다. 비어 있으면 CSS 로 숨긴다. */}
        <div className="err" role="status">{down ? GUIDE : ''}</div>
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
