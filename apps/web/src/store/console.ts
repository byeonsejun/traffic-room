import { create } from 'zustand';
import type { Incident, ServerMessage } from '@traffic-room/shared';
import type { ConnStatus } from '@/lib/realtime-client';

export type { ConnStatus };

export type Snapshot = {
  incidents: Incident[];
  latestId: number;
  collectedAt: string | null;
  delayMinutes: number;
};

export type FeedItem = {
  id: number;
  kind: 'arrived' | 'cleared';
  incident: Incident;
  at: string;
  fresh: boolean;
};

const FEED_MAX = 30;
/** 서버가 resume 한 번에 돌려주는 최대 건수(apps/realtime 의 RESUME_LIMIT 와 같다). */
export const RESUME_LIMIT = 200;

/**
 * hello 의 latestId 로 보아 resume 만으로는 따라잡을 수 없으면 true.
 * 200건 넘게 밀렸거나, 서버 로그가 우리 lastId 보다 뒤에 있으면(초기화 등) 스냅샷부터 다시 받는다.
 */
export function needsResync(lastId: number, latestId: number): boolean {
  return latestId - lastId > RESUME_LIMIT || latestId < lastId;
}
const FRESH_WITHIN_MS = 120_000;

/**
 * 새 도착 연출(파동 · 지도 이동 · 숫자 강조)을 할 항목인지. 늦게 받은 것(fresh 아님)과,
 * 오래 이어지는 공사는 조용히 들어온다.
 */
export function isLoudArrival(item: FeedItem | undefined): boolean {
  return !!item && item.kind === 'arrived' && item.fresh && item.incident.category !== 'construction';
}

interface ConsoleState {
  incidents: Record<string, Incident>;
  feed: FeedItem[];
  lastId: number;
  status: ConnStatus;
  retryInMs?: number;
  selectedKey: string | null;
  cctvId: string | null;
  cctvUrlOverride: Record<string, string | null>;
  /** reset 이면 lastId 를 스냅샷 값으로 맞춘다(더 낮아도). 아니면 lastId 는 내려가지 않는다. */
  applySnapshot(s: Snapshot, opts?: { reset?: boolean }): void;
  applyServerMessage(m: ServerMessage, now: Date): void;
  setStatus(s: ConnStatus, retryInMs?: number): void;
  select(key: string | null): void;
  setCctv(id: string | null): void;
}

export const useConsole = create<ConsoleState>()((set) => ({
  incidents: {},
  feed: [],
  lastId: 0,
  status: 'connecting',
  retryInMs: undefined,
  selectedKey: null,
  cctvId: null,
  cctvUrlOverride: {},

  applySnapshot: (s, opts) =>
    set((st) => {
      const incidents = Object.fromEntries(s.incidents.map((i) => [i.key, i]));
      if (!opts?.reset) return { incidents, lastId: Math.max(st.lastId, s.latestId) };
      return {
        incidents,
        lastId: s.latestId,
        selectedKey: st.selectedKey && incidents[st.selectedKey] ? st.selectedKey : null,
      };
    }),

  applyServerMessage: (m, now) =>
    set((st) => {
      switch (m.type) {
        case 'incident.arrived':
        case 'incident.cleared': {
          if (m.id <= st.lastId) return st;
          const fresh = now.getTime() - Date.parse(m.ts) <= FRESH_WITHIN_MS;
          if (m.type === 'incident.arrived') {
            const incident = m.payload.incident;
            const item: FeedItem = { id: m.id, kind: 'arrived', incident, at: m.ts, fresh };
            return {
              incidents: { ...st.incidents, [incident.key]: incident },
              feed: [item, ...st.feed].slice(0, FEED_MAX),
              lastId: m.id,
            };
          }
          const gone = st.incidents[m.payload.key];
          if (!gone) return { lastId: m.id };
          const { [m.payload.key]: _removed, ...rest } = st.incidents;
          const item: FeedItem = { id: m.id, kind: 'cleared', incident: gone, at: m.ts, fresh };
          return {
            incidents: rest,
            feed: [item, ...st.feed].slice(0, FEED_MAX),
            lastId: m.id,
            selectedKey: st.selectedKey === m.payload.key ? null : st.selectedKey,
          };
        }
        case 'cctv.url': {
          const { cctvId, url } = m.payload;
          return { cctvUrlOverride: { ...st.cctvUrlOverride, [cctvId]: url } };
        }
        default:
          return st;
      }
    }),

  setStatus: (status, retryInMs) => set({ status, retryInMs }),
  // 다른 돌발을 고르면 가장 가까운 CCTV부터 다시 보여 준다.
  select: (selectedKey) => set({ selectedKey, cctvId: null }),
  setCctv: (cctvId) => set({ cctvId }),
}));
