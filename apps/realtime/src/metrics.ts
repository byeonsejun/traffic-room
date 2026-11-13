import type { TrafficSnapshotRow } from '@traffic-room/db';
import { categorySchema, type Category, type LogEvent, type Metrics, type Timing } from '@traffic-room/shared';

export interface MetricsLoad {
  shown: TrafficSnapshotRow | null;
  upcoming: TrafficSnapshotRow[];
  incidents: Metrics['incidents'];
  /** 마지막으로 성공한 수집 시각. 기록이 없으면 null. */
  collectedAt?: Date | null;
}

export interface MetricsDeps {
  /** `at` 기준으로 공개 중 · 아직 공개 전인 교통 스냅샷 전부와 진행 중 돌발 수를 읽는다. */
  load: (at: Date) => Promise<MetricsLoad>;
  now: () => Date;
  timing: Timing;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface MetricsState {
  current(): Metrics;
  /** 첫 조회가 성공했는지. 그 전에는 지어낸 값(빈 0)을 내보내지 않는다. */
  ready(): boolean;
  /** 첫 조회를 하고, 그 뒤 min(30분, 수집 간격)마다 다시 읽는다. */
  start(): Promise<void>;
  reload(): Promise<void>;
  onEvent(e: LogEvent): void;
  subscribe(fn: (m: Metrics) => void): () => void;
  stop(): void;
}

/** 카테고리 순서를 늘 같게 둬서 JSON 비교가 키 순서에 흔들리지 않게 한다. */
function countsFrom(src?: Partial<Record<Category, number>>): Record<Category, number> {
  return Object.fromEntries(categorySchema.options.map((c) => [c, src?.[c] ?? 0])) as Record<Category, number>;
}

/** 첫 조회가 실패하면 30초, 60초, … 로 늘려 다시 시도하고 평소 주기(30분)를 넘기지 않는다. */
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;
/** 다시 읽는 주기의 상한(분). Neon 자동 일시정지를 지키려고 이보다 자주 읽지 않는다. */
const MAX_RELOAD_MINUTES = 30;

/**
 * 지표를 다시 읽는 주기(분). 수집 간격이 30분보다 짧으면(15 · 20분) 그 간격마다 읽어야, show_at 보다
 * 한 간격쯤 앞서 들어온 스냅샷을 공개 시각 전에 미리 알고 제때 내보낸다.
 */
export const metricsReloadMinutes = (timing: Timing) => Math.min(MAX_RELOAD_MINUTES, timing.intervalMinutes);

/**
 * 화면 전체가 함께 보는 지표 상태.
 *
 * DB 는 reload 때만 읽는다(min(30분, 수집 간격) 주기). 그 사이에는 미리 읽어 둔 다음 교통 스냅샷을 showAt 에 맞춰
 * 공개하고, 돌발 수는 스케줄러 송출(onEvent)로만 고친다. 마지막 조회 시각 이전에 송출된 것은 DB 값에 이미 들어 있어
 * 건너뛴다. 값이 실제로 바뀔 때만 구독자에게 알린다.
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
  let collectedAt: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** reload · stop 마다 바뀐다. 조회 중에 바뀌었으면 그 결과는 버린다. */
  let generation = 0;
  let stopped = false;
  let loaded = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = FIRST_RETRY_MS;
  let periodicTimer: ReturnType<typeof setTimeout> | undefined;
  /** 마지막으로 성공한 조회의 기준 시각. 이때까지 송출된 돌발은 DB 값(byCategory · total)에 들어 있다. */
  let lastLoadAtMs = -Infinity;
  /** 조회 중에 받은 송출. 결과를 덮어쓴 뒤 같은 규칙(조회 기준 시각보다 나중 것만)으로 다시 반영한다. */
  let inFlight: { at: number; events: LogEvent[] } | null = null;

  function current(): Metrics {
    return {
      trafficSnapshotId: shown?.id ?? null,
      trafficDataAt: shown ? shown.dataAt.toISOString() : null,
      nextTrafficAt: upcoming[0] ? upcoming[0].showAt.toISOString() : null,
      traffic: shown ? { ...shown.summary } : null,
      incidents: { total, byCategory: { ...byCategory } },
      delayMinutes: deps.timing.delayMinutes,
      intervalMinutes: deps.timing.intervalMinutes,
      collectedAt,
    };
  }

  let lastJson = JSON.stringify(current());

  /** force 는 첫 조회 성공 때: 값이 빈 상태와 같아도 "준비됨"을 알려야 한다. */
  function notify(force = false) {
    if (!loaded) return;
    const m = current();
    const json = JSON.stringify(m);
    if (json === lastJson && !force) return;
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
  function publishDue(force = false) {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (stopped) return;
    const nowMs = deps.now().getTime();
    while (upcoming[0] && upcoming[0].showAt.getTime() <= nowMs) shown = upcoming.shift() ?? shown;
    notify(force);
    const next = upcoming[0];
    if (next) timer = setTimer(publishDue, Math.max(0, next.showAt.getTime() - nowMs));
  }

  async function reload(): Promise<void> {
    if (stopped) return;
    const gen = ++generation;
    const at = deps.now();
    const buffer = { at: at.getTime(), events: [] as LogEvent[] };
    inFlight = buffer;
    let data: MetricsLoad;
    try {
      data = await deps.load(at);
    } catch (err) {
      if (inFlight === buffer) inFlight = null;
      // 메시지에 접속 정보가 섞일 수 있어 이름만 남긴다.
      const name = err instanceof Error ? err.name : 'UnknownError';
      console.error(`[metrics] 지표 조회 실패(${name}), 다시 시도`);
      if (gen === generation && !loaded && !stopped) scheduleRetry();
      return;
    }
    if (inFlight === buffer) inFlight = null;
    if (gen !== generation || stopped) return;
    if (retryTimer !== undefined) clearTimer(retryTimer);
    retryTimer = undefined;

    // 조회하는 사이 showAt 이 지난 upcoming 은 publishDue 가 shown 으로 옮긴다. 그래서 타이머가
    // 이미 공개한 스냅샷도 다시 알림이 나가지 않는다(값이 같으면 notify 가 건너뜀).
    shown = data.shown;
    upcoming = [...data.upcoming]
      .filter((r) => !shown || r.showAt.getTime() > shown.showAt.getTime())
      .sort((a, b) => a.showAt.getTime() - b.showAt.getTime());
    byCategory = countsFrom(data.incidents.byCategory);
    total = data.incidents.total;
    collectedAt = data.collectedAt ? data.collectedAt.toISOString() : null;
    lastLoadAtMs = buffer.at;
    // 조회 기준 시각 이후에 송출된 것은 DB 값에 아직 없으니 다시 더한다. 그 전 것은 이미 들어 있다.
    for (const e of buffer.events) if (isNew(e)) applyEvent(e);
    const first = !loaded;
    loaded = true;
    publishDue(first);
  }

  function scheduleRetry() {
    if (retryTimer !== undefined) clearTimer(retryTimer);
    const delay = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    retryTimer = setTimer(() => {
      retryTimer = undefined;
      void reload();
    }, delay);
  }

  /** 마지막 조회 뒤에 송출된 것인지. 아니면 DB 값에 이미 들어 있다. */
  const isNew = (e: LogEvent) => Date.parse(e.emitAt) > lastLoadAtMs;

  function onEvent(e: LogEvent) {
    inFlight?.events.push(e);
    if (isNew(e) && applyEvent(e)) notify();
  }

  function schedulePeriodic() {
    periodicTimer = setTimer(() => {
      if (stopped) return;
      schedulePeriodic();
      void reload();
    }, metricsReloadMinutes(deps.timing) * 60_000);
  }

  /** 돌발 수만 고친다. 바뀌었으면 true. */
  function applyEvent(e: LogEvent): boolean {
    const c = e.incident.category;
    if (e.kind === 'arrived') {
      byCategory[c] += 1;
      total += 1;
    } else {
      // 해제가 도착보다 먼저 와도(재조회 직후 등) 음수로 내려가지 않게 한다.
      if (byCategory[c] === 0) return false;
      byCategory[c] -= 1;
      total = Math.max(0, total - 1);
    }
    return true;
  }

  return {
    current,
    ready: () => loaded,
    async start() {
      if (stopped) return;
      if (periodicTimer !== undefined) clearTimer(periodicTimer);
      schedulePeriodic();
      await reload();
    },
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
      if (retryTimer !== undefined) clearTimer(retryTimer);
      retryTimer = undefined;
      if (periodicTimer !== undefined) clearTimer(periodicTimer);
      periodicTimer = undefined;
      inFlight = null;
      subs.clear();
    },
  };
}
