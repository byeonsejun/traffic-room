'use client';

import { delayLabel } from '@traffic-room/shared';
import { HISTORY_HOURS, historyHours } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { useMetrics } from '@/store/metrics';
import { TopBar } from '../TopBar';
import { useInsights, type InsightsState } from '../useInsights';
import { useMetricsStream } from '../useMetricsStream';
import { IncidentHours } from './IncidentHours';
import { KpiTiles } from './KpiTiles';
import { LevelArea } from './LevelArea';
import { RouteHeatmap } from './RouteHeatmap';
import { SlowRoutes } from './SlowRoutes';

/**
 * 분석 화면. 24시간 기록은 /api/insights 로 받고, SSE 지표가 가리키는 교통 스냅샷이 바뀌면 다시 받는다.
 * 지금 값 타일은 SSE 지표를 바로 따른다.
 */
export function Insights() {
  const stream = useMetricsStream();
  const metrics = useMetrics((s) => s.metrics);
  const insights = useInsights(metrics?.trafficSnapshotId ?? null);
  const { buckets, routes, incidentsByHour, intervalMinutes, loadedAt } = insights.data;
  const delayMinutes = metrics?.delayMinutes ?? 60;
  const dataAt = metrics?.trafficDataAt ?? buckets.at(-1)?.dataAt ?? null;
  const timing = metrics ? { delayMinutes: metrics.delayMinutes, intervalMinutes: metrics.intervalMinutes } : undefined;

  return (
    <div className="insights">
      <TopBar
        status={stream === 'open' ? 'open' : 'connecting'} live={stream !== 'off'}
        delayMinutes={delayMinutes} trafficDataAt={dataAt} trafficTiming={timing} page="insights"
      />
      <main className="ins">
        <header className="ins-head">
          <h2>최근 24시간 고속도로</h2>
          <p>
            {dataAt ? <>교통 {hhmm(dataAt)} 기준 · </> : null}
            {intervalMinutes === 60 ? '1시간' : `${intervalMinutes}분`}마다 수집 · {delayLabel(delayMinutes)}
          </p>
        </header>
        <HistoryBand insights={insights} />
        <KpiTiles metrics={metrics} buckets={buckets} intervalMinutes={intervalMinutes} />
        <div className="ins-grid">
          <RouteHeatmap routes={routes} status={insights.status} />
          <SlowRoutes routes={routes} status={insights.status} />
          <LevelArea buckets={buckets} status={insights.status} />
          <IncidentHours incidentsByHour={incidentsByHour} loadedAt={loadedAt} status={insights.status} />
        </div>
      </main>
    </div>
  );
}

/** 기록이 24시간에 못 미치면 위에 띠를 둔다. 받는 중에는 비워 두고, 실패는 0시간이 아니라 실패로 말한다. */
function HistoryBand({ insights }: { insights: InsightsState }) {
  if (insights.status === 'loading') return null;
  if (insights.status === 'error') {
    return <p className="ins-band is-error" role="status">기록을 불러오지 못했어요</p>;
  }
  const hours = historyHours(insights.data.buckets, insights.data.intervalMinutes);
  if (hours >= HISTORY_HOURS) return null;
  return (
    <div className="ins-band" role="status">
      <span className="meter" aria-hidden="true"><span style={{ width: `${(hours / HISTORY_HOURS) * 100}%` }} /></span>
      <p><strong>기록 중 · {hours}/{HISTORY_HOURS}시간</strong> — 배포 뒤 쌓이는 중이에요</p>
    </div>
  );
}
