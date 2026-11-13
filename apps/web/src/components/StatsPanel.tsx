'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { delayLabel, type Category } from '@traffic-room/shared';
import { CATEGORY_LABEL, categoryColor } from '@/lib/tokens';
import { hhmm } from '@/lib/time';
import { useConsole } from '@/store/console';
import { useMetrics } from '@/store/metrics';
import { LevelBar } from './charts/LevelBar';
import { SpeedTrend } from './charts/SpeedTrend';
import { HISTORY_HOURS, historyHours } from '@/lib/insights';
import type { InsightsState } from './useInsights';

const BUMP_MS = 1200;
const ORDER = Object.keys(CATEGORY_LABEL) as Category[];

export function StatsPanel({ arrivalId, collectedAt, delayMinutes, insights }: {
  arrivalId?: number;
  collectedAt: string | null;
  delayMinutes: number;
  insights: InsightsState;
}) {
  const { buckets } = insights.data;
  const incidents = useConsole((s) => s.incidents);
  const list = useMemo(() => Object.values(incidents), [incidents]);
  // 지금 값은 SSE 지표가 먼저, 없으면 마지막 요약 기록. 둘 다 없으면 숫자를 지어내지 않는다.
  const live = useMetrics((s) => s.metrics?.traffic ?? null);
  const traffic = live ?? buckets.at(-1) ?? null;

  const rows = useMemo(() => {
    const n = Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<Category, number>;
    for (const i of list) n[i.category] += 1;
    return ORDER.map((c) => ({ c, n: n[c] })).sort((a, b) => b.n - a.n);
  }, [list]);
  const max = Math.max(1, ...rows.map((r) => r.n));

  // 새 상황이 도착하면 숫자가 잠깐 붉어진다.
  // 강조는 새 도착 id 로 켜고 타이머로만 끈다. 도착 직후 해제가 feed[0] 이 되어 arrivalId 가
  // undefined 로 바뀌어도 1.2초 뒤에는 반드시 원래 색으로 돌아온다.
  // 바뀐 prop 을 렌더 중에 반영하는 React 권장 방식이라 effect 안에서 setState 하지 않는다.
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const [bumpFor, setBumpFor] = useState<number | null>(null);
  if (arrivalId !== seen) {
    setSeen(arrivalId);
    if (arrivalId !== undefined) setBumpFor(arrivalId);
  }
  useEffect(() => {
    if (bumpFor === null) return;
    const t = setTimeout(() => setBumpFor(null), BUMP_MS);
    return () => clearTimeout(t);
  }, [bumpFor]);
  const bump = bumpFor !== null;

  return (
    <>
      <section className="speed" aria-labelledby="speed-title">
        <h2 id="speed-title">고속도로 평균 속도</h2>
        {traffic ? (
          <p className="hero">{Math.round(traffic.avgSpeed)}<small>km/h</small></p>
        ) : (
          <p className="pending">교통 정보 준비 중</p>
        )}
        {buckets.length > 1 && <SpeedTrend buckets={buckets} />}
        <HistoryNote insights={insights} />
      </section>
      {traffic && (
        <section className="levels" aria-labelledby="levels-title">
          <h2 id="levels-title">
            구간 상태<span>본선 {(traffic.ok + traffic.slow + traffic.jam).toLocaleString('ko-KR')}구간</span>
          </h2>
          <LevelBar counts={traffic} />
        </section>
      )}
      <section className="kpi" aria-labelledby="kpi-title">
        <h2 id="kpi-title">진행 중인 돌발상황</h2>
        <p className={`count${bump ? ' is-bump' : ''}`} aria-live="polite">
          {list.length}
          <small>건</small>
        </p>
      </section>
      <section className="types" aria-labelledby="types-title">
        <h2 id="types-title">유형별</h2>
        <ul>
          {rows.map(({ c, n }) => (
            <li key={c} className={`trow${n === 0 ? ' is-zero' : ''}`}>
              <span className="name">{CATEGORY_LABEL[c]}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${n ? Math.max(2, (n / max) * 100) : 0}%`, background: categoryColor(c) }} />
              </span>
              <span className="n">{n}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link className="to-insights" href="/insights">분석 보기 <span aria-hidden="true">→</span></Link>
      <p className="about">
        공공 교통 정보를 {delayLabel(delayMinutes)}으로, 일어난 순서대로 다시 보여 줘요.
        {collectedAt && <> 마지막 수집은 {hhmm(collectedAt)}이에요.</>}
      </p>
    </>
  );
}

/**
 * 기록이 24시간에 못 미치면 차 오르는 중임을 알린다. 받는 중에는 아무것도 보이지 않고,
 * 처음 받기부터 실패했으면 0시간으로 읽히지 않게 실패를 그대로 말한다.
 */
function HistoryNote({ insights }: { insights: InsightsState }) {
  if (insights.status === 'loading') return null;
  if (insights.status === 'error') return <p className="recording is-error">기록을 불러오지 못했어요</p>;
  const hours = historyHours(insights.data.buckets, insights.data.intervalMinutes);
  if (hours >= HISTORY_HOURS) return null;
  return <p className="recording">기록 중 · {hours}/{HISTORY_HOURS}시간</p>;
}
