'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { delayLabel, readTiming } from '@traffic-room/shared';
import { hhmm, hhmmss, mdhhmm } from '@/lib/time';
import type { ConnStatus } from '@/lib/realtime-client';
import { isTrafficStale } from '@/store/metrics';
import { ConnectionBadge } from './ConnectionBadge';

const subscribeSeconds = (onChange: () => void) => {
  const t = setInterval(onChange, 1000);
  return () => clearInterval(t);
};
const currentSecond = () => Math.floor(Date.now() / 1000);
// 서버 렌더와 첫 하이드레이션에서는 시각을 비워 두어 어긋남이 없게 한다.
const noSecond = () => null;

const STALE_MS = 3 * 60 * 60 * 1000;

function Clock() {
  const sec = useSyncExternalStore(subscribeSeconds, currentSecond, noSecond);
  const now = sec === null ? null : new Date(sec * 1000);
  return (
    <time className="clock" dateTime={now?.toISOString()} aria-label="현재 시각">
      {now ? hhmmss(now) : ''}
    </time>
  );
}

/** 마지막 수집 시각. 3시간을 넘기면 수집이 멈춘 것으로 보고 날짜와 함께 눈에 띄게 알린다. */
function LastCollected({ collectedAt }: { collectedAt: string }) {
  const sec = useSyncExternalStore(subscribeSeconds, currentSecond, noSecond);
  const stale = sec !== null && sec * 1000 - new Date(collectedAt).getTime() > STALE_MS;
  return stale ? (
    <span className="collected stale">마지막 수집 {mdhhmm(collectedAt)} · 수집 일시 중지</span>
  ) : (
    <span className="collected">마지막 수집 {hhmm(collectedAt)}</span>
  );
}

type TrafficTiming = { delayMinutes: number; intervalMinutes: number };

/**
 * 지도에 깔린 속도가 몇 시 데이터인지. 지연 + 수집 간격 두 번을 넘기면 갱신이 멈춘 것으로 보고 노랗게 알린다.
 * 색만으로 알리지 않도록 글로도 덧붙인다.
 */
function TrafficAt({ dataAt, timing }: { dataAt: string; timing: TrafficTiming }) {
  const sec = useSyncExternalStore(subscribeSeconds, currentSecond, noSecond);
  const stale = sec !== null && isTrafficStale(dataAt, new Date(sec * 1000), timing);
  return stale ? (
    <span className="traffic-at stale">교통 {hhmm(dataAt)} 기준 · 갱신 늦음</span>
  ) : (
    <span className="traffic-at">교통 {hhmm(dataAt)} 기준</span>
  );
}

type Props = {
  status: ConnStatus;
  retryInMs?: number;
  live: boolean;
  beat?: number;
  collectedAt?: string | null;
  delayMinutes: number;
  trafficDataAt?: string | null;
  trafficTiming?: TrafficTiming;
  /** 지금 화면. 탭에서 강조한다. */
  page?: Page;
};

type Page = 'console' | 'insights';
const TABS: { page: Page; href: string; label: string }[] = [
  { page: 'console', href: '/', label: '관제' },
  { page: 'insights', href: '/insights', label: '분석' },
];

/** 관제 · 분석 탭. 지금 화면은 aria-current 로 알리고 같은 표시로 강조한다. */
function Tabs({ page }: { page: Page }) {
  return (
    <nav className="tabs" aria-label="화면">
      {TABS.map((t) => (
        <Link key={t.page} href={t.href} aria-current={t.page === page ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

// 지표가 아직 없으면 설정 기본값(지연 60 · 간격 60)으로 판단한다.
const DEFAULT_TIMING: TrafficTiming = readTiming({});

export function TopBar({
  status, retryInMs, live, beat, collectedAt, delayMinutes, trafficDataAt, trafficTiming = DEFAULT_TIMING, page = 'console',
}: Props) {
  return (
    <header className="top">
      <h1>전국 도로 상황실</h1>
      <Tabs page={page} />
      <ConnectionBadge status={status} retryInMs={retryInMs} live={live} beat={beat} />
      <span className="delay">{delayLabel(delayMinutes)}</span>
      {collectedAt && <LastCollected collectedAt={collectedAt} />}
      {trafficDataAt && <TrafficAt dataAt={trafficDataAt} timing={trafficTiming} />}
      <Clock />
    </header>
  );
}
