import type { WebSocket } from '@fastify/websocket';
import type { LogEvent, ServerMessage } from '@traffic-room/shared';

/** 송출 로그 한 건을 봉투로 바꾼다. 봉투 id 는 로그 id 와 같아서 재접속 resume 의 기준이 된다. */
export function toIncidentMessage(e: LogEvent): ServerMessage {
  return e.kind === 'arrived'
    ? { id: e.id, type: 'incident.arrived', ts: e.emitAt, payload: { incident: e.incident } }
    : { id: e.id, type: 'incident.cleared', ts: e.emitAt, payload: { key: e.incident.key } };
}

export interface Hub {
  add(socket: WebSocket): void;
  broadcast(e: LogEvent): void;
  size(): number;
}

/** 연결된 브라우저 전체에 같은 이벤트를 보낸다. 닫힌 소켓은 스스로 빠진다. */
export function createHub(): Hub {
  const sockets = new Set<WebSocket>();
  return {
    add(socket) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    },
    broadcast(e) {
      const data = JSON.stringify(toIncidentMessage(e));
      for (const s of sockets) {
        if (s.readyState === s.OPEN) s.send(data);
      }
    },
    size: () => sockets.size,
  };
}
