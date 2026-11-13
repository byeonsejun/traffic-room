import type { Metadata } from 'next';
import { Insights } from '@/components/insights/Insights';

export const metadata: Metadata = {
  title: '분석 · 전국 도로 상황실',
  description: '최근 24시간 고속도로 노선별 속도 · 구간 상태 · 돌발 발생 분석',
};

export default function InsightsPage() {
  return <Insights />;
}
