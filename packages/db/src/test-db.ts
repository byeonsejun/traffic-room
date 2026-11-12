import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from './db.ts';

export const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const TABLES = 'incidents, event_log, collector_runs, cctvs';

// PGlite(WASM) 시작은 테스트를 여러 파일 동시에 돌리면 수 초씩 걸린다. 그래서 테스트 파일(모듈)마다
// 인스턴스 하나를 만들어 두고, 부를 때마다 모든 표를 비우고 id 를 1부터 다시 세게 해서 돌려준다.
// 호출하는 쪽에서는 늘 빈 새 DB 를 받는 것과 같다(이전에 받은 핸들은 같은 DB 를 가리키니 함께 쓰지 않는다).
let shared: Promise<PGlite> | null = null;

async function sharedPg(): Promise<PGlite> {
  shared ??= (async () => {
    const pg = new PGlite();
    await pg.exec(schemaSql);
    return pg;
  })();
  return shared;
}

export async function createTestDb(): Promise<Db> {
  const pg = await sharedPg();
  await pg.exec(`truncate ${TABLES} restart identity cascade`);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
    async batch(statements) {
      await pg.transaction(async (tx) => {
        for (const s of statements) await tx.query(s.text, s.params ?? []);
      });
    },
  };
}
