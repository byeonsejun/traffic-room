import { readFileSync } from 'node:fs';
import type { Cctv, Incident } from '@traffic-room/shared';
import { normalizeCctvs, normalizeEvents, normalizeTraffic } from './normalize.ts';
import type { TrafficFetch } from './normalize.ts';

export type Bbox = { minX: number; maxX: number; minY: number; maxY: number };

export interface ItsClient {
  events(): Promise<Incident[]>;
  cctvs(type: 'ex' | 'its', bbox?: Bbox): Promise<Cctv[]>;
  traffic(): Promise<TrafficFetch>;
}

/** 메시지에는 키나 키가 든 URL 을 담지 않는다. */
export class ItsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ItsError';
  }
}

const BASE = 'https://openapi.its.go.kr:9443';
const KOREA: Bbox = { minX: 124, maxX: 132, minY: 33, maxY: 39 };
const TIMEOUT_MS = 20_000;
// 전국 교통소통은 응답이 75MB 라 실측 19초가 걸린다.
const TRAFFIC_TIMEOUT_MS = 120_000;

// 번들러(Turbopack)가 템플릿 경로를 잘못 묶는 일이 있어 파일마다 리터럴 URL 로 읽는다.
const readFixture = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const fixture = (name: 'events.json' | 'cctv-ex.json' | 'traffic.json'): unknown =>
  name === 'events.json'
    ? readFixture(new URL('../fixtures/events.json', import.meta.url))
    : name === 'traffic.json'
      ? readFixture(new URL('../fixtures/traffic.json', import.meta.url))
      : readFixture(new URL('../fixtures/cctv-ex.json', import.meta.url));

export function createItsClient(opts: { mode: 'fixture' | 'live'; apiKey?: string; fetchImpl?: typeof fetch }): ItsClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function call(path: string, params: Record<string, string | number>, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    if (!opts.apiKey) throw new ItsError('NO_KEY', 'ITS_API_KEY 가 없습니다');
    const qs = new URLSearchParams({ apiKey: opts.apiKey, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const url = `${BASE}${path}?${qs}`;
    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ItsError('NETWORK', 'ITS 요청에 실패했습니다');
    }
    if (!res.ok) throw new ItsError(`HTTP_${res.status}`, `ITS 응답 오류 ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ItsError('BAD_JSON', 'ITS 응답을 읽을 수 없습니다');
    }
    const header = (body as { header?: { resultCode?: unknown; resultMsg?: unknown } } | null)?.header;
    const code = header?.resultCode;
    if (code !== undefined && Number(code) !== 0) {
      throw new ItsError(String(code), `ITS 오류 ${String(code)}: ${String(header?.resultMsg ?? '')}`);
    }
    return body;
  }

  return {
    async events() {
      if (opts.mode === 'fixture') return normalizeEvents(fixture('events.json'));
      return normalizeEvents(await call('/eventInfo', { type: 'all', eventType: 'all', getType: 'json' }));
    },
    async cctvs(type, bbox = KOREA) {
      if (opts.mode === 'fixture') return normalizeCctvs(fixture('cctv-ex.json'), new Date());
      const raw = await call('/cctvInfo', { type, cctvType: 4, ...bbox, getType: 'json' });
      return normalizeCctvs(raw, new Date());
    },
    async traffic() {
      if (opts.mode === 'fixture') return normalizeTraffic(fixture('traffic.json'));
      const raw = await call('/trafficInfo', { type: 'all', drcType: 'all', ...KOREA, getType: 'json' }, TRAFFIC_TIMEOUT_MS);
      return normalizeTraffic(raw);
    },
  };
}
