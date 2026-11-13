'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import type { Metrics } from '@traffic-room/shared';
import { yesterdayDelta, type TrafficBucket } from '@/lib/insights';
import { hhmm } from '@/lib/time';

const subscribeSeconds = (onChange: () => void) => {
  const t = setInterval(onChange, 1000);
  return () => clearInterval(t);
};
const currentSecond = () => Math.floor(Date.now() / 1000);
// 서버 렌더와 첫 하이드레이션에서는 남은 시간을 비워 두어 어긋남이 없게 한다.
const noSecond = () => null;

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const two = (n: number) => String(n).padStart(2, '0');

/** 남은 초를 "18:30" · "1:02:03" 으로. */
export function countdown(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function Tile({ label, value, unit, sub, live }: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub: ReactNode;
  /** 매초 바뀌는 값은 스크린 리더가 매번 읽지 않게 한다. */
  live?: boolean;
}) {
  return (
    <div className="kpi-tile">
      <h3>{label}</h3>
      <p className="v" aria-live={live === false ? 'off' : 'polite'}>
        {value}{unit && <small>{unit}</small>}
      </p>
      <p className="d">{sub}</p>
    </div>
  );
}

const DASH = <span className="none" aria-label="없음">—</span>;

/**
 * 지금 값 네 개. SSE 지표가 먼저고, 아직 없으면 마지막 요약 기록으로 채운다. 둘 다 없으면 지어내지 않고 —.
 * "어제 같은 시각" 비교는 24시간 전 기록이 있을 때만 보인다.
 */
export function KpiTiles({ metrics, buckets, intervalMinutes }: {
  metrics: Metrics | null;
  buckets: TrafficBucket[];
  intervalMinutes: number;
}) {
  const traffic = metrics?.traffic ?? buckets.at(-1) ?? null;
  const dataAt = metrics?.trafficDataAt ?? buckets.at(-1)?.dataAt ?? null;
  const delta = dataAt ? yesterdayDelta(buckets, new Date(dataAt), intervalMinutes) : null;
  const total = traffic ? traffic.ok + traffic.slow + traffic.jam : 0;
  const incidents = metrics?.incidents ?? null;

  return (
    <section className="ins-kpis" aria-label="지금 지표">
      <Tile
        label="고속도로 평균 속도"
        value={traffic ? fmt(traffic.avgSpeed) : DASH}
        unit={traffic ? 'km/h' : undefined}
        sub={delta === 0 ? '어제 같은 시각과 같아요' : delta !== null ? (
          <>
            <span className={`delta ${delta > 0 ? 'is-up' : 'is-down'}`} aria-hidden="true" />
            어제 같은 시각보다 {delta > 0 ? '+' : '−'}{Math.abs(delta)} km/h
          </>
        ) : dataAt ? `교통 ${hhmm(dataAt)} 기준` : '교통 정보 준비 중'}
      />
      <Tile
        label="정체 구간 길이"
        value={traffic ? fmt(traffic.jamKm) : DASH}
        unit={traffic ? 'km' : undefined}
        sub={traffic ? `정체 ${fmt(traffic.jam)}구간 · 본선 ${fmt(total)}구간 중` : '교통 정보 준비 중'}
      />
      <Tile
        label="진행 중 돌발"
        value={incidents ? fmt(incidents.total) : DASH}
        unit={incidents ? '건' : undefined}
        sub={incidents
          ? `사고 ${incidents.byCategory.accident} · 고장 ${incidents.byCategory.breakdown}`
          : '실시간 지표를 기다리는 중'}
      />
      <NextUpdate metrics={metrics} />
    </section>
  );
}

/** 다음 교통 갱신까지 남은 시간. 1초마다 줄고, 예정 시각이 지나면 새 교통을 기다리는 중이라고 말한다. */
function NextUpdate({ metrics }: { metrics: Metrics | null }) {
  const sec = useSyncExternalStore(subscribeSeconds, currentSecond, noSecond);
  const label = '다음 교통 갱신까지';
  const next = metrics?.nextTrafficAt ?? null;
  if (!next) {
    return <Tile label={label} value={DASH} sub={metrics ? '다음 수집 시각이 아직 없어요' : '실시간 지표를 기다리는 중'} />;
  }
  const left = sec === null ? null : Math.ceil(new Date(next).getTime() / 1000) - sec;
  if (left !== null && left <= 0) {
    return <Tile label={label} value="곧" sub={`${hhmm(next)} 예정 · 새 교통을 기다리는 중`} />;
  }
  return (
    <Tile
      label={label} live={false}
      value={left === null ? DASH : <span className="tick">{countdown(left)}</span>}
      sub={`${hhmm(next)}에 새 교통이 와요`}
    />
  );
}
