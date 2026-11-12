import type { Cctv, Incident, LogEvent } from '@traffic-room/shared';
import type { Db, Statement } from './db';

export type Service = 'events' | 'cctv';
export type IncidentPlan = {
  quiet: Incident[];
  arriving: { incident: Incident; emitAt: Date }[];
  seen: string[];
  cleared: { key: string; emitAt: Date }[];
};

/** 월 호출 한도(서비스별 1,000건) 앞의 안전 여유. 이 값 이상이면 호출하지 않는다. */
export const MONTHLY_CALL_LIMIT = 950;

const iso = (d: Date) => d.toISOString();
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(v as string));
const toIso = (v: unknown) => toDate(v).toISOString();

interface IncidentRow {
  key: string; category: Incident['category']; road_name: string; direction: string;
  detail: string; message: string; lanes_blocked: string; lon: number; lat: number;
  started_at: Date | string | null;
}

const INCIDENT_COLS =
  'key, category, road_name, direction, detail, message, lanes_blocked, lon, lat, started_at';

const toIncident = (r: IncidentRow): Incident => ({
  key: r.key, category: r.category, roadName: r.road_name, direction: r.direction,
  detail: r.detail, message: r.message, lanesBlocked: r.lanes_blocked,
  lon: Number(r.lon), lat: Number(r.lat),
  startedAt: r.started_at == null ? null : toIso(r.started_at),
});

export async function getActiveIncidents(db: Db, now: Date): Promise<Incident[]> {
  const rows = await db.query<IncidentRow>(
    `select ${INCIDENT_COLS} from incidents
     where (cleared_at is null or cleared_at > $1)
       and (arrive_at is null or arrive_at <= $1)
     order by first_seen_at, key`,
    [iso(now)],
  );
  return rows.map(toIncident);
}

export async function getActiveKeys(db: Db): Promise<string[]> {
  const rows = await db.query<{ key: string }>(
    'select key from incidents where cleared_at is null order by key',
  );
  return rows.map((r) => r.key);
}

const INSERT_INCIDENT = `insert into incidents
  (key, category, road_name, direction, detail, message, lanes_blocked, lon, lat,
   started_at, first_seen_at, last_seen_at, arrive_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
  on conflict (key) do nothing`;

function insertParams(i: Incident, collectedAt: Date, arriveAt: Date | null): unknown[] {
  return [
    i.key, i.category, i.roadName, i.direction, i.detail, i.message, i.lanesBlocked,
    i.lon, i.lat, i.startedAt, iso(collectedAt), arriveAt ? iso(arriveAt) : null,
  ];
}

/** 한 트랜잭션으로 적용한다. 로그는 실제로 바뀐 행에 대해서만 남긴다. */
export async function applyIncidentPlan(db: Db, plan: IncidentPlan, collectedAt: Date): Promise<void> {
  const stmts: Statement[] = [];

  for (const i of plan.quiet) {
    stmts.push({ text: INSERT_INCIDENT, params: insertParams(i, collectedAt, null) });
  }
  for (const { incident, emitAt } of plan.arriving) {
    stmts.push({
      text: `with ins as (
               insert into incidents
                 (key, category, road_name, direction, detail, message, lanes_blocked, lon, lat,
                  started_at, first_seen_at, last_seen_at, arrive_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
               on conflict (key) do nothing
               returning key)
             insert into event_log (kind, incident_key, emit_at)
             select 'arrived', key, $12::timestamptz from ins`,
      params: insertParams(incident, collectedAt, emitAt),
    });
  }
  if (plan.seen.length > 0) {
    stmts.push({
      text: 'update incidents set last_seen_at = $2 where key = any($1::text[])',
      params: [plan.seen, iso(collectedAt)],
    });
  }
  for (const { key, emitAt } of plan.cleared) {
    stmts.push({
      text: `with upd as (
               update incidents set cleared_at = $2 where key = $1 and cleared_at is null
               returning key)
             insert into event_log (kind, incident_key, emit_at)
             select 'cleared', key, $2::timestamptz from upd`,
      params: [key, iso(emitAt)],
    });
  }

  await db.batch(stmts);
}

interface EventRow extends IncidentRow {
  log_id: number | string; kind: LogEvent['kind']; emit_at: Date | string;
}

const EVENT_SELECT = `select l.id::int as log_id, l.kind, l.emit_at,
  ${INCIDENT_COLS.split(', ').map((c) => `i.${c}`).join(', ')}
  from event_log l join incidents i on i.key = l.incident_key`;

const toEvent = (r: EventRow): LogEvent => ({
  id: Number(r.log_id), kind: r.kind, emitAt: toIso(r.emit_at), incident: toIncident(r),
});

export async function getEventsAfter(db: Db, afterId: number, until: Date, limit: number): Promise<LogEvent[]> {
  const rows = await db.query<EventRow>(
    `${EVENT_SELECT} where l.id > $1 and l.emit_at <= $2 order by l.id limit $3`,
    [afterId, iso(until), limit],
  );
  return rows.map(toEvent);
}

export async function getEventsBetween(db: Db, from: Date, to: Date): Promise<LogEvent[]> {
  const rows = await db.query<EventRow>(
    `${EVENT_SELECT} where l.emit_at > $1 and l.emit_at <= $2 order by l.id`,
    [iso(from), iso(to)],
  );
  return rows.map(toEvent);
}

export async function latestEmittedId(db: Db, now: Date): Promise<number> {
  const rows = await db.query<{ id: number | string | null }>(
    'select max(id)::int as id from event_log where emit_at <= $1',
    [iso(now)],
  );
  return Number(rows[0]?.id ?? 0);
}

export async function lastCollectedAt(db: Db, service: Service): Promise<Date | null> {
  const rows = await db.query<{ at: Date | string | null }>(
    'select max(ran_at) as at from collector_runs where service = $1 and ok',
    [service],
  );
  const at = rows[0]?.at;
  return at == null ? null : toDate(at);
}

export async function recordRun(db: Db, service: Service, ok: boolean, count: number, at: Date): Promise<void> {
  await db.query('insert into collector_runs (service, ran_at, ok, count) values ($1, $2, $3, $4)', [
    service, iso(at), ok, count,
  ]);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** now 가 속한 KST 달의 [시작, 다음 달 시작) 을 UTC Date 로 돌려준다. */
function kstMonthRange(now: Date): [Date, Date] {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();
  return [new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS), new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS)];
}

export async function countRunsThisMonth(db: Db, service: Service, now: Date): Promise<number> {
  const [from, to] = kstMonthRange(now);
  const rows = await db.query<{ n: number | string }>(
    'select count(*)::int as n from collector_runs where service = $1 and ran_at >= $2 and ran_at < $3',
    [service, iso(from), iso(to)],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function canCall(db: Db, service: Service, now: Date): Promise<boolean> {
  return (await countRunsThisMonth(db, service, now)) < MONTHLY_CALL_LIMIT;
}

interface CctvRow { id: string; name: string; lon: number; lat: number; url: string; fetched_at: Date | string }
const toCctv = (r: CctvRow): Cctv => ({
  id: r.id, name: r.name, lon: Number(r.lon), lat: Number(r.lat), url: r.url, fetchedAt: toIso(r.fetched_at),
});

export async function upsertCctvs(db: Db, list: Cctv[]): Promise<void> {
  // id 가 같은 행이 한 응답에 섞여 있을 수 있다. 마지막 것만 남겨 한 행을 두 번 건드리지 않는다.
  const byId = new Map<string, Cctv>();
  for (const c of list) byId.set(c.id, c);
  if (byId.size === 0) return;
  const stmts: Statement[] = [...byId.values()].map((c) => ({
    text: `insert into cctvs (id, name, lon, lat, url, fetched_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (id) do update set name = excluded.name, lon = excluded.lon, lat = excluded.lat,
             url = excluded.url, fetched_at = excluded.fetched_at`,
    params: [c.id, c.name, c.lon, c.lat, c.url, c.fetchedAt],
  }));
  await db.batch(stmts);
}

export async function getCctvs(db: Db): Promise<Cctv[]> {
  return (await db.query<CctvRow>('select * from cctvs order by id')).map(toCctv);
}

export async function getCctv(db: Db, id: string): Promise<Cctv | null> {
  const rows = await db.query<CctvRow>('select * from cctvs where id = $1', [id]);
  return rows[0] ? toCctv(rows[0]) : null;
}

export async function updateCctvUrl(db: Db, id: string, url: string, at: Date): Promise<void> {
  await db.query('update cctvs set url = $2, fetched_at = $3 where id = $1', [id, url, iso(at)]);
}
