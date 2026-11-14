import { useEffect, useRef, useState } from 'react';
import type { TrafficResponse } from '@/lib/api';
import { load } from '@/lib/load';

export type Traffic = { speeds: Map<string, number> | null; dataAt: string | null; error: boolean };
const NO_TRAFFIC: Traffic = { speeds: null, dataAt: null, error: false };
/** 새 스냅샷을 받으러 갔는데 실패했거나 아직 예전 것이 오면 이만큼 쉬었다가 다시 간다. */
const TRAFFIC_RETRY_MS = 30_000;
/** 스냅샷 id 하나당 받으러 가는 최대 횟수. 그 뒤에는 다음 지표를 기다린다. */
const TRAFFIC_TRIES = 3;

/**
 * 지도에 깔 교통 속도. 처음 한 번 받고, 그 뒤에는 지표가 가리키는 스냅샷 id 가 지금 보이는 것보다 새것일 때만 다시 받는다.
 * 한 번이라도 받았으면 다시 받기가 실패해도 마지막 속도를 그대로 둔다. 오류 표시는 한 번도 못 받았을 때만이다.
 */
export function useTraffic(wantedId: number | null, refreshTick = 0): Traffic {
  const [traffic, setTraffic] = useState<Traffic>(NO_TRAFFIC);
  const wanted = useRef(wantedId);
  const recheck = useRef(() => {});
  const refetch = useRef(() => {});

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
        } else if (t.id > (shownId ?? -Infinity)) {
          // 스냅샷 id 는 늘기만 한다. 늦은 캐시가 돌려준 더 옛 스냅샷으로 되돌아가지 않는다.
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
      if (shownId != null && want <= shownId) return;
      if (attempt.id !== want) attempt = { id: want, n: 0 };
      if (attempt.n >= TRAFFIC_TRIES) return;
      const first = attempt.n === 0;
      attempt.n += 1;
      pending = true;
      if (first) void fetchTraffic(want);
      else timer = setTimeout(() => void fetchTraffic(want), TRAFFIC_RETRY_MS);
    };
    recheck.current = check;
    // SSE 가 조용할 때의 대비 박자. id 없이 받아도 늘기만 하는 규칙이 옛 스냅샷을 걸러 낸다.
    refetch.current = () => {
      if (!pending) void fetchTraffic();
    };

    void fetchTraffic();
    return () => {
      live = false;
      ac.abort();
      clearTimeout(timer);
      recheck.current = () => {};
      refetch.current = () => {};
    };
  }, []);

  const firstTick = useRef(refreshTick);
  useEffect(() => {
    if (refreshTick !== firstTick.current) refetch.current();
  }, [refreshTick]);

  useEffect(() => {
    wanted.current = wantedId;
    recheck.current();
  }, [wantedId]);

  return traffic;
}
