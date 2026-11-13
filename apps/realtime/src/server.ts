import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { getCctv, getEventsAfter, latestEmittedId, type Db } from '@traffic-room/db';
import type { ItsClient } from '@traffic-room/its';
import { parseClientMessage, type ClientMessage, type ServerMessage, type Timing } from '@traffic-room/shared';
import { createHub, toIncidentMessage, type Hub } from './hub.ts';
import { createDailyQuota, refreshCctv, type CctvUrlResult, type DailyQuota } from './cctv-refresh.ts';

export interface ServerDeps {
  db: Db;
  its: ItsClient;
  now: () => Date;
  timing: Timing;
  allowedOrigins: string[];
  /** 스케줄러가 broadcast 할 허브. 없으면 내부에서 만든다. */
  hub?: Hub;
  quota?: DailyQuota;
  /** false 면 refresh 요청에도 ITS 를 부르지 않고 저장된 주소만 돌려준다. 기본은 true. */
  cctvRefresh?: boolean;
  /**
   * 이 시간 동안 아무 메시지도 없으면 끊는다. 클라이언트 ping 은 25초 주기지만 백그라운드 탭에서는
   * 브라우저가 타이머를 1분 단위로 늦출 수 있어 넉넉히 둔다.
   */
  idleMs?: number;
  logger?: boolean;
}

const RESUME_LIMIT = 200;
const DAILY_REFRESH_LIMIT = 10;
const IDLE_CLOSE_CODE = 4000;
const POLICY_VIOLATION = 1008;

/** `?lastId=<n>` 을 읽는다. 0 이상의 정수가 아니면 없는 것으로 본다. */
function parseLastId(query: unknown): number | null {
  const raw = (query as { lastId?: unknown } | null)?.lastId;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** 에러 문구에는 접속 정보가 섞일 수 있어 code 나 이름만 남긴다. */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'unknown';
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { db, its, now } = deps;
  const hub = deps.hub ?? createHub();
  const cctvRefresh = deps.cctvRefresh ?? true;
  const quota = deps.quota ?? createDailyQuota(DAILY_REFRESH_LIMIT);
  const idleMs = deps.idleMs ?? 120_000;
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

    // hello · resume 응답 · 브로드캐스트를 모두 한 줄로 보낸다. hello 가 늘 첫 메시지이고,
    // resume 이 DB 를 기다리는 동안 온 브로드캐스트는 그 응답 뒤에 나간다(겹치면 중복일 뿐 빈틈은 없다).
    // 주소에 lastId 가 있으면 첫 작업 안에서 hello 바로 뒤에 resume 한다. 클라이언트가 onopen 에서
    // resume 을 보내던 때는 그 왕복 사이의 브로드캐스트가 lastId 를 앞질러 resume 응답이 버려졌다.
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
    const resumeFrom = parseLastId(req.query);
    enqueue(async () => {
      send({
        id: 0, type: 'hello', ts: now().toISOString(),
        payload: { delayMinutes: deps.timing.delayMinutes, latestId: await latestEmittedId(db, now()) },
      });
      if (resumeFrom !== null) await resume(resumeFrom, send);
    });
    // 허브에는 바로 등록하되 push 는 위 작업 뒤에 줄을 선다. 등록을 resume 조회 뒤로 미루면
    // 조회와 등록 사이에 나간 이벤트를 영영 놓친다.
    const leave = hub.add({ push: (m) => enqueue(async () => send(m)) });
    socket.on('close', () => {
      clearTimeout(idle);
      leave();
    });
  });

  async function cctvUrl(cctvId: string, refresh: boolean): Promise<CctvUrlResult> {
    if (refresh && cctvRefresh) return refreshCctv({ db, its, now, quota, timing: deps.timing }, cctvId);
    const c = await getCctv(db, cctvId);
    return c ? { url: c.url, reason: 'cached' } : { url: null, reason: 'unavailable' };
  }

  async function resume(lastId: number, send: (m: ServerMessage) => void): Promise<void> {
    const missed = await getEventsAfter(db, lastId, now(), RESUME_LIMIT);
    for (const e of missed) send(toIncidentMessage(e));
  }

  async function handle(msg: ClientMessage, send: (m: ServerMessage) => void): Promise<void> {
    switch (msg.type) {
      case 'ping':
        send({ id: 0, type: 'pong', ts: now().toISOString(), payload: {} });
        return;
      case 'resume':
        // 예전 클라이언트 호환용. 지금 클라이언트는 접속 주소의 lastId 로 resume 한다.
        await resume(msg.lastId, send);
        return;
      case 'cctv.request': {
        const r = await cctvUrl(msg.cctvId, msg.refresh);
        send({ id: 0, type: 'cctv.url', ts: now().toISOString(), payload: { cctvId: msg.cctvId, ...r } });
        return;
      }
    }
  }

  return app;
}
