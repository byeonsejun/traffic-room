import type { Category, TrafficSummary } from '@traffic-room/shared';
import type { Db } from './db.ts';

export type NewTrafficSnapshot = {
  dataAt: Date;
  collectedAt: Date;
  showAt: Date;
  summary: TrafficSummary;
  routes: { route: string; avgSpeed: number }[];
  speeds: { linkId: string; speed: number }[];
};
export type TrafficSnapshotRow = { id: number; dataAt: Date; showAt: Date; summary: TrafficSummary };
export type ByCategory = Record<Category, number>;
export type Insights = {
  buckets: (TrafficSummary & { dataAt: string })[];
  routes: { dataAt: string; route: string; avgSpeed: number }[];
  incidentsByHour: { hour: string; total: number; byCategory: ByCategory }[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (d: Date) => d.toISOString();
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(v as string));
const emptyCategories = (): ByCategory => ({
  accident: 0, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0,
});

/**
 * 스냅샷 · 구간 속도 · 두 버킷을 문장 하나(데이터 변경 CTE)로 넣어 원자성을 얻고 id 도 한 번에 돌려받는다.
 * 같은 data_at 이면 unique 위반으로 문장 전체가 되돌려진다. 구간 속도는 unnest 배열 한 번으로 넣는다.
 */
export async function saveTrafficSnapshot(db: Db, s: NewTrafficSnapshot): Promise<number> {
  const m = s.summary;
  const rows = await db.query<{ id: string | number }>(
    `with snap as (
       insert into traffic_snapshots
         (data_at, collected_at, show_at, link_count, avg_speed, ok, slow, jam, jam_km)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id
     ), links as (
       insert into link_speeds (snapshot_id, link_id, speed)
       select snap.id, u.link_id, u.speed
       from snap, unnest($10::text[], $11::smallint[]) as u(link_id, speed)
     ), bucket as (
       insert into traffic_buckets (data_at, avg_speed, ok, slow, jam, jam_km)
       values ($1, $5, $6, $7, $8, $9)
     ), route as (
       insert into route_buckets (data_at, route, avg_speed)
       select $1, r.route, r.avg_speed
       from unnest($12::text[], $13::real[]) as r(route, avg_speed)
     )
     select id from snap`,
    [
      iso(s.dataAt), iso(s.collectedAt), iso(s.showAt), s.speeds.length,
      m.avgSpeed, m.ok, m.slow, m.jam, m.jamKm,
      s.speeds.map((x) => x.linkId), s.speeds.map((x) => x.speed),
      s.routes.map((x) => x.route), s.routes.map((x) => x.avgSpeed),
    ],
  );
  return Number(rows[0]!.id);
}

export async function latestTrafficSnapshot(
  db: Db,
): Promise<{ id: number; dataAt: Date; linkCount: number } | null> {
  const rows = await db.query<{ id: string | number; data_at: Date | string; link_count: number }>(
    'select id, data_at, link_count from traffic_snapshots order by data_at desc limit 1',
  );
  const r = rows[0];
  return r ? { id: Number(r.id), dataAt: toDate(r.data_at), linkCount: r.link_count } : null;
}

/** 최신 3개 밖의 스냅샷(구간 속도는 cascade)과 26시간 지난 버킷을 지운다. */
export async function pruneTraffic(db: Db, now: Date): Promise<void> {
  const cutoff = iso(new Date(now.getTime() - 26 * HOUR));
  await db.batch([
    {
      text: `delete from traffic_snapshots where id not in
             (select id from traffic_snapshots order by data_at desc limit 3)`,
    },
    { text: 'delete from traffic_buckets where data_at < $1', params: [cutoff] },
    { text: 'delete from route_buckets where data_at < $1', params: [cutoff] },
  ]);
}

/** event_log 가 incidents 를 참조하므로 로그를 먼저 지운다. */
export async function pruneHistory(db: Db, now: Date): Promise<void> {
  const incidentCutoff = iso(new Date(now.getTime() - 7 * DAY));
  const runCutoff = iso(new Date(now.getTime() - 30 * DAY));
  await db.batch([
    {
      text: `delete from event_log where incident_key in
             (select key from incidents where cleared_at < $1)`,
      params: [incidentCutoff],
    },
    { text: 'delete from incidents where cleared_at < $1', params: [incidentCutoff] },
    { text: 'delete from collector_runs where ran_at < $1', params: [runCutoff] },
  ]);
}

interface SnapshotDbRow {
  id: string | number; data_at: Date | string; show_at: Date | string;
  avg_speed: number; ok: number; slow: number; jam: number; jam_km: number;
}
const SNAPSHOT_COLS = 'id, data_at, show_at, avg_speed, ok, slow, jam, jam_km';
const toSnapshotRow = (r: SnapshotDbRow): TrafficSnapshotRow => ({
  id: Number(r.id),
  dataAt: toDate(r.data_at),
  showAt: toDate(r.show_at),
  summary: { avgSpeed: Number(r.avg_speed), ok: r.ok, slow: r.slow, jam: r.jam, jamKm: Number(r.jam_km) },
});

/** 지금 화면에 보여 줄 스냅샷: show_at 이 지난 것 중 가장 새것. */
export async function shownTrafficSnapshot(db: Db, now: Date): Promise<TrafficSnapshotRow | null> {
  const rows = await db.query<SnapshotDbRow>(
    `select ${SNAPSHOT_COLS} from traffic_snapshots where show_at <= $1 order by show_at desc limit 1`,
    [iso(now)],
  );
  return rows[0] ? toSnapshotRow(rows[0]) : null;
}

/** show_at 이 (from, to] 인 스냅샷을 공개 순서대로. */
export async function upcomingTrafficSnapshots(db: Db, from: Date, to: Date): Promise<TrafficSnapshotRow[]> {
  const rows = await db.query<SnapshotDbRow>(
    `select ${SNAPSHOT_COLS} from traffic_snapshots where show_at > $1 and show_at <= $2 order by show_at`,
    [iso(from), iso(to)],
  );
  return rows.map(toSnapshotRow);
}

export async function getLinkSpeeds(db: Db, snapshotId: number): Promise<[string, number][]> {
  const rows = await db.query<{ link_id: string; speed: number }>(
    'select link_id, speed from link_speeds where snapshot_id = $1 order by link_id',
    [snapshotId],
  );
  return rows.map((r) => [r.link_id, r.speed]);
}

// 사용자에게 이미 보이는(도착 시각이 지난) 돌발만 센다. getActiveIncidents 와 같은 기준.
const VISIBLE = '(arrive_at is null or arrive_at <= $1)';

export async function activeIncidentCounts(
  db: Db,
  now: Date,
): Promise<{ total: number; byCategory: ByCategory }> {
  const rows = await db.query<{ category: Category; n: string | number }>(
    `select category, count(*) as n from incidents
     where (cleared_at is null or cleared_at > $1) and ${VISIBLE} group by category`,
    [iso(now)],
  );
  const byCategory = emptyCategories();
  let total = 0;
  for (const r of rows) {
    byCategory[r.category] = Number(r.n);
    total += Number(r.n);
  }
  return { total, byCategory };
}

/**
 * 24시간 요약. `trafficUntil`(기본 now)보다 새 교통 기록은 아직 화면에 보일 차례가 아니라 빼고,
 * 돌발 집계는 `now` 기준 그대로 둔다.
 */
export async function getInsights(db: Db, now: Date, opts: { trafficUntil?: Date } = {}): Promise<Insights> {
  const since = iso(new Date(now.getTime() - 26 * HOUR));
  const sinceDay = iso(new Date(now.getTime() - DAY));
  const until = iso(opts.trafficUntil ?? now);
  const buckets = await db.query<Omit<SnapshotDbRow, 'id' | 'show_at'>>(
    `select data_at, avg_speed, ok, slow, jam, jam_km from traffic_buckets
     where data_at >= $1 and data_at <= $2 order by data_at`,
    [since, until],
  );
  const routes = await db.query<{ data_at: Date | string; route: string; avg_speed: number }>(
    `select data_at, route, avg_speed from route_buckets
     where data_at >= $1 and data_at <= $2 order by data_at, route`,
    [since, until],
  );
  const hours = await db.query<{ hour: Date | string; category: Category; n: string | number }>(
    `select date_trunc('hour', started_at at time zone 'UTC') at time zone 'UTC' as hour, category, count(*) as n
     from incidents
     where started_at > $1 and started_at <= $2 and (arrive_at is null or arrive_at <= $2)
     group by 1, category order by 1`,
    [sinceDay, iso(now)],
  );
  const byHour = new Map<string, { hour: string; total: number; byCategory: ByCategory }>();
  for (const r of hours) {
    const hour = toDate(r.hour).toISOString();
    const h = byHour.get(hour) ?? { hour, total: 0, byCategory: emptyCategories() };
    h.byCategory[r.category] += Number(r.n);
    h.total += Number(r.n);
    byHour.set(hour, h);
  }
  return {
    buckets: buckets.map((b) => ({
      dataAt: toDate(b.data_at).toISOString(),
      avgSpeed: Number(b.avg_speed), ok: b.ok, slow: b.slow, jam: b.jam, jamKm: Number(b.jam_km),
    })),
    routes: routes.map((r) => ({ dataAt: toDate(r.data_at).toISOString(), route: r.route, avgSpeed: Number(r.avg_speed) })),
    incidentsByHour: [...byHour.values()],
  };
}
