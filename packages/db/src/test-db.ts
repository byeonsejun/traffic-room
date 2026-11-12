import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from './db.ts';

export const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(schemaSql);
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
