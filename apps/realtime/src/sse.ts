import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Metrics } from '@traffic-room/shared';
import type { MetricsState } from './metrics.ts';

const PING_MS = 25_000;

/**
 * `GET /sse/metrics`: 지표 상태 스트림.
 *
 * 상태 스트림이라 Last-Event-ID 와 상관없이 접속하면 지금 상태 전체를 먼저 보내고, 이후 바뀔 때마다
 * 같은 형식으로 보낸다. 이벤트 id 는 이 프로세스에서 보낸 metrics 이벤트마다 1씩 오른다.
 * 브라우저의 교차 출처 EventSource 는 늘 Origin 을 보내므로, 없거나 허용 목록 밖이면 403 이다.
 */
export function registerSse(app: FastifyInstance, metrics: MetricsState, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);
  const open = new Set<ServerResponse>();
  let nextId = 1;

  // 열린 스트림이 남아 있으면 서버가 닫히지 않으므로 먼저 끝낸다.
  app.addHook('preClose', async () => {
    for (const res of open) res.end();
  });

  app.get('/sse/metrics', (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return reply.code(403).send({ error: 'origin not allowed' });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
      vary: 'Origin',
      connection: 'keep-alive',
      // 중간 프록시가 모아 보내지 않게 한다.
      'x-accel-buffering': 'no',
    });
    open.add(res);

    const send = (m: Metrics) => {
      res.write(`id: ${nextId++}\nevent: metrics\ndata: ${JSON.stringify(m)}\n\n`);
    };
    send(metrics.current());
    const unsubscribe = metrics.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

    res.on('error', () => {}); // 끊긴 소켓에 쓰다 난 오류는 close 에서 정리한다
    res.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      open.delete(res);
    });
  });
}
