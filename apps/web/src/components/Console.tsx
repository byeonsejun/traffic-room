'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cctv, ClientMessage } from '@traffic-room/shared';
import { createMetricsClient, sseUrlFrom } from '@/lib/metrics-client';
import { createRealtimeClient } from '@/lib/realtime-client';
import { isLoudArrival, needsResync, useConsole, type Snapshot } from '@/store/console';
import { useMetrics } from '@/store/metrics';
import { CctvPanel } from './CctvPanel';
import { Feed } from './Feed';
import { MapView } from './MapView';
import { StatsPanel } from './StatsPanel';
import { TopBar } from './TopBar';

// 비어 있으면 실시간 서버 없이 스냅샷만 보여 주고, 배지는 "수집본으로 보는 중"에 머문다.
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
// 지표 스트림은 같은 실시간 서버의 /sse/metrics. 주소가 없으면 교통은 처음 받은 것만 보여 준다.
const SSE_URL = sseUrlFrom(REALTIME_URL);
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

type TrafficResponse =
  | { id: number; dataAt: string; nextShowAt: string | null; speeds: [string, number][] }
  | { id: null };
type Traffic = { speeds: Map<string, number> | null; dataAt: string | null; error: boolean };
const NO_TRAFFIC: Traffic = { speeds: null, dataAt: null, error: false };
/** 새 스냅샷을 받으러 갔는데 실패했거나 아직 예전 것이 오면 이만큼 쉬었다가 다시 간다. */
const TRAFFIC_RETRY_MS = 30_000;
/** 스냅샷 id 하나당 받으러 가는 최대 횟수. 그 뒤에는 다음 지표를 기다린다. */
const TRAFFIC_TRIES = 3;

/**
 * 지도에 깔 교통 속도. 처음 한 번 받고, 그 뒤에는 지표가 가리키는 스냅샷 id 가 지금 보이는 것과 다를 때만 다시 받는다.
 * 한 번이라도 받았으면 다시 받기가 실패해도 마지막 속도를 그대로 둔다. 오류 표시는 한 번도 못 받았을 때만이다.
 */
function useTraffic(wantedId: number | null): Traffic {
  const [traffic, setTraffic] = useState<Traffic>(NO_TRAFFIC);
  const wanted = useRef(wantedId);
  const recheck = useRef(() => {});

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 받으러 가는 중이거나 다시 가려고 기다리는 중. 그동안 오는 지표는 다 받은 뒤에 한 번만 따져 본다.
    let pending = true;
    // 지금 보이는 스냅샷 id. undefined 는 아직 아무것도 못 받음, null 은 보여 줄 스냅샷이 없음.
    let shownId: number | null | undefined;
    let loaded = false;
    let attempt = { id: null as number | null, n: 0 };

    const fetchTraffic = async (id?: number) => {
      pending = true;
      try {
        // 스냅샷 id 를 붙여 CDN 캐시(60초)가 예전 응답을 돌려주지 않게 한다.
        const t = await load<TrafficResponse>(id === undefined ? '/api/traffic' : `/api/traffic?id=${id}`, ac.signal);
        if (!live) return;
        if (t.id === null) {
          if (!loaded) setTraffic(NO_TRAFFIC);
          if (shownId === undefined) shownId = null;
        } else if (t.id !== shownId) {
          shownId = t.id;
          loaded = true;
          setTraffic({ speeds: new Map(t.speeds), dataAt: t.dataAt, error: false });
        }
      } catch (e) {
        if (!live || (e instanceof Error && e.name === 'AbortError')) return;
        if (!loaded) setTraffic({ ...NO_TRAFFIC, error: true });
      } finally {
        pending = false;
      }
      check();
    };

    const check = () => {
      if (!live || pending) return;
      const want = wanted.current;
      if (want === null || want === shownId) return;
      if (attempt.id !== want) attempt = { id: want, n: 0 };
      if (attempt.n >= TRAFFIC_TRIES) return;
      const first = attempt.n === 0;
      attempt.n += 1;
      pending = true;
      if (first) void fetchTraffic(want);
      else timer = setTimeout(() => void fetchTraffic(want), TRAFFIC_RETRY_MS);
    };
    recheck.current = check;

    void fetchTraffic();
    return () => {
      live = false;
      ac.abort();
      clearTimeout(timer);
      recheck.current = () => {};
    };
  }, []);

  useEffect(() => {
    wanted.current = wantedId;
    recheck.current();
  }, [wantedId]);

  return traffic;
}

export function Console() {
  const status = useConsole((s) => s.status);
  const retryInMs = useConsole((s) => s.retryInMs);
  const top = useConsole((s) => s.feed[0]);

  const [cctvs, setCctvs] = useState<Cctv[]>([]);
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  // 스냅샷이 오기 전에는 기본 지연(60분)으로 보여 준다.
  const [delayMinutes, setDelayMinutes] = useState(60);
  const metrics = useMetrics((s) => s.metrics);
  // 처음 받기가 실패하면 지도는 바탕선만 그리고 범례가 알린다.
  const traffic = useTraffic(metrics?.trafficSnapshotId ?? null);
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
        setDelayMinutes(s.delayMinutes);
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

  useEffect(() => {
    if (!SSE_URL) return;
    // 끊겨도 마지막 지표와 도로 색을 그대로 둔다. 연결 상태는 WebSocket 배지가 이미 보여 준다.
    const stream = createMetricsClient({ url: SSE_URL, onMetrics: useMetrics.getState().apply, onStatus: () => {} });
    return () => stream.close();
  }, []);

  const arrivalId = top && isLoudArrival(top) ? top.id : undefined;
  const trafficTiming = metrics ? { delayMinutes: metrics.delayMinutes, intervalMinutes: metrics.intervalMinutes } : undefined;

  return (
    <div className="console">
      <TopBar
        status={status} retryInMs={retryInMs} live={!!REALTIME_URL} beat={arrivalId} collectedAt={collectedAt}
        delayMinutes={metrics?.delayMinutes ?? delayMinutes}
        trafficDataAt={traffic.dataAt} trafficTiming={trafficTiming}
      />
      <aside className="left" aria-label="돌발상황 지표">
        <StatsPanel arrivalId={arrivalId} collectedAt={collectedAt} />
      </aside>
      <main className="map">
        <MapView speeds={traffic.speeds} trafficDataAt={traffic.dataAt} trafficError={traffic.error} />
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
