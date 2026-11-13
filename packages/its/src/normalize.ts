import { createHash } from 'node:crypto';
import type { Category, Cctv, Incident } from '@traffic-room/shared';
import { ItsError } from './client.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** 좌표를 숫자로 읽는다. 비었거나 0 이면 null. */
function coord(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(str(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function categorize(eventType: string, detail: string, message: string): Category {
  if (message.includes('국민참여단') || message.includes('포트홀')) return 'report';
  const t = `${eventType} ${detail}`;
  if (/공사|작업/.test(t)) return 'construction';
  if (t.includes('교통사고')) return 'accident';
  if (/고장|장애물|낙하물/.test(t)) return 'breakdown';
  if (/재난|기상|강풍|강설|결빙|안개/.test(t)) return 'weather';
  return 'other';
}

export function incidentKey(row: {
  linkId: string; startDate: string; eventDetailType: string;
  coordX: number | string; coordY: number | string; roadName: string;
}): string {
  return sha1([row.linkId, row.startDate, row.eventDetailType, row.coordX, row.coordY, row.roadName].join('|'));
}

/** 'YYYYMMDDHHmmss' (KST) -> ISO(UTC). 형식이 다르면 null. */
function parseKst(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeEvents(raw: unknown): Incident[] {
  const items = isObj(raw) && isObj(raw.body) && Array.isArray(raw.body.items) ? raw.body.items : [];
  const out: Incident[] = [];
  for (const r of items) {
    if (!isObj(r)) continue;
    const lon = coord(r.coordX);
    const lat = coord(r.coordY);
    if (lon === null || lat === null) continue;
    const startDate = str(r.startDate);
    const detail = str(r.eventDetailType);
    const roadName = str(r.roadName);
    const message = str(r.message).replace(/^<[^>]*>::/, '');
    out.push({
      key: incidentKey({ linkId: str(r.linkId), startDate, eventDetailType: detail, coordX: lon, coordY: lat, roadName }),
      category: categorize(str(r.eventType), detail, message),
      roadName, direction: str(r.roadDrcType), detail, message,
      lanesBlocked: str(r.lanesBlocked), lon, lat, startedAt: parseKst(startDate),
    });
  }
  return out;
}

export function normalizeCctvs(raw: unknown, fetchedAt: Date): Cctv[] {
  const data = isObj(raw) && isObj(raw.response) && Array.isArray(raw.response.data) ? raw.response.data : [];
  const out: Cctv[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const url = str(r.cctvurl);
    const lon = coord(r.coordx);
    const lat = coord(r.coordy);
    if (!url.startsWith('https://') || lon === null || lat === null) continue;
    const name = str(r.cctvname);
    out.push({ id: sha1(`${name}|${lon}|${lat}`), name, lon, lat, url, fetchedAt: fetchedAt.toISOString() });
  }
  return out;
}

export type TrafficFetch = { dataAt: string[]; items: { linkId: string; roadName: string; speed: number }[] };

/** 교통소통 응답을 읽는다. 속도가 숫자가 아닌 항목은 뺀다. 기준 시각 검증은 호출하는 쪽이 한다. */
export function normalizeTraffic(raw: unknown): TrafficFetch {
  const header = isObj(raw) && isObj(raw.header) ? raw.header : {};
  if (Number(header.resultCode) !== 0) {
    throw new ItsError('ITS_RESULT', `ITS 교통 응답 오류 ${str(header.resultCode)}`);
  }
  const rows = isObj(raw) && isObj(raw.body) && Array.isArray(raw.body.items) ? raw.body.items : [];
  const items: TrafficFetch['items'] = [];
  const dataAt = new Set<string>();
  for (const r of rows) {
    if (!isObj(r)) continue;
    const text = str(r.speed);
    const speed = Number(text);
    if (text === '' || !Number.isFinite(speed)) continue;
    items.push({ linkId: str(r.linkId), roadName: str(r.roadName), speed });
    const at = parseKst(str(r.createdDate));
    if (at) dataAt.add(at);
  }
  return { dataAt: [...dataAt].sort(), items };
}
