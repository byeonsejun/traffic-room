import { createNeonDb, getEventsBetween } from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { readTiming } from '@traffic-room/shared';
import { createHub } from './hub.ts';
import { createScheduler } from './scheduler.ts';
import { buildServer } from './server.ts';
import { readConfig } from './config.ts';

// 키와 접속 문자열은 어디에도 찍지 않는다.
const read = readConfig(process.env);
if (!read.ok) {
  console.error(read.error);
  process.exit(1);
}
for (const w of read.warnings) console.warn(`[config] ${w}`);
const { databaseUrl, port, mode, allowedOrigins, cctvRefresh } = read.config;

const db = createNeonDb(databaseUrl);
const its = createItsClient({ mode, apiKey: process.env.ITS_API_KEY });
const now = () => new Date();
const timing = readTiming(process.env);
const hub = createHub();

const app = await buildServer({ db, its, now, timing, allowedOrigins, hub, cctvRefresh, logger: true });
const scheduler = createScheduler({
  loadWindow: (from, to) => getEventsBetween(db, from, to),
  emit: (e) => hub.broadcast(e),
  now,
  windowMinutes: 60,
  reloadMinutes: 30,
});

await app.listen({ port, host: '0.0.0.0' });
app.log.info(`its mode=${mode}, allowed origins=${allowedOrigins.length}, cctv refresh=${cctvRefresh ? 'on' : 'off'}`);
await scheduler.start();

const shutdown = async () => {
  scheduler.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
