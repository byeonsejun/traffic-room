'use client';

import { useSyncExternalStore } from 'react';
import { hhmmss } from '@/lib/time';
import type { ConnStatus } from '@/lib/realtime-client';
import { ConnectionBadge } from './ConnectionBadge';

const subscribeSeconds = (onChange: () => void) => {
  const t = setInterval(onChange, 1000);
  return () => clearInterval(t);
};
const currentSecond = () => Math.floor(Date.now() / 1000);
// 서버 렌더와 첫 하이드레이션에서는 시각을 비워 두어 어긋남이 없게 한다.
const noSecond = () => null;

function Clock() {
  const sec = useSyncExternalStore(subscribeSeconds, currentSecond, noSecond);
  const now = sec === null ? null : new Date(sec * 1000);
  return (
    <time className="clock" dateTime={now?.toISOString()} aria-label="현재 시각">
      {now ? hhmmss(now) : ''}
    </time>
  );
}

type Props = { status: ConnStatus; retryInMs?: number; live: boolean; beat?: number };

export function TopBar({ status, retryInMs, live, beat }: Props) {
  return (
    <header className="top">
      <h1>전국 도로 상황실</h1>
      <ConnectionBadge status={status} retryInMs={retryInMs} live={live} beat={beat} />
      <span className="delay">약 1시간 지연</span>
      <Clock />
    </header>
  );
}
