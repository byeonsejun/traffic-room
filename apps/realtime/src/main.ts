import {
  activeIncidentCounts, createNeonDb, getEventsBetween, shownTrafficSnapshot, upcomingTrafficSnapshots,
} from '@traffic-room/db';
import { createItsClient } from '@traffic-room/its';
import { readTiming } from '@traffic-room/shared';
import { createHub } from './hub.ts';
import { createMetricsState } from './metrics.ts';
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
/** 돌발 송출 스케줄러가 다음 창을 읽는 주기. 지표 주기와 따로다. */
const SCHEDULER_RELOAD_MINUTES = 30;

// 지표는 min(30분, 수집 간격)마다만 DB 를 읽는다(Neon 자동 일시정지 유지).
// 아직 공개 전인 교통 스냅샷은 시각 제한 없이 전부(정리 덕에 몇 줄) 읽어 두고 showAt 에 맞춰 내보낸다.
// 그래서 다음 스냅샷이 DB 에 있으면 nextTrafficAt 은 늘 알려진다.
const metrics = createMetricsState({
  load: async (at) => {
    const [shown, upcoming, incidents] = await Promise.all([
      shownTrafficSnapshot(db, at),
      upcomingTrafficSnapshots(db, at),
      activeIncidentCounts(db, at),
    ]);
    return { shown, upcoming, incidents };
  },
  now,
  timing,
});

const app = await buildServer({ db, its, now, timing, allowedOrigins, hub, cctvRefresh, metrics, logger: true });
const scheduler = createScheduler({
  loadWindow: (from, to) => getEventsBetween(db, from, to),
  emit: (e) => {
    hub.broadcast(e);
    metrics.onEvent(e);
  },
  now,
  windowMinutes: 60,
  reloadMinutes: SCHEDULER_RELOAD_MINUTES,
});

await app.listen({ port, host: '0.0.0.0' });
app.log.info(`its mode=${mode}, allowed origins=${allowedOrigins.length}, cctv refresh=${cctvRefresh ? 'on' : 'off'}`);
await scheduler.start();
await metrics.start();

const shutdown = async () => {
  scheduler.stop();
  metrics.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
