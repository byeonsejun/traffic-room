import { beforeEach, describe, expect, test } from 'vitest';
import type { Db } from './db.ts';
import { createTestDb } from './test-db.ts';
import {
  activeIncidentCounts, getInsights, getLinkSpeeds, latestTrafficSnapshot, pruneHistory, pruneTraffic,
  saveTrafficSnapshot, shownTrafficSnapshot, upcomingTrafficSnapshots, type NewTrafficSnapshot,
} from './traffic-repo.ts';

const now = new Date('2026-11-13T12:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000);
const snap = (dataAt: Date, over: Partial<NewTrafficSnapshot> = {}): NewTrafficSnapshot => ({
  dataAt, collectedAt: dataAt, showAt: at(-1),
  summary: { avgSpeed: 63.5, ok: 2, slow: 1, jam: 0, jamKm: 0 },
  routes: [{ route: '경부선', avgSpeed: 70.5 }],
  speeds: [{ linkId: 'L1', speed: 80 }, { linkId: 'L2', speed: 60 }, { linkId: 'L3', speed: 50 }],
  ...over,
});

let db: Db;
beforeEach(async () => { db = await createTestDb(); });

const ids = async () =>
  (await db.query<{ id: string }>('select id from traffic_snapshots order by id')).map((r) => Number(r.id));

describe('save / latest', () => {
  test('returns id and stores summary, links and both buckets', async () => {
    const id = await saveTrafficSnapshot(db, snap(at(-60)));
    expect(await latestTrafficSnapshot(db)).toEqual({ id, dataAt: at(-60), linkCount: 3 });
    expect(await getLinkSpeeds(db, id)).toHaveLength(3);
    expect(await getLinkSpeeds(db, id)).toContainEqual(['L2', 60]);
    const i = await getInsights(db, now);
    expect(i.buckets).toEqual([{ dataAt: at(-60).toISOString(), avgSpeed: 63.5, ok: 2, slow: 1, jam: 0, jamKm: 0 }]);
    expect(i.routes).toEqual([{ dataAt: at(-60).toISOString(), route: '경부선', avgSpeed: 70.5 }]);
  });

  test('latest is null when empty', async () => {
    expect(await latestTrafficSnapshot(db)).toBeNull();
  });

  test('same dataAt twice fails and keeps the first data', async () => {
    const id = await saveTrafficSnapshot(db, snap(at(-60)));
    await expect(saveTrafficSnapshot(db, snap(at(-60), { speeds: [{ linkId: 'X', speed: 1 }] }))).rejects.toThrow(/duplicate key|unique/i);
    expect(await ids()).toEqual([id]);
    expect(await getLinkSpeeds(db, id)).toHaveLength(3);
    expect((await getInsights(db, now)).buckets).toHaveLength(1);
  });

  test('handles a full-size snapshot in one call', async () => {
    const speeds = Array.from({ length: 20000 }, (_, k) => ({ linkId: `L${k}`, speed: k % 120 }));
    const id = await saveTrafficSnapshot(db, snap(at(-60), { speeds }));
    expect(await getLinkSpeeds(db, id)).toHaveLength(20000);
  });
});

describe('pruneTraffic', () => {
  test('keeps only the newest 3 snapshots and their links', async () => {
    const all: number[] = [];
    for (let k = 5; k >= 1; k--) all.push(await saveTrafficSnapshot(db, snap(at(-k * 60))));
    await pruneTraffic(db, now);
    expect(await ids()).toEqual(all.slice(2));
    const n = await db.query<{ n: string }>('select count(*) as n from link_speeds');
    expect(Number(n[0]!.n)).toBe(9);
  });

  test('drops buckets older than 26h only', async () => {
    await saveTrafficSnapshot(db, snap(at(-27 * 60)));
    await saveTrafficSnapshot(db, snap(at(-25 * 60)));
    await pruneTraffic(db, now);
    const i = await getInsights(db, now);
    expect(i.buckets.map((b) => b.dataAt)).toEqual([at(-25 * 60).toISOString()]);
    expect(i.routes.map((r) => r.dataAt)).toEqual([at(-25 * 60).toISOString()]);
  });
});

describe('shown / upcoming', () => {
  test('shown is the latest snapshot whose showAt has passed', async () => {
    await saveTrafficSnapshot(db, snap(at(-120), { showAt: at(-60) }));
    const future = await saveTrafficSnapshot(db, snap(at(-60), { showAt: at(30) }));
    const shown = await shownTrafficSnapshot(db, now);
    expect(shown?.dataAt).toEqual(at(-120));
    expect(shown?.showAt).toEqual(at(-60));
    expect(shown?.summary).toEqual({ avgSpeed: 63.5, ok: 2, slow: 1, jam: 0, jamKm: 0 });
    expect(shown?.id).not.toBe(future);
  });

  test('null when every snapshot is still in the future', async () => {
    await saveTrafficSnapshot(db, snap(at(-120), { showAt: at(10) }));
    await saveTrafficSnapshot(db, snap(at(-60), { showAt: at(20) }));
    expect(await shownTrafficSnapshot(db, now)).toBeNull();
  });

  test('upcoming is (from, to]', async () => {
    await saveTrafficSnapshot(db, snap(at(-180), { showAt: at(0) }));
    const b = await saveTrafficSnapshot(db, snap(at(-120), { showAt: at(10) }));
    const c = await saveTrafficSnapshot(db, snap(at(-60), { showAt: at(30) }));
    await saveTrafficSnapshot(db, snap(at(-30), { showAt: at(31) }));
    const rows = await upcomingTrafficSnapshots(db, now, at(30));
    expect(rows.map((r) => r.id)).toEqual([b, c]);
  });
});

async function addIncident(key: string, cat: string, over: { started?: Date | null; cleared?: Date | null; arrive?: Date | null } = {}) {
  await db.query(
    `insert into incidents (key, category, road_name, direction, detail, message, lanes_blocked, lon, lat,
       started_at, first_seen_at, last_seen_at, arrive_at, cleared_at)
     values ($1, $2, 'r', 'd', 'x', 'm', '', 127, 37, $3, $4, $4, $5, $6)`,
    [key, cat, over.started === undefined ? at(-30) : over.started, at(-30), over.arrive ?? null, over.cleared ?? null],
  );
}

describe('pruneHistory', () => {
  test('removes incidents cleared 7+ days ago with their log, old runs; keeps the rest', async () => {
    const day = 24 * 60;
    await addIncident('old', 'accident', { cleared: at(-8 * day) });
    await addIncident('recent', 'accident', { cleared: at(-6 * day) });
    await addIncident('open', 'accident');
    for (const k of ['old', 'recent', 'open']) {
      await db.query(`insert into event_log (kind, incident_key, emit_at) values ('arrived', $1, $2)`, [k, at(-9 * day)]);
    }
    await db.query(`insert into collector_runs (service, ran_at, ok, count) values ('events', $1, true, 1), ('traffic', $2, true, 1)`, [at(-31 * day), at(-29 * day)]);
    await pruneHistory(db, now);
    expect((await db.query<{ key: string }>('select key from incidents order by key')).map((r) => r.key)).toEqual(['open', 'recent']);
    expect((await db.query<{ k: string }>('select incident_key as k from event_log order by id')).map((r) => r.k)).toEqual(['recent', 'open']);
    expect(await db.query('select 1 from collector_runs')).toHaveLength(1);
  });
});

describe('incident stats', () => {
  test('activeIncidentCounts counts visible uncleared incidents by category', async () => {
    await addIncident('a', 'accident');
    await addIncident('b', 'accident');
    await addIncident('c', 'weather');
    await addIncident('gone', 'accident', { cleared: at(-5) });
    await addIncident('hidden', 'report', { arrive: at(10) });
    expect(await activeIncidentCounts(db, now)).toEqual({
      total: 3,
      byCategory: { accident: 2, breakdown: 0, weather: 1, construction: 0, report: 0, other: 0 },
    });
  });

  test('incidentsByHour buckets started_at of the last 24h by UTC hour', async () => {
    await addIncident('a', 'accident', { started: new Date('2026-11-13T10:10:00Z') });
    await addIncident('b', 'weather', { started: new Date('2026-11-13T10:50:00Z') });
    await addIncident('c', 'accident', { started: new Date('2026-11-12T20:00:00Z') });
    await addIncident('old', 'accident', { started: new Date('2026-11-11T20:00:00Z') });
    await addIncident('none', 'accident', { started: null });
    const { incidentsByHour } = await getInsights(db, now);
    expect(incidentsByHour).toEqual([
      { hour: '2026-11-12T20:00:00.000Z', total: 1, byCategory: { accident: 1, breakdown: 0, weather: 0, construction: 0, report: 0, other: 0 } },
      { hour: '2026-11-13T10:00:00.000Z', total: 2, byCategory: { accident: 1, breakdown: 0, weather: 1, construction: 0, report: 0, other: 0 } },
    ]);
  });
});
