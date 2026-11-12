import { parseServerMessage, type ClientMessage, type ServerMessage } from '@traffic-room/shared';

export type ConnStatus = 'connecting' | 'waking' | 'open' | 'retrying';

export interface RealtimeClientOptions {
  url: string;
  getLastId: () => number;
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: ConnStatus, retryInMs?: number) => void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
}

const WAKING_AFTER_MS = 5_000;
const PING_EVERY_MS = 25_000;
const PONG_WITHIN_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const WS_OPEN = 1;

export function createRealtimeClient(opts: RealtimeClientOptions) {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const random = opts.random ?? Math.random;

  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let wakingTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(wakingTimer);
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    wakingTimer = retryTimer = pingTimer = pongTimer = undefined;
  }

  function send(m: ClientMessage) {
    if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(m));
  }

  function scheduleRetry() {
    clearTimers();
    if (closed) return;
    // 절반~전체 사이에서 흔들어 여러 탭이 동시에 몰리지 않게 한다.
    const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
    const delay = Math.round(cap * (0.5 + 0.5 * random()));
    attempt += 1;
    opts.onStatus('retrying', delay);
    retryTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (closed) return;
    clearTimers();
    opts.onStatus('connecting');
    const socket = new WS(opts.url);
    ws = socket;
    wakingTimer = setTimeout(() => {
      if (ws === socket && !closed) opts.onStatus('waking');
    }, WAKING_AFTER_MS);

    socket.onopen = () => {
      if (ws !== socket) return;
      clearTimeout(wakingTimer);
      attempt = 0;
      opts.onStatus('open');
      send({ type: 'resume', lastId: opts.getLastId() });
      pingTimer = setInterval(() => {
        send({ type: 'ping' });
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          if (ws === socket) socket.close();
        }, PONG_WITHIN_MS);
      }, PING_EVERY_MS);
    };
    socket.onmessage = (e: MessageEvent) => {
      if (ws !== socket) return;
      const m = parseServerMessage(String(e.data));
      if (!m) return;
      if (m.type === 'pong') {
        clearTimeout(pongTimer);
        pongTimer = undefined;
      }
      opts.onMessage(m);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      scheduleRetry();
    };
    socket.onerror = () => {
      // close 이벤트가 이어서 오므로 재연결은 거기서 처리한다.
    };
  }

  connect();

  return {
    send,
    close() {
      closed = true;
      clearTimers();
      const s = ws;
      ws = null;
      s?.close();
    },
  };
}
