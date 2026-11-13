// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Db } from '@traffic-room/db';
import { fileURLToPath } from 'node:url';
import { loadHighways } from '@traffic-room/highways/read';
import { createItsClient } from '@traffic-room/its';
import { saveTrafficSnapshot } from '@traffic-room/db';
import { createTestDb } from '@traffic-room/db/test-db';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@traffic-room/db', async (orig) => ({
  ...(await orig<typeof import('@traffic-room/db')>()),
  createNeonDb: () => h.db,
}));

import { GET as get } from './route';

const GET = (query = '') => get(new Request(`http://localhost/api/traffic${query}`));

const summary = { avgSpeed: 80, ok: 2, slow: 0, jam: 0, jamKm: 0 };
const at = (min: number) => new Date(Date.now() + min * 60_000);
const snap = (dataAt: Date, showAt: Date, speeds: { linkId: string; speed: number }[]) => ({
  dataAt, collectedAt: dataAt, showAt, summary, routes: [{ route: '경부고속도로', avgSpeed: 80 }], speeds,
});
const MESSAGE = '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';

afterEach(() => vi.unstubAllEnvs());

describe('with DATABASE_URL', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    h.db = db;
    vi.stubEnv('DATABASE_URL', 'postgres://test');
  });

  test('returns { id: null } when nothing is due to be shown yet', async () => {
    await saveTrafficSnapshot(db, snap(at(-5), at(30), [{ linkId: 'L1', speed: 80 }]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=30');
    expect(await res.json()).toEqual({ id: null });
  });

  test('returns the shown snapshot with its speeds only', async () => {
    const dataAt = at(-120);
    const id = await saveTrafficSnapshot(db, snap(dataAt, at(-60), [
      { linkId: 'L2', speed: 55 }, { linkId: 'L1', speed: 90 },
    ]));
    await saveTrafficSnapshot(db, snap(at(-60), at(10), [{ linkId: 'L1', speed: 10 }]));
    const body = await (await GET()).json();
    expect(body).toEqual({ id, dataAt: dataAt.toISOString(), speeds: [['L1', 90], ['L2', 55]] });
  });

  test('?id= at or below the shown snapshot is served and cached', async () => {
    const id = await saveTrafficSnapshot(db, snap(at(-120), at(-60), [{ linkId: 'L1', speed: 90 }]));
    for (const q of [`?id=${id}`, `?id=${id - 1}`]) {
      const res = await GET(q);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=30');
      expect((await res.json()).id).toBe(id);
    }
  });

  test('?id= newer than the shown snapshot is a 503 no-store, so the old one is never cached under the new key', async () => {
    const id = await saveTrafficSnapshot(db, snap(at(-120), at(-60), [{ linkId: 'L1', speed: 90 }]));
    const res = await GET(`?id=${id + 1}`);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('?id= while nothing is shown yet is a 503 no-store', async () => {
    await saveTrafficSnapshot(db, snap(at(-5), at(30), [{ linkId: 'L1', speed: 80 }]));
    const res = await GET('?id=1');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
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

  test('speeds come from the traffic fixture filtered by highways.json', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(0);
    expect(body).not.toHaveProperty('nextShowAt');
    const fixture = await createItsClient({ mode: 'fixture' }).traffic();
    const highways = loadHighways(fileURLToPath(new URL('../../../../public/highways.json', import.meta.url)));
    const expected = fixture.items.filter((i) => highways.get(i.linkId));
    expect(body.dataAt).toBe(fixture.dataAt[0]);
    expect(expected.length).toBeGreaterThan(100);
    expect(body.speeds).toEqual(expected.map((i) => [i.linkId, i.speed]));
    expect(body.speeds[0]).toEqual([expect.any(String), expect.any(Number)]);
  });

  test('live mode without DATABASE_URL is a 503', async () => {
    vi.stubEnv('ITS_MODE', 'live');
    expect((await GET()).status).toBe(503);
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
      expect((await res.json()).message).toBe(MESSAGE);
    } finally {
      log.mockRestore();
    }
  });
});
