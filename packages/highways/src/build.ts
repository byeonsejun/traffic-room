import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDbf } from './dbf.ts';
import { readShpLines } from './shp.ts';
import { simplify } from './simplify.ts';
import { tmToLonLat } from './tm.ts';
import type { HighwaysFile } from './types.ts';

export type { HighwaysFile };

const TOLERANCE_M = 8;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const round1 = (n: number) => Math.round(n * 10) / 10; // 길이는 0.1m면 충분하다

// 고속도로(ROAD_RANK 101) 본선(CONNECT 0)만 남기고, TM 좌표에서 단순화한 뒤 경위도로 바꾼다.
export function buildHighways(dir: string, source = '', toleranceM = TOLERANCE_M): HighwaysFile {
  const dbf = readFileSync(join(dir, 'MOCT_LINK.dbf'));
  const shp = readFileSync(join(dir, 'MOCT_LINK.shp'));
  const shx = readFileSync(join(dir, 'MOCT_LINK.shx'));

  const routes: string[] = [];
  const routeIndex = new Map<string, number>();
  const links: HighwaysFile['links'] = [];
  let i = 0;
  for (const r of readDbf(dbf, ['LINK_ID', 'ROAD_RANK', 'ROAD_NAME', 'CONNECT', 'LENGTH'])) {
    const recordIndex = i++;
    if (r.ROAD_RANK !== '101' || r.CONNECT !== '0') continue;
    const name = r.ROAD_NAME as string;
    let ri = routeIndex.get(name);
    if (ri === undefined) {
      ri = routes.length;
      routes.push(name);
      routeIndex.set(name, ri);
    }
    const coords = simplify(readShpLines(shp, shx, recordIndex), toleranceM).map(([x, y]) => {
      const [lon, lat] = tmToLonLat(x, y);
      return [round4(lon), round4(lat)] as [number, number];
    });
    links.push([r.LINK_ID as string, ri, round1(Number(r.LENGTH)), coords]);
  }
  return { source, routes, links };
}
