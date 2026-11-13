import { z } from 'zod';
import { categorySchema } from './messages.ts';
import type { Category } from './incident.ts';

export type SpeedLevel = 'ok' | 'slow' | 'jam';

// 원활 70 이상, 서행 40 이상 70 미만, 정체 40 미만 (km/h)
export function speedLevel(kmh: number): SpeedLevel {
  if (kmh >= 70) return 'ok';
  if (kmh >= 40) return 'slow';
  return 'jam';
}

export type TrafficSummary = { avgSpeed: number; ok: number; slow: number; jam: number; jamKm: number };

const trafficSummarySchema = z.object({
  avgSpeed: z.number(),
  ok: z.number().int().nonnegative(),
  slow: z.number().int().nonnegative(),
  jam: z.number().int().nonnegative(),
  jamKm: z.number().nonnegative(),
});

const byCategorySchema = z.object(
  Object.fromEntries(categorySchema.options.map((c) => [c, z.number().int().nonnegative()])) as Record<
    Category,
    z.ZodNumber
  >,
);

export const metricsSchema = z.object({
  trafficSnapshotId: z.number().int().nullable(),
  trafficDataAt: z.string().nullable(),
  nextTrafficAt: z.string().nullable(),
  traffic: trafficSummarySchema.nullable(),
  incidents: z.object({ total: z.number().int().nonnegative(), byCategory: byCategorySchema }),
  delayMinutes: z.number(),
  intervalMinutes: z.number(),
  /** 마지막으로 성공한 수집 시각(ISO). 수집 기록이 없으면 null. */
  // 옛 realtime 서버는 이 필드를 보내지 않는다. 배포 순서와 상관없이 파싱되도록 기본값을 null 로 둔다.
  collectedAt: z.string().nullable().default(null),
});

export type Metrics = z.infer<typeof metricsSchema>;
