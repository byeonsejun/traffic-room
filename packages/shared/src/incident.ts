export type Category = 'accident' | 'breakdown' | 'weather' | 'construction' | 'report' | 'other';

export interface Incident {
  key: string;
  category: Category;
  roadName: string;
  direction: string;
  detail: string;
  message: string;
  lanesBlocked: string;
  lon: number;
  lat: number;
  /** ISO 8601. KST 원본을 +09:00으로 해석한다. */
  startedAt: string | null;
}

export interface Cctv {
  id: string;
  name: string;
  lon: number;
  lat: number;
  url: string;
  fetchedAt: string;
}

export interface LogEvent {
  id: number;
  kind: 'arrived' | 'cleared';
  emitAt: string;
  incident: Incident;
}
