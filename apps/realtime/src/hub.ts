import type { LogEvent, ServerMessage } from '@traffic-room/shared';

/** 송출 로그 한 건을 봉투로 바꾼다. 봉투 id 는 로그 id 와 같아서 재접속 resume 의 기준이 된다. */
export function toIncidentMessage(e: LogEvent): ServerMessage {
  return e.kind === 'arrived'
    ? { id: e.id, type: 'incident.arrived', ts: e.emitAt, payload: { incident: e.incident } }
    : { id: e.id, type: 'incident.cleared', ts: e.emitAt, payload: { key: e.incident.key } };
}

/**
 * 허브는 소켓에 직접 쓰지 않고 연결이 넘겨 준 push 를 부른다.
 * 연결은 push 를 자기 처리 줄(hello · resume 응답) 뒤에 세워서, 진행 중인 resume 보다
 * 브로드캐스트가 먼저 도착해 클라이언트가 그 사이 id 를 버리는 일이 없게 한다.
 */
export interface HubClient {
  push(m: ServerMessage): void;
}

export interface Hub {
  /** 등록하고, 연결이 끝날 때 부를 해제 함수를 돌려준다. */
  add(client: HubClient): () => void;
  broadcast(e: LogEvent): void;
  size(): number;
}

/** 연결된 브라우저 전체에 같은 이벤트를 보낸다. */
export function createHub(): Hub {
  const clients = new Set<HubClient>();
  return {
    add(client) {
      clients.add(client);
      return () => clients.delete(client);
    },
    broadcast(e) {
      const m = toIncidentMessage(e);
      for (const c of clients) c.push(m);
    },
    size: () => clients.size,
  };
}
