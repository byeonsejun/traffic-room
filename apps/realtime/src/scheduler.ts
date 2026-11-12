import type { LogEvent } from '@traffic-room/shared';

export interface SchedulerOptions {
  loadWindow: (from: Date, to: Date) => Promise<LogEvent[]>;
  emit: (e: LogEvent) => void;
  now: () => Date;
  windowMinutes: number;
  reloadMinutes: number;
}

const MINUTE = 60_000;

export function createScheduler(opts: SchedulerOptions): { start(): Promise<void>; stop(): void } {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const fired = new Set<number>();
  let reloadTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function reload(): Promise<void> {
    const from = opts.now();
    const to = new Date(from.getTime() + opts.windowMinutes * MINUTE);
    let events: LogEvent[];
    try {
      events = await opts.loadWindow(from, to);
    } catch (err) {
      // 메시지에 비밀이 섞이지 않도록 에러 이름만 남긴다.
      const name = err instanceof Error ? err.name : 'UnknownError';
      console.error(`[scheduler] 이벤트 조회 실패(${name}), 다음 주기에 다시 시도`);
      return;
    }
    if (stopped) return;

    const nowMs = opts.now().getTime();
    const sorted = [...events].sort(
      (a, b) => Date.parse(a.emitAt) - Date.parse(b.emitAt) || a.id - b.id,
    );
    for (const e of sorted) {
      if (timers.has(e.id) || fired.has(e.id)) continue;
      const at = Date.parse(e.emitAt);
      if (at < nowMs) continue; // 이미 지난 이벤트는 재접속 resume 으로만 전달된다
      timers.set(
        e.id,
        setTimeout(() => {
          timers.delete(e.id);
          fired.add(e.id);
          try {
            opts.emit(e);
          } catch {
            console.error('[scheduler] emit 중 오류');
          }
        }, at - nowMs),
      );
    }
  }

  return {
    async start() {
      stopped = false;
      await reload();
      if (stopped) return;
      reloadTimer = setInterval(() => {
        void reload();
      }, opts.reloadMinutes * MINUTE);
    },
    stop() {
      stopped = true;
      if (reloadTimer) clearInterval(reloadTimer);
      reloadTimer = null;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
