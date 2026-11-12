import { expect, test } from 'vitest';
import { readConfig } from './config.ts';

const DB = 'postgres://user:hunter2@db.example/neondb';

test('reads port, mode and trimmed origins', () => {
  const r = readConfig({ DATABASE_URL: DB, PORT: '9000', ITS_MODE: 'live', ALLOWED_ORIGINS: ' https://a.example , https://b.example,' });
  expect(r).toEqual({
    ok: true,
    warnings: [],
    config: { databaseUrl: DB, port: 9000, mode: 'live', allowedOrigins: ['https://a.example', 'https://b.example'] },
  });
});

test('DATABASE_URL is required', () => {
  const r = readConfig({});
  expect(r.ok).toBe(false);
});

test('empty ALLOWED_ORIGINS is a clear warning in fixture mode', () => {
  const r = readConfig({ DATABASE_URL: DB });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.config.mode).toBe('fixture');
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toContain('ALLOWED_ORIGINS');
});

test('empty ALLOWED_ORIGINS stops the server in live mode', () => {
  const r = readConfig({ DATABASE_URL: DB, ITS_MODE: 'live', ALLOWED_ORIGINS: ' , ' });
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).toContain('ALLOWED_ORIGINS');
  expect(JSON.stringify(r)).not.toContain('hunter2');
});
