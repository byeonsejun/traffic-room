import { readTiming } from '@traffic-room/shared';
import { Insights } from '@/components/insights/Insights';
import { buildPageMetadata, INSIGHTS_DESCRIPTION } from '@/lib/seo';

// 빌드 때 한 번 읽어 처음 내려가는 화면에 넘긴다.
const { delayMinutes, intervalMinutes } = readTiming(process.env);

export const metadata = buildPageMetadata({ title: '분석', description: INSIGHTS_DESCRIPTION, path: '/insights' });

export default function InsightsPage() {
  return <Insights initialTiming={{ delayMinutes, intervalMinutes }} />;
}
