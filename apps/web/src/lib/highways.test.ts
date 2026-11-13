import { expect, test } from 'vitest';
import { speedGeoJson, toGeoJson, type HighwaysFile } from './highways.ts';

const file: HighwaysFile = {
  source: 'test',
  routes: ['경부고속도로', '영동고속도로'],
  links: [
    ['A', 0, 500, [[127.0, 37.0], [127.01, 37.01]]],
    ['B', 0, 400, [[127.01, 37.01], [127.02, 37.02]]],
    ['C', 1, 300, [[128.0, 37.5], [128.01, 37.5]]],
  ],
};

test('every link becomes a line, links without a speed stay null', () => {
  const fc = toGeoJson(file, new Map([['A', 75], ['B', 15]]));
  expect(fc.features).toHaveLength(3);
  expect(fc.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[127.0, 37.0], [127.01, 37.01]] });
  expect(fc.features.map((f) => f.properties)).toEqual([
    { s: 75, lv: 3 },
    { s: 15, lv: 0 },
    { s: null, lv: null },
  ]);
});

test('without speeds every link is a bare base line', () => {
  const fc = toGeoJson(file, null);
  expect(fc.features.every((f) => f.properties.s === null && f.properties.lv === null)).toBe(true);
});

test('the speed layer gets only links that have a speed, sharing the base geometry', () => {
  const fc = speedGeoJson(file, new Map([['C', 55], ['A', 75], ['Z', 90]]));
  expect(fc.features.map((f) => f.properties)).toEqual([{ s: 75, lv: 3 }, { s: 55, lv: 2 }]);
  expect(fc.features[1]!.geometry.coordinates).toBe(file.links[2]![3]);
});
