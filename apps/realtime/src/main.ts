import { createNeonDb, getEventsBetween } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { createHub } from './hub.ts';
import { createScheduler } from './scheduler.ts';
import { buildServer } from './server.ts';

// 키와 접속 문자열은 어디에도 찍지 않는다.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8787);
const mode = process.env.ITS_MODE === 'live' ? 'live' : 'fixture';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const db = createNeonDb(databaseUrl);
const its = createItsClient({ mode, apiKey: process.env.ITS_API_KEY });
const now = () => new Date();
const hub = createHub();

const app = await buildServer({ db, its, now, allowedOrigins, hub, logger: true });
const scheduler = createScheduler({
  loadWindow: (from, to) => getEventsBetween(db, from, to),
  emit: (e) => hub.broadcast(e),
  now,
  windowMinutes: 60,
  reloadMinutes: 30,
});

await app.listen({ port, host: '0.0.0.0' });
app.log.info(`its mode=${mode}, allowed origins=${allowedOrigins.length}`);
await scheduler.start();

const shutdown = async () => {
  scheduler.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
