import { afterEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ loadHighways: vi.fn(() => ({ size: 0, get: () => undefined })) }));
vi.mock('@traffic-room/highways', () => ({ loadHighways: h.loadHighways }));

import { depsFromEnv, highwaysFromRepo } from './env.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  h.loadHighways.mockClear();
});

test('돌발 · CCTV 가 쓰는 depsFromEnv 는 도로 모양 파일을 읽지 않는다', () => {
  // neon() 은 첫 쿼리 때 연결하므로 여기서 네트워크를 쓰지 않는다.
  vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/db');
  const deps = depsFromEnv();
  expect(h.loadHighways).not.toHaveBeenCalled();
  expect(deps).not.toHaveProperty('highways');
});

test('교통 작업만 highwaysFromRepo 로 web/public/highways.json 을 읽는다', () => {
  highwaysFromRepo();
  expect(h.loadHighways).toHaveBeenCalledTimes(1);
  expect(String(h.loadHighways.mock.calls[0])).toMatch(/apps\/web\/public\/highways\.json$/);
});
