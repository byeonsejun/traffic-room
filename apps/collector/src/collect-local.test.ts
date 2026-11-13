import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// launchd 가 부르는 scripts/collect-local.sh 를 가짜 pnpm 으로 실제로 돌려 로그에 무엇이 남는지 본다.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/collect-local.sh');
const SECRET_URL = 'postgres://user:s3cret@db.example/neondb?sslmode=require&x=1';
const SECRET_KEY = 'its-key-1234567890';

let home: string;
let bin: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'collect-local-'));
  bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(home, '.its-api.env'), `ITS_API_KEY=${SECRET_KEY}\n`);
  writeFileSync(join(home, 'db.env'), `DATABASE_URL=${SECRET_URL}\n`);
  // 가짜 pnpm: `pnpm --filter @traffic-room/collector <job>` 의 job 을 보고, FAKE_FAIL 과 같으면 실제 실패처럼 찍고 1 로 끝낸다.
  writeFileSync(join(bin, 'pnpm'), `#!/usr/bin/env bash
job="\${3:-}"
if [ "$job" = "\${FAKE_CRASH:-}" ]; then
  echo "file:///app/src/env.ts:12" >&2
  echo "    throw new Error('DATABASE_URL is not a postgres url');" >&2
  echo "Error: DATABASE_URL is not a postgres url" >&2
  echo "    at file:///app/src/env.ts:12:11" >&2
  echo "" >&2
  echo "Node.js v24.15.0" >&2
  echo " ELIFECYCLE  Command failed with exit code 1."
  exit 1
fi
if [ "$job" = "\${FAKE_FAIL:-}" ]; then
  echo "> @traffic-room/collector@0.0.0 $job"
  echo "connecting with $DATABASE_URL key=$ITS_API_KEY" >&2
  echo "$job failed code=22P02" >&2
  echo "    at Object.<anonymous> (run-$job.ts:52)" >&2
  echo " ELIFECYCLE  Command failed with exit code 1."
  exit 1
fi
echo "$job ok fake=1"
`);
  chmodSync(join(bin, 'pnpm'), 0o755);
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(fail = '', crash = '') {
  try {
    execFileSync('bash', [SCRIPT, '--force'], {
      env: {
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        TRAFFIC_ROOM_DB_ENV: join(home, 'db.env'),
        TRAFFIC_ROOM_STATE_DIR: join(home, 'state'),
        FAKE_FAIL: fail,
        FAKE_CRASH: crash,
      },
      stdio: 'pipe',
    });
  } catch {
    // 실패한 작업이 있으면 스크립트는 1 로 끝난다.
  }
  const log = join(home, 'Library/Logs/traffic-room-collector.log');
  const failLog = join(home, 'Library/Logs/traffic-room-collector-fail.log');
  return {
    log: existsSync(log) ? readFileSync(log, 'utf8') : '',
    failLog: existsSync(failLog) && statSync(failLog).isFile() ? readFileSync(failLog, 'utf8') : '',
  };
}

test('a successful job keeps the one-line summary', () => {
  const { log, failLog } = run();
  expect(log).toMatch(/OK events: events ok fake=1/);
  expect(log).toMatch(/OK traffic: traffic ok fake=1/);
  expect(failLog).toBe('');
});

test("a failed job logs the collector's own reason, not pnpm's closing line", () => {
  const { log } = run('traffic');
  const line = log.split('\n').find((l) => l.includes('FAIL traffic'))!;
  expect(line).toContain('traffic failed code=22P02');
  expect(line).not.toContain('ELIFECYCLE');
  expect(log).toMatch(/OK events: events ok fake=1/);
});

test('the full output of a failed job is kept in a separate log, with secrets masked', () => {
  const { failLog } = run('traffic');
  expect(failLog).toContain('FAIL traffic');
  expect(failLog).toContain('at Object.<anonymous> (run-traffic.ts:52)');
  expect(failLog).toContain('ELIFECYCLE');
  expect(failLog).not.toContain('s3cret');
  expect(failLog).not.toContain(SECRET_KEY);
  expect(failLog).toContain('postgres://***');
});

test('a crash without the collector\'s own line logs the Error line, not "Node.js v24"', () => {
  const { log } = run('', 'events');
  const line = log.split('\n').find((l) => l.includes('FAIL events'))!;
  expect(line).toContain('Error: DATABASE_URL is not a postgres url');
});

test('if the failure log cannot be written, the other jobs still run', () => {
  mkdirSync(join(home, 'Library/Logs/traffic-room-collector-fail.log'), { recursive: true });
  const { log } = run('events');
  expect(log).toMatch(/FAIL events/);
  expect(log).toMatch(/OK traffic: traffic ok fake=1/);
});

test('trimming the failure log keeps whole records (it starts at a header)', () => {
  const logs = join(home, 'Library/Logs');
  mkdirSync(logs, { recursive: true });
  const old = Array.from({ length: 700 }, (_, i) => `=== 2026-11-01 00:00:00 FAIL events\nline a ${i}\nline b ${i}`).join('\n');
  writeFileSync(join(logs, 'traffic-room-collector-fail.log'), old + '\n');
  const { failLog } = run('traffic');
  expect(failLog.split('\n')[0]).toMatch(/^=== /);
  expect(failLog.split('\n').length).toBeLessThanOrEqual(2001);
  expect(failLog).toContain('FAIL traffic');
});
