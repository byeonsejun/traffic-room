import { Insights } from '@/components/insights/Insights';
import { buildPageMetadata, INSIGHTS_DESCRIPTION } from '@/lib/seo';

export const metadata = buildPageMetadata({ title: '분석', description: INSIGHTS_DESCRIPTION, path: '/insights' });

export default function InsightsPage() {
  return <Insights />;
}
