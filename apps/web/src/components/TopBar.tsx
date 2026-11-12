'use client';

import { useEffect, useState } from 'react';
import { hhmmss } from '@/lib/time';
import type { ConnStatus } from '@/lib/realtime-client';
import { ConnectionBadge } from './ConnectionBadge';

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
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
