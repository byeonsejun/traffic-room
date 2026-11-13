import { useEffect, useState } from 'react';
import { createMetricsClient, sseUrlFrom } from '@/lib/metrics-client';
import { useMetrics } from '@/store/metrics';

// 지표 스트림은 실시간 서버의 /sse/metrics. 주소가 없으면 지표 없이 처음 받은 것만 보여 준다.
const SSE_URL = sseUrlFrom(process.env.NEXT_PUBLIC_REALTIME_URL);

/** off: 스트림 주소가 없음 · connecting: 여는 중이거나 다시 잇는 중 · open: 받는 중 */
export type MetricsStreamStatus = 'off' | 'connecting' | 'open';

/**
 * SSE 지표를 받아 useMetrics 에 넣는다. 화면마다 한 번만 부른다(연결 하나).
 * 끊겨도 마지막 지표를 지우지 않는다.
 */
export function useMetricsStream(): MetricsStreamStatus {
  const [status, setStatus] = useState<MetricsStreamStatus>(SSE_URL ? 'connecting' : 'off');
  useEffect(() => {
    if (!SSE_URL) return;
    const stream = createMetricsClient({
      url: SSE_URL,
      onMetrics: useMetrics.getState().apply,
      onStatus: (s) => setStatus(s === 'open' ? 'open' : 'connecting'),
    });
    return () => stream.close();
  }, []);
  return status;
}
