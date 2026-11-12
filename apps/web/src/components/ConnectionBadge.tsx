'use client';

import { useEffect, useState } from 'react';
import type { ConnStatus } from '@/lib/realtime-client';

type Props = {
  status: ConnStatus;
  retryInMs?: number;
  /** false면 실시간 서버 주소가 없어 수집본만 보여 주는 상태다. */
  live?: boolean;
  /** 새 상황이 도착할 때마다 바뀌는 값. 바뀌면 점이 한 번 맥박친다. */
  beat?: number;
};

function useCountdown(ms: number | undefined) {
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    setLeft(ms);
    if (ms === undefined) return;
    const until = Date.now() + ms;
    const t = setInterval(() => setLeft(Math.max(0, until - Date.now())), 250);
    return () => clearInterval(t);
  }, [ms]);
  return left;
}

export function ConnectionBadge({ status, retryInMs, live = true, beat }: Props) {
  const left = useCountdown(status === 'retrying' ? retryInMs : undefined);

  let tone: 'ok' | 'wait' | 'idle' = 'idle';
  let text = '연결하는 중';
  if (!live) {
    text = '수집본으로 보는 중';
  } else if (status === 'open') {
    tone = 'ok';
    text = '실시간 연결됨';
  } else if (status === 'waking') {
    tone = 'wait';
    text = '서버를 깨우는 중이에요. 최대 1분 걸려요';
  } else if (status === 'retrying') {
    tone = 'wait';
    text = `${Math.max(1, Math.ceil((left ?? 0) / 1000))}초 뒤 다시 연결해요`;
  }

  return (
    <div className={`conn is-${tone}`}>
      <span key={beat} className={`dot${beat ? ' is-beat' : ''}`} aria-hidden="true" />
      <span role="status" aria-live="polite">{text}</span>
    </div>
  );
}
