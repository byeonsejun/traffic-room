import { flowLevel } from './flow.ts';

/** 정적 `/highways.json`. 빌드 코드를 클라이언트 번들에 넣지 않으려고 모양만 옮겨 적는다(packages/highways/src/build.ts). */
export type HighwaysFile = {
  source: string;
  routes: string[];
  links: [linkId: string, routeIndex: number, lengthM: number, coords: [number, number][]][];
};

export type HighwayProps = { s: number | null; lv: number | null };
export type HighwayFeature = {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: HighwayProps;
};
export type HighwayCollection = { type: 'FeatureCollection'; features: HighwayFeature[] };

/** 본선 구간마다 선 하나. 속도가 없는 구간은 바탕선으로만 그려지도록 `s` · `lv` 를 null 로 둔다. */
export function toGeoJson(file: HighwaysFile, speeds: Map<string, number> | null): HighwayCollection {
  return {
    type: 'FeatureCollection',
    features: file.links.map(([linkId, , , coordinates]) => {
      const s = speeds?.get(linkId);
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: s === undefined ? { s: null, lv: null } : { s, lv: flowLevel(s) },
      };
    }),
  };
}
