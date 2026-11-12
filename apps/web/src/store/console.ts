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
const FRESH_WITHIN_MS = 120_000;

interface ConsoleState {
  incidents: Record<string, Incident>;
  feed: FeedItem[];
  lastId: number;
  status: ConnStatus;
  retryInMs?: number;
  selectedKey: string | null;
  cctvId: string | null;
  cctvUrlOverride: Record<string, string | null>;
  applySnapshot(s: Snapshot): void;
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

  applySnapshot: (s) =>
    set((st) => ({
      incidents: Object.fromEntries(s.incidents.map((i) => [i.key, i])),
      lastId: Math.max(st.lastId, s.latestId),
    })),

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
