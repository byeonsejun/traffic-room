// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Incident } from '@traffic-room/shared';
import type { Db } from '@traffic-room/db';
import { applyIncidentPlan, upsertCctvs } from '@traffic-room/db';
import { createTestDb } from '@traffic-room/db/test-db';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@traffic-room/db', async (orig) => ({
  ...(await orig<typeof import('@traffic-room/db')>()),
  createNeonDb: () => h.db,
}));

import { GET as getSnapshot } from './route';
import { GET as getCctvs } from '../cctvs/route';

const inc = (key: string): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '서울', detail: '추돌',
  message: '사고', lanesBlocked: '1차로', lon: 127.1, lat: 37.4, startedAt: null,
});
const none = { quiet: [], arriving: [], seen: [], cleared: [] };
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const ahead = (min: number) => new Date(Date.now() + min * 60_000);

afterEach(() => vi.unstubAllEnvs());

describe('with DATABASE_URL', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    h.db = db;
    vi.stubEnv('DATABASE_URL', 'postgres://test');
  });

  test('snapshot excludes incidents scheduled to arrive later', async () => {
    await applyIncidentPlan(db, {
      ...none,
      quiet: [inc('q')],
      arriving: [
        { incident: inc('past'), emitAt: ago(5) },
        { incident: inc('later'), emitAt: ahead(30) },
      ],
    }, ago(65));
    const res = await getSnapshot();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incidents.map((i: Incident) => i.key).sort()).toEqual(['past', 'q']);
    expect(body.delayMinutes).toBe(60);
    expect(typeof body.latestId).toBe('number');
    expect(body.latestId).toBeGreaterThan(0);
  });

  test('snapshot returns 503 with a Korean message when the DB is unreachable', async () => {
    h.db = {
      query: async () => { throw new Error('connect ECONNREFUSED'); },
      batch: async () => { throw new Error('connect ECONNREFUSED'); },
    };
    const res = await getSnapshot();
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe('상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.');
  });

  test('cctvs come from the DB', async () => {
    await upsertCctvs(db, [{ id: 'c1', name: '서초', lon: 127, lat: 37, url: 'https://x/y.m3u8', fetchedAt: new Date().toISOString() }]);
    const res = await getCctvs();
    expect(res.status).toBe(200);
    expect((await res.json()).map((c: { id: string }) => c.id)).toEqual(['c1']);
  });

  test('cctvs return 503 when the DB is unreachable', async () => {
    h.db = { query: async () => { throw new Error('down'); }, batch: async () => {} };
    expect((await getCctvs()).status).toBe(503);
  });
});

describe('fixture replay without DATABASE_URL', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('ITS_MODE', '');
  });

  test('snapshot is built from the events fixture', async () => {
    const body = await (await getSnapshot()).json();
    expect(body.incidents.length).toBeGreaterThan(250);
    expect(body.latestId).toBe(0);
    expect(body.collectedAt).toBeNull();
    expect(body.delayMinutes).toBe(60);
  });

  test('cctvs are built from the CCTV fixture', async () => {
    const body = await (await getCctvs()).json();
    expect(body.length).toBeGreaterThan(100);
  });

  test('live mode without DATABASE_URL is a 503', async () => {
    vi.stubEnv('ITS_MODE', 'live');
    expect((await getSnapshot()).status).toBe(503);
  });
});
