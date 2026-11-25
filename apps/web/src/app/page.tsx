import { readTiming } from '@traffic-room/shared';
import { Console } from '@/components/Console';
import { JsonLd } from '@/components/JsonLd';
import { buildPageMetadata, buildWebApplicationJsonLd, homeDescription } from '@/lib/seo';

export const metadata = buildPageMetadata({
  description: homeDescription(readTiming(process.env).delayMinutes),
  path: '/',
});

export default function Home() {
  return (
    <>
      <JsonLd data={buildWebApplicationJsonLd(readTiming(process.env).delayMinutes)} />
      <Console />
    </>
  );
}
