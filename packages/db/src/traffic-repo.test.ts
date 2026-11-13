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

  test('decimal speeds from ITS are stored as rounded integers', async () => {
    const speeds = [{ linkId: 'D1', speed: 55.5 }, { linkId: 'D2', speed: 66.7 }, { linkId: 'D3', speed: 0.4 }];
    const id = await saveTrafficSnapshot(db, snap(at(-60), { speeds }));
    expect(await getLinkSpeeds(db, id)).toEqual([['D1', 56], ['D2', 67], ['D3', 0]]);
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

describe('getInsights until', () => {
  test('buckets and routes stop at until so snapshots not shown yet stay out', async () => {
    await saveTrafficSnapshot(db, snap(at(-90)));
    await saveTrafficSnapshot(db, snap(at(-60)));
    await saveTrafficSnapshot(db, snap(at(-30), { showAt: at(30) }));
    const i = await getInsights(db, now, { until: at(-60) });
    expect(i.buckets.map((b) => b.dataAt)).toEqual([at(-90).toISOString(), at(-60).toISOString()]);
    expect(i.routes.map((r) => r.dataAt)).toEqual([at(-90).toISOString(), at(-60).toISOString()]);
    // 기본값은 지금까지(이전 동작 그대로)
    expect((await getInsights(db, now)).buckets).toHaveLength(3);
  });
});

describe('pruneTraffic', () => {
  // 실제처럼 show_at = data_at + 60분
  const save = (dataMin: number) => saveTrafficSnapshot(db, snap(at(dataMin), { showAt: at(dataMin + 60) }));

  test('keeps waiting snapshots, the shown one and the one before it', async () => {
    const all: number[] = [];
    for (const m of [-300, -240, -180, -120, -30]) all.push(await save(m));
    // show_at: -240, -180, -120, -60(보여 주는 것), +30(대기)
    await pruneTraffic(db, now);
    expect(await ids()).toEqual(all.slice(2));
    const n = await db.query<{ n: string }>('select count(*) as n from link_speeds');
    expect(Number(n[0]!.n)).toBe(9);
  });

  test('a long delay with many waiting snapshots never drops the shown one', async () => {
    // 지연 60분 · 수집 15분: show_at 이 미래인 대기 스냅샷이 넷
    const all: number[] = [];
    for (const m of [-120, -90, -75, -45, -30, -15, 0]) all.push(await save(m));
    // show_at: -60, -30, -15(보여 주는 것), +15, +30, +45, +60
    await pruneTraffic(db, now);
    expect(await ids()).toEqual(all.slice(1));
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

  test('upcoming is every snapshot with show_at after from, however far ahead', async () => {
    await saveTrafficSnapshot(db, snap(at(-180), { showAt: at(0) }));
    const b = await saveTrafficSnapshot(db, snap(at(-120), { showAt: at(10) }));
    const d = await saveTrafficSnapshot(db, snap(at(-30), { showAt: at(55) }));
    const c = await saveTrafficSnapshot(db, snap(at(-60), { showAt: at(30) }));
    const rows = await upcomingTrafficSnapshots(db, now);
    expect(rows.map((r) => r.id)).toEqual([b, c, d]);
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

  test('incidentsByHour covers the 24 hours ending at until, like traffic', async () => {
    // until = now - 60분 = 11:00. 창은 (전날 11:00, 11:00]
    await addIncident('late', 'accident', { started: new Date('2026-11-13T11:30:00Z') });
    await addIncident('edge', 'weather', { started: new Date('2026-11-13T11:00:00Z') });
    await addIncident('early', 'accident', { started: new Date('2026-11-12T11:30:00Z') });
    await addIncident('gone', 'accident', { started: new Date('2026-11-12T10:30:00Z') });
    const { incidentsByHour } = await getInsights(db, now, { until: at(-60) });
    expect(incidentsByHour.map((h) => [h.hour, h.total])).toEqual([
      ['2026-11-12T11:00:00.000Z', 1],
      ['2026-11-13T11:00:00.000Z', 1],
    ]);
  });
});
