'use client';

import { useSyncExternalStore } from 'react';
import { hhmm, hhmmss, mdhhmm } from '@/lib/time';
import type { ConnStatus } from '@/lib/realtime-client';
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

type Props = { status: ConnStatus; retryInMs?: number; live: boolean; beat?: number; collectedAt?: string | null };

export function TopBar({ status, retryInMs, live, beat, collectedAt }: Props) {
  return (
    <header className="top">
      <h1>전국 도로 상황실</h1>
      <ConnectionBadge status={status} retryInMs={retryInMs} live={live} beat={beat} />
      <span className="delay">약 1시간 지연</span>
      {collectedAt && <LastCollected collectedAt={collectedAt} />}
      <Clock />
    </header>
  );
}
