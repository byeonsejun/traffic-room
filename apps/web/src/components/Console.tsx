'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cctv, ClientMessage } from '@traffic-room/shared';
import { createRealtimeClient } from '@/lib/realtime-client';
import { useConsole, type Snapshot } from '@/store/console';
import { CctvPanel } from './CctvPanel';
import { Feed } from './Feed';
import { MapView } from './MapView';
import { StatsPanel } from './StatsPanel';
import { TopBar } from './TopBar';

// 비어 있으면 실시간 서버 없이 스냅샷만 보여 주고, 배지는 "수집본으로 보는 중"에 머문다.
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
const FALLBACK = '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';

async function load<T>(path: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  const body = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok || body === null) throw new Error(body?.message ?? FALLBACK);
  return body;
}

export function Console() {
  const status = useConsole((s) => s.status);
  const retryInMs = useConsole((s) => s.retryInMs);
  const top = useConsole((s) => s.feed[0]);

  const [cctvs, setCctvs] = useState<Cctv[]>([]);
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const client = useRef<ReturnType<typeof createRealtimeClient> | null>(null);
  const send = useCallback((m: ClientMessage) => client.current?.send(m), []);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    const fail = (e: unknown) => {
      if (!live) return;
      const msg = e instanceof Error && e.name !== 'AbortError' ? e.message || FALLBACK : null;
      if (msg) setNotices((n) => (n.includes(msg) ? n : [...n, msg]));
    };

    load<Cctv[]>('/api/cctvs', ac.signal).then((c) => live && setCctvs(c), fail);

    // 스냅샷을 먼저 깔고 나서 연결해야 resume 이 스냅샷 이후의 송출분만 받아 온다.
    load<Snapshot>('/api/snapshot', ac.signal)
      .then((s) => {
        if (!live) return;
        useConsole.getState().applySnapshot(s);
        setCollectedAt(s.collectedAt);
      }, fail)
      .finally(() => {
        if (!live || !REALTIME_URL) return;
        const { applyServerMessage, setStatus } = useConsole.getState();
        client.current = createRealtimeClient({
          url: REALTIME_URL,
          getLastId: () => useConsole.getState().lastId,
          onMessage: (m) => applyServerMessage(m, new Date()),
          onStatus: setStatus,
        });
      });

    return () => {
      live = false;
      ac.abort();
      client.current?.close();
      client.current = null;
    };
  }, []);

  const arrivalId = top && top.kind === 'arrived' && top.fresh ? top.id : undefined;

  return (
    <div className="console">
      <TopBar status={status} retryInMs={retryInMs} live={!!REALTIME_URL} beat={arrivalId} />
      <aside className="left" aria-label="돌발상황 지표">
        <StatsPanel arrivalId={arrivalId} collectedAt={collectedAt} />
      </aside>
      <main className="map">
        <MapView />
        {notices.length > 0 && (
          <div className="notices" role="alert">
            {notices.map((n) => <p key={n}>{n}</p>)}
          </div>
        )}
      </main>
      <aside className="right" aria-label="CCTV와 실시간 상황">
        <CctvPanel cctvs={cctvs} send={send} />
        <Feed />
      </aside>
    </div>
  );
}
