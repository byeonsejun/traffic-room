import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useMetrics } from '@/store/metrics';

/** 지표가 이만큼(수집 간격에 더해) 조용하면 SSE 가 끊긴 것으로 보고 직접 다시 받는다. */
const SILENCE_GRACE_MS = 5 * 60_000;
/** 수집 간격을 아직 모를 때(첫 응답 전). */
const DEFAULT_INTERVAL_MINUTES = 60;

/** 24시간 요약 응답이 알려 준 수집 간격. SSE 지표가 오기 전의 대비 박자가 쓴다. */
export const useKnownInterval = create<{ minutes: number | null }>()(() => ({ minutes: null }));

/**
 * SSE 지표가 없거나 조용할 때를 위한 대비용 박자. 지표가 간격 + 5분 넘게 안 오면(주소가 없으면 처음부터)
 * 수집 간격마다 값이 하나씩 늘어난다. 이 값이 바뀔 때 교통 · 24시간 요약을 다시 받으면 된다.
 * 지표가 다시 오면 멈추고 기다림부터 다시 센다.
 */
export function useFallbackTick(live: boolean): number {
  const knownIntervalMinutes = useKnownInterval((s) => s.minutes);
  const metrics = useMetrics((s) => s.metrics);
  const [tick, setTick] = useState(0);
  const quietSince = useRef<number | null>(null);
  const intervalMinutes = metrics?.intervalMinutes ?? knownIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;

  useEffect(() => {
    quietSince.current = Date.now();
  }, [metrics]);

  useEffect(() => {
    const ms = intervalMinutes * 60_000;
    let iv: ReturnType<typeof setInterval> | undefined;
    const bump = () => setTick((n) => n + 1);
    const since = quietSince.current ?? Date.now();
    const wait = live ? Math.max(0, since + ms + SILENCE_GRACE_MS - Date.now()) : ms;
    const t = setTimeout(() => {
      bump();
      iv = setInterval(bump, ms);
    }, wait);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [metrics, live, intervalMinutes]);

  return tick;
}
