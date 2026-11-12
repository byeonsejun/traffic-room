import { readFileSync } from 'node:fs';
import { createNeonDb } from './db.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}

// schema.sql 에는 문자열 리터럴 안의 세미콜론이 없으므로 단순 분할로 충분하다.
const statements = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((text) => ({ text }));

try {
  await createNeonDb(url).batch(statements);
  console.log(`스키마 적용 완료 (${statements.length}문장)`);
} catch (e) {
  // 접속 문자열이 메시지에 섞일 수 있어 원문은 찍지 않는다.
  console.error('스키마 적용 실패:', e instanceof Error ? e.name : 'unknown');
  process.exit(1);
}
