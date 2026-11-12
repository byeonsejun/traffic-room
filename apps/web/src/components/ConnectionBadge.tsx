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
  // 남은 시간은 타이머 콜백에서만 바꾼다. 새 ms 가 들어오면 첫 틱 전까지는 ms 그대로 보여 준다.
  const [tick, setTick] = useState<{ for: number; left: number } | null>(null);
  useEffect(() => {
    if (ms === undefined) return;
    const until = Date.now() + ms;
    const t = setInterval(() => setTick({ for: ms, left: Math.max(0, until - Date.now()) }), 250);
    return () => clearInterval(t);
  }, [ms]);
  return tick && tick.for === ms ? tick.left : ms;
}

export function ConnectionBadge({ status, retryInMs, live = true, beat }: Props) {
  const left = useCountdown(status === 'retrying' ? retryInMs : undefined);

  let tone: 'ok' | 'wait' | 'idle' = 'idle';
  let text = '연결하는 중';
  /** 매초 바뀌는 앞부분. live 영역 밖에 두어 상태가 바뀔 때만 읽어 주게 한다. */
  let lead: string | null = null;
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
    lead = `${Math.max(1, Math.ceil((left ?? 0) / 1000))}초 뒤 `;
    text = '다시 연결해요';
  }

  return (
    <div className={`conn is-${tone}`}>
      <span key={beat} className={`dot${beat ? ' is-beat' : ''}`} aria-hidden="true" />
      <span>
        {lead}
        <span role="status" aria-live="polite">{text}</span>
      </span>
    </div>
  );
}
