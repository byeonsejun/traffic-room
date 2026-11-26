import { readTiming } from '@traffic-room/shared';
import { buildLlmsTxt } from '@/lib/seo';

export function GET(): Response {
  const { delayMinutes, intervalMinutes } = readTiming(process.env);
  return new Response(buildLlmsTxt({ delayMinutes, intervalMinutes }), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
