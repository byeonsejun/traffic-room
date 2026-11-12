import { neon } from '@neondatabase/serverless';

export interface Statement {
  text: string;
  params?: unknown[];
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** 여러 문장을 한 트랜잭션으로 실행한다. 하나라도 실패하면 모두 되돌린다. */
  batch(statements: Statement[]): Promise<void>;
}

/**
 * Neon HTTP 드라이버는 대화형 트랜잭션을 지원하지 않으므로
 * 문장 목록을 한 번의 요청(`sql.transaction`)으로 보내 원자성을 얻는다.
 */
export function createNeonDb(url: string): Db {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
    async batch(statements) {
      if (statements.length === 0) return;
      await sql.transaction((txn) => statements.map((s) => txn.query(s.text, s.params ?? [])));
    },
  };
}
