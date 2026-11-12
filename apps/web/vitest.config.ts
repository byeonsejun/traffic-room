import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // api 라우트 테스트가 PGlite(WASM) 를 쓴다. 전체 병렬 실행에서 첫 시작이 5초를 넘길 수 있어 넉넉히 둔다.
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
