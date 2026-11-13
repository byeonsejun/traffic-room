// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Db } from '@traffic-room/db';
import { saveTrafficSnapshot } from '@traffic-room/db';
import { createTestDb } from '@traffic-room/db/test-db';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@traffic-room/db', async (orig) => ({
  ...(await orig<typeof import('@traffic-room/db')>()),
  createNeonDb: () => h.db,
}));

import { GET } from './route';

const MESSAGE = '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';

afterEach(() => vi.unstubAllEnvs());

describe('with DATABASE_URL', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    h.db = db;
    vi.stubEnv('DATABASE_URL', 'postgres://test');
  });

  test('returns the 24 hour summaries plus timing with cache headers', async () => {
    const dataAt = new Date(Date.now() - 2 * 3_600_000);
    await saveTrafficSnapshot(db, {
      dataAt, collectedAt: dataAt, showAt: dataAt,
      summary: { avgSpeed: 72, ok: 3, slow: 1, jam: 0, jamKm: 0 },
      routes: [{ route: '경부고속도로', avgSpeed: 72 }],
      speeds: [{ linkId: 'L1', speed: 72 }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=30');
    const body = await res.json();
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0]).toMatchObject({ dataAt: dataAt.toISOString(), avgSpeed: 72 });
    expect(body.routes).toEqual([{ dataAt: dataAt.toISOString(), route: '경부고속도로', avgSpeed: 72 }]);
    expect(body.incidentsByHour).toBeInstanceOf(Array);
    expect(body.delayMinutes).toBe(60);
    expect(body.intervalMinutes).toBe(60);
  });

  test('snapshots newer than now − delay are not shown yet and stay out', async () => {
    const save = (dataAt: Date) => saveTrafficSnapshot(db, {
      dataAt, collectedAt: dataAt, showAt: new Date(dataAt.getTime() + 60 * 60_000),
      summary: { avgSpeed: 72, ok: 3, slow: 1, jam: 0, jamKm: 0 },
      routes: [{ route: '경부고속도로', avgSpeed: 72 }],
      speeds: [{ linkId: 'L1', speed: 72 }],
    });
    const shown = new Date(Date.now() - 90 * 60_000);
    await save(shown);
    await save(new Date(Date.now() - 20 * 60_000));
    const body = await (await GET()).json();
    expect(body.buckets.map((b: { dataAt: string }) => b.dataAt)).toEqual([shown.toISOString()]);
    expect(body.routes.map((r: { dataAt: string }) => r.dataAt)).toEqual([shown.toISOString()]);
  });

  test('timing follows the environment', async () => {
    vi.stubEnv('DELAY_MINUTES', '20');
    vi.stubEnv('COLLECT_INTERVAL_MINUTES', '30');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ delayMinutes: 20, intervalMinutes: 30, buckets: [] });
  });

  test('returns 503 no-store when the DB is unreachable', async () => {
    h.db = { query: async () => { throw new Error('connect ECONNREFUSED'); }, batch: async () => {} };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).message).toBe(MESSAGE);
    } finally {
      log.mockRestore();
    }
  });
});

describe('fixture replay without DATABASE_URL', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('ITS_MODE', '');
  });

  test('is empty history plus timing, never invented', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      buckets: [], routes: [], incidentsByHour: [], delayMinutes: 60, intervalMinutes: 60,
    });
  });

  test('live mode without DATABASE_URL is a 503', async () => {
    vi.stubEnv('ITS_MODE', 'live');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await GET()).status).toBe(503);
    } finally {
      log.mockRestore();
    }
  });
});

describe('production without DATABASE_URL', () => {
  test('is 503 no-store instead of the fixture', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('ITS_MODE', '');
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      log.mockRestore();
    }
  });
});
