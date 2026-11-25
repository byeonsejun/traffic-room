import { readTiming } from '@traffic-room/shared';
import { Console } from '@/components/Console';
import { JsonLd } from '@/components/JsonLd';
import { buildPageMetadata, buildWebApplicationJsonLd, homeDescription } from '@/lib/seo';

// 빌드 때 한 번 읽는다. 메타 · 구조화 데이터 · 처음 내려가는 화면이 같은 값을 쓴다.
const timing = readTiming(process.env);

export const metadata = buildPageMetadata({
  description: homeDescription(timing.delayMinutes),
  path: '/',
});

export default function Home() {
  return (
    <>
      <JsonLd data={buildWebApplicationJsonLd(timing.delayMinutes)} />
      <Console initialTiming={{ delayMinutes: timing.delayMinutes, intervalMinutes: timing.intervalMinutes }} />
    </>
  );
}
