import { z } from 'zod';
import type { Incident } from './incident.ts';

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

/**
 * 재접속 따라잡기(`/ws?lastId=`) 한 번에 서버가 돌려주는 최대 건수. 서버는 이만큼만 돌려주고,
 * 클라이언트는 이보다 많이 밀렸으면 따라잡기 대신 스냅샷부터 다시 받는다. 두 쪽이 같은 값을 봐야 해서 여기 둔다.
 */
export const RESUME_LIMIT = 200;

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
