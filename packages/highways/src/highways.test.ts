import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHighways } from './build.ts';
import { readDbf } from './dbf.ts';
import { loadHighways } from './read.ts';
import { readShpLines } from './shp.ts';
import { simplify } from './simplify.ts';
import { ascii, GYEONGBU_CP949, makeDbf, makeShp } from './test-files.ts';
import { tmToLonLat } from './tm.ts';

describe('tmToLonLat', () => {
  it('원점은 경도 127, 위도 38', () => {
    const [lon, lat] = tmToLonLat(200000, 600000);
    expect(lon).toBeCloseTo(127, 9);
    expect(lat).toBeCloseTo(38, 9);
  });
  it('중앙자오선 위에서는 경도가 그대로', () => {
    const [lon, lat] = tmToLonLat(200000, 711000);
    expect(lon).toBeCloseTo(127, 9);
    expect(lat).toBeGreaterThan(38.99);
    expect(lat).toBeLessThan(39.01);
  });
});

describe('simplify', () => {
  it('허용 오차 안의 점은 버리고 끝점은 남긴다', () => {
    expect(simplify([[0, 0], [1, 0.1], [2, 0]], 0.5)).toEqual([[0, 0], [2, 0]]);
  });
  it('벗어난 점은 남긴다', () => {
    expect(simplify([[0, 0], [1, 5], [2, 0]], 0.5)).toHaveLength(3);
  });
});

describe('readDbf', () => {
  it('CP949 한글을 읽고 공백을 자른다', () => {
    const dbf = makeDbf(
      [['LINK_ID', 10], ['ROAD_NAME', 30]],
      [
        [ascii('1000000100'), GYEONGBU_CP949],
        [ascii('2'), ascii('abc')],
      ],
    );
    const rows = [...readDbf(dbf, ['LINK_ID', 'ROAD_NAME'])];
    expect(rows).toEqual([
      { LINK_ID: '1000000100', ROAD_NAME: '경부고속도로' },
      { LINK_ID: '2', ROAD_NAME: 'abc' },
    ]);
  });
});

describe('readShpLines', () => {
  it('파트 2개를 이어 5점으로 돌려준다', () => {
    const { shp, shx } = makeShp([
      [[[0, 0]]],
      [
        [[1, 1], [2, 2], [3, 3]],
        [[4, 4], [5, 5]],
      ],
    ]);
    expect(readShpLines(shp, shx, 1)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    expect(readShpLines(shp, shx, 0)).toEqual([[0, 0]]);
  });
});

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'highways-'));
  const fields: [string, number][] = [
    ['LINK_ID', 10],
    ['ROAD_RANK', 3],
    ['ROAD_NAME', 30],
    ['CONNECT', 3],
    ['LENGTH', 18],
  ];
  const row = (id: string, rank: string, name: Uint8Array, connect: string, len: string) => [
    ascii(id), ascii(rank), name, ascii(connect), ascii(len),
  ];
  writeFileSync(
    join(dir, 'MOCT_LINK.dbf'),
    makeDbf(fields, [
      row('A', '101', GYEONGBU_CP949, '0', '123.5'),
      row('B', '101', GYEONGBU_CP949, '1', '50'),
      row('C', '103', ascii('x'), '0', '70'),
    ]),
  );
  const line: [number, number][] = [[200000, 600000], [200100, 600000], [200200, 600000]];
  const { shp, shx } = makeShp([[line], [line], [line]]);
  writeFileSync(join(dir, 'MOCT_LINK.shp'), shp);
  writeFileSync(join(dir, 'MOCT_LINK.shx'), shx);
  return dir;
}

describe('buildHighways / loadHighways', () => {
  it('고속도로 본선만 남기고 경위도로 바꾼다', () => {
    const file = buildHighways(fixtureDir(), '2026-11-11');
    expect(file.source).toBe('2026-11-11');
    expect(file.routes).toEqual(['경부고속도로']);
    expect(file.links).toHaveLength(1);
    const [id, route, len, coords] = file.links[0]!;
    expect([id, route, len]).toEqual(['A', 0, 123.5]);
    expect(coords).toHaveLength(2);
    expect(coords[0]).toEqual([127, 38]);
  });

  it('loadHighways는 모르는 id에 undefined', () => {
    const dir = fixtureDir();
    const path = join(dir, 'highways.json');
    writeFileSync(path, JSON.stringify(buildHighways(dir, 't')));
    const idx = loadHighways(path);
    expect(idx.size).toBe(1);
    expect(idx.get('미지')).toBeUndefined();
    expect(idx.get('A')).toEqual({ route: '경부고속도로', lengthM: 123.5 });
  });
});
