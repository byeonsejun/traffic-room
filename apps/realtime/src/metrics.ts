import type { TrafficSnapshotRow } from '@traffic-room/db';
import { categorySchema, type Category, type LogEvent, type Metrics, type Timing } from '@traffic-room/shared';

export interface MetricsLoad {
  shown: TrafficSnapshotRow | null;
  upcoming: TrafficSnapshotRow[];
  incidents: Metrics['incidents'];
}

export interface MetricsDeps {
  load: () => Promise<MetricsLoad>;
  now: () => Date;
  timing: Timing;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface MetricsState {
  current(): Metrics;
  reload(): Promise<void>;
  onEvent(e: LogEvent): void;
  subscribe(fn: (m: Metrics) => void): () => void;
  stop(): void;
}

/** 카테고리 순서를 늘 같게 둬서 JSON 비교가 키 순서에 흔들리지 않게 한다. */
function countsFrom(src?: Partial<Record<Category, number>>): Record<Category, number> {
  return Object.fromEntries(categorySchema.options.map((c) => [c, src?.[c] ?? 0])) as Record<Category, number>;
}

/**
 * 화면 전체가 함께 보는 지표 상태.
 *
 * DB 는 reload 때만 읽는다(30분 주기). 그 사이에는 미리 읽어 둔 다음 교통 스냅샷을 showAt 에 맞춰
 * 공개하고, 돌발 수는 스케줄러 송출(onEvent)로만 고친다. 값이 실제로 바뀔 때만 구독자에게 알린다.
 */
export function createMetricsState(deps: MetricsDeps): MetricsState {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const subs = new Set<(m: Metrics) => void>();

  let shown: TrafficSnapshotRow | null = null;
  /** 아직 공개 전인 스냅샷. showAt 오름차순. */
  let upcoming: TrafficSnapshotRow[] = [];
  let byCategory = countsFrom();
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** reload · stop 마다 바뀐다. 조회 중에 바뀌었으면 그 결과는 버린다. */
  let generation = 0;
  let stopped = false;

  function current(): Metrics {
    return {
      trafficSnapshotId: shown?.id ?? null,
      trafficDataAt: shown ? shown.dataAt.toISOString() : null,
      nextTrafficAt: upcoming[0] ? upcoming[0].showAt.toISOString() : null,
      traffic: shown ? { ...shown.summary } : null,
      incidents: { total, byCategory: { ...byCategory } },
      delayMinutes: deps.timing.delayMinutes,
      intervalMinutes: deps.timing.intervalMinutes,
    };
  }

  let lastJson = JSON.stringify(current());

  function notify() {
    const m = current();
    const json = JSON.stringify(m);
    if (json === lastJson) return;
    lastJson = json;
    for (const fn of subs) {
      try {
        fn(m);
      } catch {
        console.error('[metrics] 구독자 처리 중 오류');
      }
    }
  }

  /** showAt 이 지난 upcoming 을 차례로 공개하고, 남은 것 중 가장 이른 시각에 다시 깨어난다. */
  function publishDue() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (stopped) return;
    const nowMs = deps.now().getTime();
    while (upcoming[0] && upcoming[0].showAt.getTime() <= nowMs) shown = upcoming.shift() ?? shown;
    notify();
    const next = upcoming[0];
    if (next) timer = setTimer(publishDue, Math.max(0, next.showAt.getTime() - nowMs));
  }

  async function reload(): Promise<void> {
    const gen = ++generation;
    let data: MetricsLoad;
    try {
      data = await deps.load();
    } catch (err) {
      // 메시지에 접속 정보가 섞일 수 있어 이름만 남긴다.
      const name = err instanceof Error ? err.name : 'UnknownError';
      console.error(`[metrics] 지표 조회 실패(${name}), 다음 주기에 다시 시도`);
      return;
    }
    if (gen !== generation || stopped) return;

    // 조회하는 사이 showAt 이 지난 upcoming 은 publishDue 가 shown 으로 옮긴다. 그래서 타이머가
    // 이미 공개한 스냅샷도 다시 알림이 나가지 않는다(값이 같으면 notify 가 건너뜀).
    shown = data.shown;
    upcoming = [...data.upcoming]
      .filter((r) => !shown || r.showAt.getTime() > shown.showAt.getTime())
      .sort((a, b) => a.showAt.getTime() - b.showAt.getTime());
    byCategory = countsFrom(data.incidents.byCategory);
    total = data.incidents.total;
    publishDue();
  }

  function onEvent(e: LogEvent) {
    const c = e.incident.category;
    if (e.kind === 'arrived') {
      byCategory[c] += 1;
      total += 1;
    } else {
      // 해제가 도착보다 먼저 와도(재조회 직후 등) 음수로 내려가지 않게 한다.
      if (byCategory[c] === 0) return;
      byCategory[c] -= 1;
      total = Math.max(0, total - 1);
    }
    notify();
  }

  return {
    current,
    reload,
    onEvent,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    stop() {
      stopped = true;
      generation += 1;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      subs.clear();
    },
  };
}
