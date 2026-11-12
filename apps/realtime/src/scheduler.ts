import type { LogEvent } from '@traffic-room/shared';

export interface SchedulerOptions {
  loadWindow: (from: Date, to: Date) => Promise<LogEvent[]>;
  emit: (e: LogEvent) => void;
  now: () => Date;
  windowMinutes: number;
  reloadMinutes: number;
}

const MINUTE = 60_000;
/** 재조회 간격이 조금 밀려도 빈틈이 생기지 않게 조회 시작점을 이만큼 더 당긴다. */
const SLACK_MS = 5 * MINUTE;

/**
 * 송출 로그를 주기적으로 읽어 emitAt 에 맞춰 내보낸다.
 *
 * 수집기는 송출 시각이 바로 코앞인 행도 넣는다. 그래서 매 조회는 "지금"이 아니라 지난번 조회
 * 시점(첫 조회는 재조회 간격만큼 앞)부터 읽고, 이미 시각이 지났는데 아직 안 나간 것은 그 자리에서
 * id 순으로 내보낸다. 늦게 나간 이벤트는 ts 가 과거라 화면에서 새 도착 연출을 하지 않는다.
 */
export function createScheduler(opts: SchedulerOptions): { start(): Promise<void>; stop(): void } {
  const pending = new Map<number, LogEvent>();
  const fired = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reloadTimer: ReturnType<typeof setInterval> | undefined;
  /** start · stop 마다 바뀐다. 조회 중에 바뀌었으면 그 결과는 버린다. */
  let generation = 0;
  let running = false;
  /** 마지막으로 성공한 조회의 시각. 다음 조회는 여기서(여유를 빼고) 시작한다. */
  let lastLoadedAt: number | null = null;

  const at = (e: LogEvent) => Date.parse(e.emitAt);

  function emitOne(e: LogEvent) {
    pending.delete(e.id);
    fired.add(e.id);
    try {
      opts.emit(e);
    } catch {
      console.error('[scheduler] emit 중 오류');
    }
  }

  /** 시각이 된 것을 id 순으로 내보내고, 남은 것 중 가장 이른 시각에 다시 깨어난다. */
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!running) return;
    const nowMs = opts.now().getTime();
    const due = [...pending.values()].filter((e) => at(e) <= nowMs).sort((a, b) => a.id - b.id);
    for (const e of due) emitOne(e);
    let next = Infinity;
    for (const e of pending.values()) next = Math.min(next, at(e));
    if (next !== Infinity) timer = setTimeout(flush, Math.max(0, next - nowMs));
  }

  async function reload(): Promise<void> {
    const gen = generation;
    const nowMs = opts.now().getTime();
    const from = (lastLoadedAt ?? nowMs - opts.reloadMinutes * MINUTE) - SLACK_MS;
    const to = nowMs + opts.windowMinutes * MINUTE;
    let events: LogEvent[];
    try {
      events = await opts.loadWindow(new Date(from), new Date(to));
    } catch (err) {
      // 메시지에 비밀이 섞이지 않도록 에러 이름만 남긴다.
      const name = err instanceof Error ? err.name : 'UnknownError';
      console.error(`[scheduler] 이벤트 조회 실패(${name}), 다음 주기에 다시 시도`);
      return;
    }
    if (gen !== generation || !running) return;
    lastLoadedAt = nowMs;

    // 이번 범위 밖으로 밀려난 id 는 다시 읽힐 일이 없으므로 기억에서 지운다.
    const inWindow = new Set(events.map((e) => e.id));
    for (const id of fired) if (!inWindow.has(id)) fired.delete(id);

    for (const e of events) {
      if (fired.has(e.id) || pending.has(e.id) || Number.isNaN(at(e))) continue;
      pending.set(e.id, e);
    }
    flush();
  }

  const reloadSafely = () =>
    reload().catch(() => {
      console.error('[scheduler] 재조회 처리 중 오류');
    });

  function stop() {
    generation += 1;
    running = false;
    clearInterval(reloadTimer);
    reloadTimer = undefined;
    clearTimeout(timer);
    timer = undefined;
    pending.clear();
  }

  return {
    async start() {
      stop(); // 두 번 불러도 재조회 타이머가 하나만 남게 한다.
      running = true;
      const gen = generation;
      await reloadSafely();
      if (gen !== generation) return;
      reloadTimer = setInterval(() => void reloadSafely(), opts.reloadMinutes * MINUTE);
    },
    stop,
  };
}
