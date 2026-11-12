import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { categorize, incidentKey, normalizeCctvs, normalizeEvents } from './normalize.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

const row = {
  type: '고속도로', eventType: '교통사고', eventDetailType: '추돌', startDate: '20261111100000',
  coordX: 127.1, coordY: 37.4, linkId: '1', roadName: '경부선', roadNo: '1', roadDrcType: '기점',
  lanesBlockType: '', lanesBlocked: '1차로 차단', message: '1차로 추돌사고', endDate: '',
};
const wrap = (...items: object[]) => ({ header: { resultCode: 0 }, body: { items } });
const one = (over: object) => wrap({ ...row, ...over });

describe('normalizeEvents', () => {
  test('normalizes the real 2026-11-11 snapshot', () => {
    const list = normalizeEvents(fixture('events.json'));
    expect(list).toHaveLength(284);
    expect(new Set(list.map((i) => i.key)).size).toBe(284);
    expect(list.filter((i) => i.category === 'construction').length).toBeGreaterThan(200);
  });

  test('maps fields from the raw row', () => {
    const i = normalizeEvents(one({ coordX: '127.1', coordY: '37.4' }))[0]!;
    expect(i).toMatchObject({
      roadName: '경부선', direction: '기점', detail: '추돌', lanesBlocked: '1차로 차단',
      lon: 127.1, lat: 37.4, category: 'accident',
    });
    expect(i.key).toMatch(/^[0-9a-f]{16}$/);
  });

  test('tolerates broken rows', () => {
    const list = normalizeEvents(wrap(
      { ...row, startDate: '' }, { ...row, startDate: '0000' }, { ...row, coordX: '', coordY: '' },
      { ...row, coordX: 0, coordY: 0 }, { ...row, message: '<사고>::포트홀' },
    ));
    expect(list).toHaveLength(3);
    expect(list[0]!.startedAt).toBeNull();
    expect(list[2]!.message).toBe('포트홀');
  });

  test('returns an empty list for unexpected shapes', () => {
    expect(normalizeEvents(null)).toEqual([]);
    expect(normalizeEvents({ body: {} })).toEqual([]);
  });

  test('startDate is read as KST', () => {
    expect(normalizeEvents(one({ startDate: '20261111225344' }))[0]!.startedAt).toBe('2026-11-11T13:53:44.000Z');
  });
});

describe('categorize', () => {
  test('remaps citizen pothole reports out of accident', () => {
    expect(categorize('교통사고', '', '<사고>::[국토교통부 도로안심ㆍ서비스 국민참여단] 포트홀이 발생하였습니다.')).toBe('report');
    expect(categorize('기타돌발', '고장', '(갓길) 화물차 고장처리중')).toBe('breakdown');
    expect(categorize('기타돌발', '장애물', '(2차로) 장애물 처리중')).toBe('breakdown');
    expect(categorize('재난', '강풍', '"강풍"주의')).toBe('weather');
    expect(categorize('공사', '작업', '노면보수')).toBe('construction');
    expect(categorize('교통사고', '추돌', '1차로 추돌사고')).toBe('accident');
    expect(categorize('기타돌발', '', '')).toBe('other');
  });
});

describe('incidentKey', () => {
  test('is stable and sensitive to each field', () => {
    const a = { linkId: '1', startDate: 's', eventDetailType: 'd', coordX: '1', coordY: '2', roadName: 'r' };
    expect(incidentKey(a)).toBe(incidentKey({ ...a }));
    expect(incidentKey(a)).not.toBe(incidentKey({ ...a, roadName: 'x' }));
    expect(incidentKey(a)).toHaveLength(16);
  });
});

describe('normalizeCctvs', () => {
  test('keeps https urls only', () => {
    const list = normalizeCctvs(fixture('cctv-ex.json'), new Date('2026-11-11T14:00:00Z'));
    expect(list).toHaveLength(172);
    expect(list.every((c) => c.url.startsWith('https://'))).toBe(true);
    expect(list[0]!.fetchedAt).toBe('2026-11-11T14:00:00.000Z');
  });

  test('drops http urls and rows without coordinates', () => {
    const base = { cctvname: 'a', cctvurl: 'https://x', coordx: 127, coordy: 37 };
    const list = normalizeCctvs({ response: { data: [
      base, { ...base, cctvurl: 'http://x' }, { ...base, coordx: 0 }, { ...base, cctvname: 'b', coordx: '127.5' },
    ] } }, new Date(0));
    expect(list.map((c) => c.name)).toEqual(['a', 'b']);
    expect(new Set(list.map((c) => c.id)).size).toBe(2);
  });
});
