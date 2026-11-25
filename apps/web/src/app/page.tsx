import { readTiming } from '@traffic-room/shared';
import { Console } from '@/components/Console';
import { buildPageMetadata, homeDescription } from '@/lib/seo';

export const metadata = buildPageMetadata({
  description: homeDescription(readTiming(process.env).delayMinutes),
  path: '/',
});

export default function Home() {
  return <Console />;
}
