// maplibre-gl 6 은 ESM 전용이고, 워커 주소를 자기 모듈의 import.meta.url 옆에서 찾는다.
// Next(Turbopack · webpack)가 번들하면 그 자리에 워커 파일이 없어 "Worker failed to load"가 난다.
// 그래서 워커 번들을 public/ 으로 복사해 두고 MapView 에서 setWorkerUrl 로 이 주소를 알려 준다.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'maplibre-gl-worker.mjs');

mkdirSync(dirname(out), { recursive: true });
copyFileSync(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), out);
console.log('maplibre worker → public/maplibre-gl-worker.mjs');
