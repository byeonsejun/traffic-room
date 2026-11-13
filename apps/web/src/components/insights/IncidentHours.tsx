'use client';

import { useMemo } from 'react';
import { incidentHours, incidentHoursOption, type IncidentHour } from '@/lib/insights';
import { hhmm } from '@/lib/time';
import { CATEGORY_LABEL } from '@/lib/tokens';
import type { Category } from '@traffic-room/shared';
import { EChart } from '../charts/EChart';
import { Card, type LoadStatus } from './Card';

const HEIGHT = 240;

/** 최근 24시간 돌발 발생을 1시간 칸으로 센 막대. 막대에 올리면 그 시간의 유형별 수가 보인다. */
export function IncidentHours({ incidentsByHour, loadedAt, status }: {
  incidentsByHour: IncidentHour[];
  loadedAt: number;
  status: LoadStatus;
}) {
  const hours = useMemo(() => incidentHours(incidentsByHour, new Date(loadedAt)), [incidentsByHour, loadedAt]);
  const option = useMemo(() => incidentHoursOption(incidentsByHour, new Date(loadedAt)), [incidentsByHour, loadedAt]);
  const table = useMemo(() => ({
    columns: ['시각', '전체', '유형'],
    rows: hours.map((h) => [
      `${hhmm(h.hour)}부터`, h.total,
      h.byCategory
        ? (Object.entries(h.byCategory) as [Category, number][]).filter(([, n]) => n > 0)
          .map(([c, n]) => `${CATEGORY_LABEL[c]} ${n}`).join(' · ') || '—'
        : '—',
    ]),
  }), [hours]);
  const total = hours.reduce((s, h) => s + h.total, 0);

  return (
    <Card
      id="ins-hours" title="시간대별 돌발 발생" className="ins-hours" status={status} empty={false} height={HEIGHT}
      note={<>새로 생긴 상황 {total.toLocaleString('ko-KR')}건 · 1시간 단위</>}
    >
      <EChart option={option} height={HEIGHT} ariaLabel="최근 24시간 시간대별 돌발 발생" table={table} />
    </Card>
  );
}
