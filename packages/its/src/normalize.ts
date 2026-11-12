import { createHash } from 'node:crypto';
import type { Category, Cctv, Incident } from '@traffic-room/shared';

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
