import type { MetadataRoute } from 'next';
import { buildRobots, isPreviewDeployment } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return buildRobots(isPreviewDeployment(process.env.VERCEL_ENV));
}
