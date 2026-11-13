import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildHighways } from './build.ts';

const [dir, source = ''] = process.argv.slice(2);
if (!dir) {
  console.error('사용법: pnpm highways:build <MOCT_LINK가 있는 폴더> [source 라벨]');
  process.exit(1);
}
const out = resolve(import.meta.dirname, '../../../apps/web/public/highways.json');
// 8m로는 gzip이 540KB라 12m로 올려 배포한다.
const tolerance = Number(process.env.HIGHWAYS_TOLERANCE_M ?? 12);
const file = buildHighways(resolve(dir), source, tolerance);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(file));
console.log(`링크 ${file.links.length}개, 노선 ${file.routes.length}개 -> ${out}`);
