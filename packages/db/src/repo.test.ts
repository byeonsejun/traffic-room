import { beforeEach, describe, expect, test } from 'vitest';
import type { Cctv, Incident } from '@traffic-room/shared';
import type { Db } from './db.ts';
import { createTestDb } from './test-db.ts';
import {
  applyIncidentPlan, canCall, countRunsThisMonth, getActiveIncidents, getActiveKeys, getCctv,
  getCctvs, getEventsAfter, getEventsBetween, lastCollectedAt, latestEmittedId, recordRun,
  updateCctvUrl, upsertCctvs,
} from './repo.ts';

const t = (hm: string) => new Date(`2026-11-12T${hm}:00Z`);
const inc = (key: string, over: Partial<Incident> = {}): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '서울', detail: '추돌',
  message: '사고', lanesBlocked: '1차로', lon: 127.1, lat: 37.4,
  startedAt: '2026-11-12T22:00:00.000Z', ...over,
});
const none = { quiet: [], arriving: [], seen: [], cleared: [] };

let db: Db;
beforeEach(async () => { db = await createTestDb(); });

describe('incidents', () => {
  test('arriving incident is hidden from snapshot until its emit time', async () => {
    await applyIncidentPlan(db, { ...none, arriving: [{ incident: inc('a'), emitAt: t('23:50') }] }, t('23:05'));
    expect(await getActiveIncidents(db, t('23:10'))).toHaveLength(0);
    expect(await getActiveIncidents(db, t('23:51'))).toHaveLength(1);
    expect(await getActiveKeys(db)).toEqual(['a']);
  });

  test('quiet incident is visible immediately and round-trips fields', async () => {
    const a = inc('q', { startedAt: null });
    await applyIncidentPlan(db, { ...none, quiet: [a] }, t('10:00'));
    expect(await getActiveIncidents(db, t('10:00'))).toEqual([a]);
    expect(await getEventsAfter(db, 0, t('23:59'), 10)).toEqual([]);
  });

  test('log ids are increasing and events are returned in emit order', async () => {
    await applyIncidentPlan(db, {
      ...none,
      arriving: [{ incident: inc('a'), emitAt: t('10:00') }, { incident: inc('b'), emitAt: t('10:05') }],
    }, t('09:00'));
    const events = await getEventsAfter(db, 0, t('11:00'), 10);
    expect(events.map((e) => [e.kind, e.incident.key])).toEqual([['arrived', 'a'], ['arrived', 'b']]);
    expect(events[0]!.id).toBeLessThan(events[1]!.id);
    expect(typeof events[0]!.id).toBe('number');
    expect(events[0]!.emitAt).toBe('2026-11-12T10:00:00.000Z');
    expect(await getEventsAfter(db, events[0]!.id, t('11:00'), 10)).toHaveLength(1);
    expect(await getEventsAfter(db, 0, t('10:02'), 10)).toHaveLength(1);
    expect(await getEventsAfter(db, 0, t('11:00'), 1)).toHaveLength(1);
    expect(await getEventsBetween(db, t('10:03'), t('10:10'))).toHaveLength(1);
    expect(await latestEmittedId(db, t('10:02'))).toBe(events[0]!.id);
    expect(await latestEmittedId(db, t('09:00'))).toBe(0);
  });

  test('ids follow emit order even when the plan lists entries out of order', async () => {
    await applyIncidentPlan(db, { ...none, quiet: [inc('old')] }, t('08:00'));
    await applyIncidentPlan(db, {
      ...none,
      arriving: [{ incident: inc('late'), emitAt: t('10:30') }, { incident: inc('early'), emitAt: t('10:00') }],
      cleared: [{ key: 'old', emitAt: t('10:15') }],
    }, t('09:00'));
    const events = await getEventsAfter(db, 0, t('12:00'), 10);
    expect(events.map((e) => `${e.kind}:${e.incident.key}`)).toEqual(['arrived:early', 'cleared:old', 'arrived:late']);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const times = events.map((e) => e.emitAt);
    expect(times).toEqual([...times].sort());
  });

  test('a later run with an earlier emit time is clamped so ids and emit_at stay monotonic', async () => {
    await applyIncidentPlan(db, { ...none, arriving: [{ incident: inc('a'), emitAt: t('10:30') }] }, t('09:30'));
    await applyIncidentPlan(db, {
      ...none,
      arriving: [{ incident: inc('b'), emitAt: t('10:10') }],
      cleared: [{ key: 'a', emitAt: t('10:20') }],
    }, t('09:40'));
    const events = await getEventsAfter(db, 0, t('12:00'), 10);
    expect(events.map((e) => e.incident.key + e.kind)).toEqual(['aarrived', 'barrived', 'acleared']);
    expect(events.map((e) => e.emitAt)).toEqual(Array(3).fill(t('10:30').toISOString()));
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    // 스냅샷 노출 시각도 보정된 값과 같다: a·b 모두 10:30 전에는 보이지 않고, 10:30 이후에는 a 가 사라지고 b 만 남는다.
    expect((await getActiveIncidents(db, t('10:20'))).map((i) => i.key)).toEqual([]);
    expect((await getActiveIncidents(db, t('10:31'))).map((i) => i.key)).toEqual(['b']);
  });

  test('cleared incident leaves the snapshot after its emit time', async () => {
    await applyIncidentPlan(db, { ...none, quiet: [inc('a')] }, t('09:00'));
    await applyIncidentPlan(db, { ...none, cleared: [{ key: 'a', emitAt: t('11:00') }] }, t('10:00'));
    expect(await getActiveIncidents(db, t('10:30'))).toHaveLength(1);
    expect(await getActiveIncidents(db, t('11:01'))).toHaveLength(0);
    expect(await getActiveKeys(db)).toEqual([]);
    const events = await getEventsAfter(db, 0, t('12:00'), 10);
    expect(events.map((e) => e.kind)).toEqual(['cleared']);
    expect(events[0]!.incident.key).toBe('a');
  });

  test('existing key insert is ignored and writes no duplicate log', async () => {
    const plan = { ...none, arriving: [{ incident: inc('a'), emitAt: t('10:00') }] };
    await applyIncidentPlan(db, plan, t('09:00'));
    await applyIncidentPlan(db, plan, t('09:10'));
    expect(await getEventsAfter(db, 0, t('12:00'), 10)).toHaveLength(1);
  });

  test('seen updates last_seen_at', async () => {
    await applyIncidentPlan(db, { ...none, quiet: [inc('a')] }, t('09:00'));
    await applyIncidentPlan(db, { ...none, seen: ['a'] }, t('09:30'));
    const [row] = await db.query<{ last_seen_at: Date }>('select last_seen_at from incidents where key = $1', ['a']);
    expect(new Date(row!.last_seen_at).toISOString()).toBe(t('09:30').toISOString());
  });

  test('plan is atomic: a failing statement rolls everything back', async () => {
    const bad = inc('b', { category: null as never });
    await expect(applyIncidentPlan(db, {
      ...none, quiet: [inc('a')], arriving: [{ incident: bad, emitAt: t('10:00') }],
    }, t('09:00'))).rejects.toThrow(/category/);
    expect(await getActiveKeys(db)).toEqual([]);
  });
});

describe('collector runs', () => {
  test('countRunsThisMonth resets at the KST month boundary', async () => {
    await recordRun(db, 'events', true, 1, new Date('2026-11-30T15:30:00Z')); // KST 12-01 00:30
    expect(await countRunsThisMonth(db, 'events', new Date('2026-12-01T03:00:00Z'))).toBe(1);
    expect(await countRunsThisMonth(db, 'events', new Date('2026-11-30T14:00:00Z'))).toBe(0);
  });

  test('failed runs count, services are separate, lastCollectedAt tracks ok runs', async () => {
    await recordRun(db, 'events', false, 0, t('01:00'));
    await recordRun(db, 'events', true, 3, t('02:00'));
    await recordRun(db, 'cctv', true, 9, t('03:00'));
    expect(await countRunsThisMonth(db, 'events', t('04:00'))).toBe(2);
    expect(await countRunsThisMonth(db, 'cctv', t('04:00'))).toBe(1);
    expect(await lastCollectedAt(db, 'events')).toEqual(t('02:00'));
    expect(await lastCollectedAt(db, 'cctv')).toEqual(t('03:00'));
  });

  test('lastCollectedAt is null without runs', async () => {
    expect(await lastCollectedAt(db, 'events')).toBeNull();
  });

  test('canCall follows the given limit', async () => {
    for (const m of ['01:00', '02:00']) await recordRun(db, 'events', true, 0, t(m));
    expect(await canCall(db, 'events', t('04:00'), 3)).toBe(true);
    await recordRun(db, 'events', true, 0, t('03:00'));
    expect(await canCall(db, 'events', t('04:00'), 3)).toBe(false);
    expect(await canCall(db, 'traffic', t('04:00'), 3)).toBe(true);
  });

  test('canCall is false from 950 runs this month', async () => {
    await db.query(
      `insert into collector_runs (service, ran_at, ok, count)
       select 'events', $1::timestamptz, true, 0 from generate_series(1, 949)`, [t('01:00').toISOString()]);
    expect(await canCall(db, 'events', t('04:00'), 950)).toBe(true);
    await recordRun(db, 'events', true, 0, t('02:00'));
    expect(await canCall(db, 'events', t('04:00'), 950)).toBe(false);
    expect(await canCall(db, 'cctv', t('04:00'), 950)).toBe(true);
  });
});

describe('cctvs', () => {
  const c = (id: string, over: Partial<Cctv> = {}): Cctv => ({
    id, name: `cam-${id}`, lon: 127, lat: 37, url: `https://x/${id}.m3u8`,
    fetchedAt: '2026-11-12T01:00:00.000Z', ...over,
  });

  test('upsert inserts, updates and dedupes ids inside one batch (last wins)', async () => {
    await upsertCctvs(db, [c('a'), c('b'), c('a', { name: 'dup', url: 'https://x/new.m3u8' })]);
    const all = await getCctvs(db);
    expect(all).toHaveLength(2);
    expect(await getCctv(db, 'a')).toEqual(c('a', { name: 'dup', url: 'https://x/new.m3u8' }));
    await upsertCctvs(db, [c('b', { name: 'renamed' })]);
    expect((await getCctv(db, 'b'))!.name).toBe('renamed');
    expect(await getCctv(db, 'zzz')).toBeNull();
  });

  test('empty upsert is a no-op', async () => {
    await upsertCctvs(db, []);
    expect(await getCctvs(db)).toEqual([]);
  });

  test('updateCctvUrl changes url and fetchedAt', async () => {
    await upsertCctvs(db, [c('a')]);
    await updateCctvUrl(db, 'a', 'https://x/fresh.m3u8', t('05:00'));
    expect(await getCctv(db, 'a')).toMatchObject({ url: 'https://x/fresh.m3u8', fetchedAt: t('05:00').toISOString() });
  });
});
