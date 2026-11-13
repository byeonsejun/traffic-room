import { describe, expect, test } from 'vitest';
import type { HighwaysIndex } from '@traffic-room/highways';
import type { TrafficFetch } from '@traffic-room/its';
import { pickHighways, summarize, validateTraffic } from './traffic.ts';

const hwOf = (entries: [string, string, number][], size = entries.length): HighwaysIndex => {
  const m = new Map(entries.map(([id, route, lengthM]) => [id, { route, lengthM }]));
  return { size, get: (id) => m.get(id) };
};
const AT = '2026-11-13T01:00:00.000Z';
const fetchOf = (speeds: number[], dataAt = [AT]): TrafficFetch => ({
  dataAt,
  items: speeds.map((speed, i) => ({ linkId: `L${i}`, roadName: '경부고속도로', speed })),
});
const asSpeeds = (f: TrafficFetch) => f.items.map(({ linkId, speed }) => ({ linkId, speed }));
const run = (speeds: number[], over: Partial<Parameters<typeof validateTraffic>[0]> = {}, dataAt = [AT]) => {
  const fetch = fetchOf(speeds, dataAt);
  return validateTraffic({ fetch, speeds: asSpeeds(fetch), prev: null, hwSize: speeds.length, ...over });
};
const prev = (linkCount: number) => ({ dataAt: new Date('2026-11-13T00:00:00.000Z'), linkCount });

describe('summarize', () => {
  test('길이 가중 평균과 정체 구간 길이', () => {
    const hw = hwOf([['a', '경부선', 1000], ['b', '경부선', 3000]]);
    const r = summarize([{ linkId: 'a', speed: 100 }, { linkId: 'b', speed: 20 }], hw);
    expect(r.summary).toEqual({ avgSpeed: 40, ok: 1, slow: 0, jam: 1, jamKm: 3 });
    expect(r.routes).toEqual([{ route: '경부선', avgSpeed: 40 }]);
  });
  test('노선별로 따로 평균낸다', () => {
    const hw = hwOf([['a', '경부선', 1000], ['b', '영동선', 1000]]);
    const r = summarize([{ linkId: 'a', speed: 80 }, { linkId: 'b', speed: 50 }], hw);
    expect(r.routes).toEqual([{ route: '경부선', avgSpeed: 80 }, { route: '영동선', avgSpeed: 50 }]);
    expect(r.summary).toMatchObject({ ok: 1, slow: 1, jam: 0, jamKm: 0 });
  });
});

describe('validateTraffic', () => {
  test('직전 대비 80% 미만이면 too-few, 80% 면 통과', () => {
    expect(run(Array(790).fill(80), { prev: prev(1000) })).toEqual({ ok: false, reason: 'too-few' });
    expect(run(Array(800).fill(80), { prev: prev(1000) })).toMatchObject({ ok: true });
  });
  test('직전이 없으면 도로 모양의 30% 미만일 때 too-few', () => {
    expect(run(Array(299).fill(80), { hwSize: 1000 })).toEqual({ ok: false, reason: 'too-few' });
    expect(run(Array(300).fill(80), { hwSize: 1000 })).toMatchObject({ ok: true });
  });
  test('기준 시각이 둘이면 multi-time', () => {
    expect(run([80, 80], {}, [AT, '2026-11-13T02:00:00.000Z'])).toEqual({ ok: false, reason: 'multi-time' });
  });
  test('직전과 같거나 오래된 시각이면 not-newer', () => {
    const fetch = fetchOf([80]);
    const same = { dataAt: new Date(AT), linkCount: 1 };
    expect(validateTraffic({ fetch, speeds: asSpeeds(fetch), prev: same, hwSize: 1 })).toEqual({ ok: false, reason: 'not-newer' });
  });
  test('범위 밖 속도는 bad-speed', () => {
    expect(run([80, 250])).toEqual({ ok: false, reason: 'bad-speed' });
    expect(run([80, -1])).toEqual({ ok: false, reason: 'bad-speed' });
  });
  test('0 속도 5% 이상이면 too-many-zero, 4.9% 면 통과', () => {
    expect(run([...Array(5).fill(0), ...Array(95).fill(80)])).toEqual({ ok: false, reason: 'too-many-zero' });
    expect(run([...Array(49).fill(0), ...Array(951).fill(80)])).toMatchObject({ ok: true });
  });
  test('쓸 수 있는 구간이 없으면 result', () => {
    expect(run([])).toEqual({ ok: false, reason: 'result' });
  });
});

describe('pickHighways', () => {
  test('도로 모양에 없는 구간은 버리고 누락 수와 알 수 없는 고속도로 수를 센다', () => {
    const hw = hwOf([['a', '경부선', 1000], ['b', '경부선', 1000], ['c', '경부선', 1000]]);
    const f: TrafficFetch = {
      dataAt: [AT],
      items: [
        { linkId: 'a', roadName: '경부고속도로', speed: 80 },
        { linkId: 'x1', roadName: '경부고속도로', speed: 80 },
        { linkId: 'x2', roadName: '영동고속도로', speed: 80 },
        { linkId: 'n1', roadName: '국도1호선', speed: 80 },
      ],
    };
    const r = pickHighways(f, hw);
    expect(r.speeds).toEqual([{ linkId: 'a', speed: 80 }]);
    expect(r).toMatchObject({ missing: 2, unknown: 2 });
  });
});
