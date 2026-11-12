'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cctv, ClientMessage } from '@traffic-room/shared';
import { createRealtimeClient } from '@/lib/realtime-client';
import { needsResync, useConsole, type Snapshot } from '@/store/console';
import { CctvPanel } from './CctvPanel';
import { Feed } from './Feed';
import { MapView } from './MapView';
import { StatsPanel } from './StatsPanel';
import { TopBar } from './TopBar';

// 비어 있으면 실시간 서버 없이 스냅샷만 보여 주고, 배지는 "수집본으로 보는 중"에 머문다.
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
const FALLBACK = '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';
const SNAPSHOT_RETRY_BASE_MS = 5_000;
const SNAPSHOT_RETRY_MAX_MS = 60_000;
/** 스냅샷 캐시가 조금 낡아 다시 어긋나도 재동기화를 거듭하지 않게 한 번 하고 나면 이만큼 쉰다. */
const RESYNC_COOLDOWN_MS = 60_000;

async function load<T>(path: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  const body = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok || body === null) throw new Error(body?.message ?? FALLBACK);
  return body;
}

type NoticeSource = 'cctvs' | 'snapshot';

export function Console() {
  const status = useConsole((s) => s.status);
  const retryInMs = useConsole((s) => s.retryInMs);
  const top = useConsole((s) => s.feed[0]);

  const [cctvs, setCctvs] = useState<Cctv[]>([]);
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  const [notices, setNotices] = useState<Partial<Record<NoticeSource, string>>>({});
  const client = useRef<ReturnType<typeof createRealtimeClient> | null>(null);
  const send = useCallback((m: ClientMessage) => client.current?.send(m), []);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastResyncAt = -Infinity;

    const note = (source: NoticeSource, e: unknown) => {
      if (!live) return;
      const msg = e instanceof Error && e.name !== 'AbortError' ? e.message || FALLBACK : null;
      if (msg) setNotices((n) => (n[source] === msg ? n : { ...n, [source]: msg }));
    };
    const clearNote = (source: NoticeSource) =>
      setNotices((n) => {
        if (!(source in n)) return n;
        const { [source]: _gone, ...rest } = n;
        return rest;
      });

    load<Cctv[]>('/api/cctvs', ac.signal).then((c) => live && setCctvs(c), (e) => note('cctvs', e));

    const connect = () => {
      if (!live || !REALTIME_URL) return;
      const { applyServerMessage, setStatus } = useConsole.getState();
      client.current = createRealtimeClient({
        url: REALTIME_URL,
        getLastId: () => useConsole.getState().lastId,
        onMessage: (m) => {
          if (m.type === 'hello') {
            const now = Date.now();
            if (needsResync(useConsole.getState().lastId, m.payload.latestId) && now - lastResyncAt >= RESYNC_COOLDOWN_MS) {
              // resume 으로는 메울 수 없다. 이 연결을 닫아 뒤따르는 resume 분을 버리고 스냅샷부터 다시 깐다.
              lastResyncAt = now;
              client.current?.close();
              client.current = null;
              setStatus('connecting');
              void loadSnapshot(true, 0);
              return;
            }
          }
          applyServerMessage(m, new Date());
        },
        onStatus: setStatus,
      });
    };

    // 스냅샷을 먼저 깔고 나서 연결해야 resume 이 스냅샷 이후의 송출분만 받아 온다.
    // 스냅샷이 실패하면 lastId 0 에서 resume 하지 않고(처음 200건만 받아 와 화면이 어긋난다) 스냅샷부터 다시 받는다.
    const loadSnapshot = async (reset: boolean, attempt: number): Promise<void> => {
      try {
        const s = await load<Snapshot>('/api/snapshot', ac.signal);
        if (!live) return;
        useConsole.getState().applySnapshot(s, { reset });
        setCollectedAt(s.collectedAt);
        clearNote('snapshot');
        connect();
      } catch (e) {
        if (!live) return;
        note('snapshot', e);
        const delay = Math.min(SNAPSHOT_RETRY_MAX_MS, SNAPSHOT_RETRY_BASE_MS * 2 ** attempt);
        retryTimer = setTimeout(() => void loadSnapshot(reset, attempt + 1), delay);
      }
    };
    void loadSnapshot(false, 0);

    return () => {
      live = false;
      ac.abort();
      clearTimeout(retryTimer);
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
        {Object.keys(notices).length > 0 && (
          <div className="notices" role="alert">
            {[...new Set(Object.values(notices))].map((n) => <p key={n}>{n}</p>)}
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
