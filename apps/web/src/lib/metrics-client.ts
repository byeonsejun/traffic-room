import { metricsSchema, type Metrics } from '@traffic-room/shared';

export type MetricsStatus = 'open' | 'retry';

export interface MetricsClientOptions {
  url: string;
  onMetrics: (m: Metrics) => void;
  onStatus: (s: MetricsStatus) => void;
  EventSourceImpl?: typeof EventSource;
}

/** 서버가 잠에서 깨는 동안 502 처럼 연결이 아예 닫히면 브라우저가 다시 잇지 않는다. 그때만 직접 다시 연다. */
const REOPEN_MS = 5_000;
const ES_CLOSED = 2;

/** 실시간 WebSocket 주소(wss://host/ws)에서 지표 스트림 주소(https://host/sse/metrics)를 만든다. */
export function sseUrlFrom(realtimeUrl: string | undefined): string | null {
  if (!realtimeUrl) return null;
  try {
    const u = new URL(realtimeUrl);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    else if (u.protocol === 'ws:') u.protocol = 'http:';
    else return null;
    u.pathname = u.pathname.replace(/\/ws\/?$/, '') + '/sse/metrics';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * `/sse/metrics` 를 듣는다. 끊기면 브라우저 기본 재연결에 맡기고, 서버는 재접속 때 지금 상태 전체를 먼저 보낸다.
 * `metrics` 이벤트는 zod 로 검증하고 깨진 것은 버린다.
 */
export function createMetricsClient(opts: MetricsClientOptions): { close(): void } {
  const ES = opts.EventSourceImpl ?? EventSource;
  let es: EventSource | null = null;
  let closed = false;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    const source = new ES(opts.url);
    es = source;
    source.onopen = () => opts.onStatus('open');
    source.onerror = () => {
      opts.onStatus('retry');
      if (source.readyState !== ES_CLOSED || closed) return;
      clearTimeout(reopenTimer);
      reopenTimer = setTimeout(open, REOPEN_MS);
    };
    source.addEventListener('metrics', (e) => {
      let raw: unknown;
      try {
        raw = JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return;
      }
      const parsed = metricsSchema.safeParse(raw);
      if (parsed.success) opts.onMetrics(parsed.data);
    });
  };
  open();

  return {
    close() {
      closed = true;
      clearTimeout(reopenTimer);
      es?.close();
      es = null;
    },
  };
}
