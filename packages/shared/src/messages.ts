import { z } from 'zod';
import type { Incident } from './incident';

export const DELAY_MINUTES = 60;

export const categorySchema = z.enum(['accident', 'breakdown', 'weather', 'construction', 'report', 'other']);

export const incidentSchema = z.object({
  key: z.string(),
  category: categorySchema,
  roadName: z.string(),
  direction: z.string(),
  detail: z.string(),
  message: z.string(),
  lanesBlocked: z.string(),
  lon: z.number(),
  lat: z.number(),
  startedAt: z.string().nullable(),
});

// 봉투: id 0 은 재전송 대상이 아니다.
const envelope = { id: z.number().int().nonnegative(), ts: z.string() };

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...envelope,
    type: z.literal('hello'),
    payload: z.object({ delayMinutes: z.number(), latestId: z.number().int().nonnegative() }),
  }),
  z.object({ ...envelope, type: z.literal('incident.arrived'), payload: z.object({ incident: incidentSchema }) }),
  z.object({ ...envelope, type: z.literal('incident.cleared'), payload: z.object({ key: z.string() }) }),
  z.object({
    ...envelope,
    type: z.literal('cctv.url'),
    payload: z.object({
      cctvId: z.string(),
      url: z.string().nullable(),
      reason: z.enum(['cached', 'refreshed', 'unavailable']),
    }),
  }),
  z.object({ ...envelope, type: z.literal('pong'), payload: z.object({}) }),
]);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('resume'), lastId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('cctv.request'), cctvId: z.string(), refresh: z.boolean() }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const r = serverMessageSchema.safeParse(parseJson(raw));
  return r.success ? r.data : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  const r = clientMessageSchema.safeParse(parseJson(raw));
  return r.success ? r.data : null;
}

// Incident 인터페이스와 zod 스키마가 어긋나면 컴파일 단계에서 막는다.
incidentSchema satisfies z.ZodType<Incident>;
