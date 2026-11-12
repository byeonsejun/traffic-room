import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { getCctv, getEventsAfter, latestEmittedId, type Db } from '@traffic-room/db';
import type { ItsClient } from '@traffic-room/its';
import { DELAY_MINUTES, parseClientMessage, type ClientMessage, type ServerMessage } from '@traffic-room/shared';
import { createHub, toIncidentMessage, type Hub } from './hub.ts';
import { createDailyQuota, refreshCctv, type CctvUrlResult, type DailyQuota } from './cctv-refresh.ts';

export interface ServerDeps {
  db: Db;
  its: ItsClient;
  now: () => Date;
  allowedOrigins: string[];
  /** 스케줄러가 broadcast 할 허브. 없으면 내부에서 만든다. */
  hub?: Hub;
  quota?: DailyQuota;
  /** 이 시간 동안 아무 메시지도 없으면 끊는다(클라이언트 ping 은 25초 주기). */
  idleMs?: number;
  logger?: boolean;
}

const RESUME_LIMIT = 200;
const DAILY_REFRESH_LIMIT = 10;
const IDLE_CLOSE_CODE = 4000;
const POLICY_VIOLATION = 1008;

/** 에러 문구에는 접속 정보가 섞일 수 있어 code 나 이름만 남긴다. */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'unknown';
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { db, its, now } = deps;
  const hub = deps.hub ?? createHub();
  const quota = deps.quota ?? createDailyQuota(DAILY_REFRESH_LIMIT);
  const idleMs = deps.idleMs ?? 60_000;
  const allowed = new Set(deps.allowedOrigins);

  const app = Fastify({ logger: deps.logger ? { level: 'info' } : false });
  await app.register(fastifyWebsocket);

  app.get('/health', async () => ({ ok: true }));

  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) {
      socket.close(POLICY_VIOLATION, 'origin not allowed');
      return;
    }

    const send = (m: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };

    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => socket.close(IDLE_CLOSE_CODE, 'idle'), idleMs);
    };
    touch();

    // hello 가 늘 첫 메시지가 되도록, 그리고 resume 응답이 섞이지 않도록 한 줄로 처리한다.
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (job: () => Promise<void>) => {
      chain = chain.then(job).catch((e) => req.log.warn(`ws 처리 실패 code=${errorCode(e)}`));
    };

    socket.on('message', (data) => {
      touch();
      const msg = parseClientMessage(String(data));
      if (!msg) return; // 잘못된 메시지는 무시하고 연결은 유지한다
      enqueue(() => handle(msg, send));
    });
    socket.on('close', () => clearTimeout(idle));

    hub.add(socket);
    enqueue(async () => {
      send({
        id: 0, type: 'hello', ts: now().toISOString(),
        payload: { delayMinutes: DELAY_MINUTES, latestId: await latestEmittedId(db, now()) },
      });
    });
  });

  async function cctvUrl(cctvId: string, refresh: boolean): Promise<CctvUrlResult> {
    if (refresh) return refreshCctv({ db, its, now, quota }, cctvId);
    const c = await getCctv(db, cctvId);
    return c ? { url: c.url, reason: 'cached' } : { url: null, reason: 'unavailable' };
  }

  async function handle(msg: ClientMessage, send: (m: ServerMessage) => void): Promise<void> {
    switch (msg.type) {
      case 'ping':
        send({ id: 0, type: 'pong', ts: now().toISOString(), payload: {} });
        return;
      case 'resume': {
        const missed = await getEventsAfter(db, msg.lastId, now(), RESUME_LIMIT);
        for (const e of missed) send(toIncidentMessage(e));
        return;
      }
      case 'cctv.request': {
        const r = await cctvUrl(msg.cctvId, msg.refresh);
        send({ id: 0, type: 'cctv.url', ts: now().toISOString(), payload: { cctvId: msg.cctvId, ...r } });
        return;
      }
    }
  }

  return app;
}
