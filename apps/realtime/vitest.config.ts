import { defineConfig } from 'vitest/config';

// PGlite(WASM) 를 쓰는 테스트가 있다. 전체를 병렬로 돌리면 첫 시작이 기본 5초를 넘길 수 있어 넉넉히 둔다.
export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 30_000 },
});
