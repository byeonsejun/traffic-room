import { describe, expect, test } from 'vitest';
import type { Incident } from '@traffic-room/shared';
import { EmptyFetchError, planIncidentChanges } from './plan.ts';

const at = (hm: string, day = '11') => new Date(`2026-11-${day}T${hm}:00+09:00`);
const inc = (key: string, startedAt: string | null = null): Incident => ({
  key, category: 'accident', roadName: '경부선', direction: '서울', detail: '', message: '',
  lanesBlocked: '', lon: 127, lat: 37, startedAt,
});
const a = inc('a');
const b = inc('b');
const base = { delayMinutes: 60 };

describe('planIncidentChanges', () => {
  test('first run makes everything quiet', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [a, b], collectedAt: at('23:05'), prevCollectedAt: null });
    expect(p.quiet).toHaveLength(2);
    expect(p.arriving).toHaveLength(0);
    expect(p.cleared).toHaveLength(0);
  });

  test('new incident started after the previous run arrives at startedAt + 60m', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('n', at('22:29').toISOString())],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving[0]!.emitAt).toEqual(at('23:29'));
  });

  test('new but long-running incident stays quiet', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('old', '2026-09-18T08:00:00+09:00')],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.quiet.map((i) => i.key)).toEqual(['old']);
    expect(p.arriving).toHaveLength(0);
  });

  test('slack: started 2 minutes before the previous run still arrives', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('n', at('22:03').toISOString())],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving).toHaveLength(1);
  });

  test('new incident with null startedAt arrives at collectedAt + 60m', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('n', null)],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving[0]!.emitAt).toEqual(at('00:05', '12'));
  });

  test('emitAt is never earlier than collectedAt', () => {
    // 이전 수집이 21:05 에 멈췄다가(Actions 지연) 23:05 에 돌았다. 21:55 시작 + 60m = 22:55 < 23:05.
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('n', at('21:55').toISOString())],
      collectedAt: at('23:05'), prevCollectedAt: at('21:05') });
    expect(p.arriving[0]!.emitAt.getTime()).toBeGreaterThanOrEqual(at('23:05').getTime());
  });

  test('a startedAt in the future is treated as unknown (collectedAt + 60m)', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('f', at('23:59', '13').toISOString())],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving[0]!.emitAt).toEqual(at('00:05', '12'));
  });

  test('an unparseable startedAt is treated as unknown', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('x', 'not a date')],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving).toHaveLength(1);
    expect(p.arriving[0]!.emitAt).toEqual(at('00:05', '12'));
  });

  test('emitAt always stays within [collectedAt, collectedAt + delay]', () => {
    const starts = [null, at('21:00'), at('22:30'), at('23:04'), at('23:06'), at('09:00', '20'), new Date(NaN)];
    const p = planIncidentChanges({ ...base, activeKeys: [],
      fetched: starts.map((d, i) => inc(`s${i}`, d === null ? null : Number.isNaN(d.getTime()) ? 'bad' : d.toISOString())),
      collectedAt: at('23:05'), prevCollectedAt: at('20:55') });
    for (const a of p.arriving) {
      expect(a.emitAt.getTime()).toBeGreaterThanOrEqual(at('23:05').getTime());
      expect(a.emitAt.getTime()).toBeLessThanOrEqual(at('00:05', '12').getTime());
    }
  });

  test('after a long gap, incidents that started more than 2 h ago stay quiet', () => {
    // 수집이 하루 넘게 멈췄다가 다시 돌았다. 그 사이 시작된 건이라도 2시간보다 오래됐으면 조용히 넣는다.
    const p = planIncidentChanges({ ...base, activeKeys: [],
      fetched: [inc('old', at('20:00').toISOString()), inc('recent', at('22:10').toISOString())],
      collectedAt: at('23:05'), prevCollectedAt: at('21:00', '10') });
    expect(p.quiet.map((i) => i.key)).toEqual(['old']);
    expect(p.arriving.map((x) => x.incident.key)).toEqual(['recent']);
    expect(p.arriving[0]!.emitAt).toEqual(at('23:10'));
  });

  test('an invalid prevCollectedAt is treated like a first run', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [a],
      collectedAt: at('23:05'), prevCollectedAt: new Date(NaN) });
    expect(p.quiet).toHaveLength(1);
    expect(p.arriving).toHaveLength(0);
  });

  test('an invalid collectedAt is rejected', () => {
    expect(() => planIncidentChanges({ ...base, activeKeys: [], fetched: [a],
      collectedAt: new Date(NaN), prevCollectedAt: at('22:05') })).toThrow(RangeError);
  });

  test('missing active key is cleared at collectedAt + 60m and present ones are seen', () => {
    const p = planIncidentChanges({ ...base, activeKeys: ['a', 'gone'], fetched: [a],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.seen).toEqual(['a']);
    expect(p.cleared).toEqual([{ key: 'gone', emitAt: at('00:05', '12') }]);
    expect(p.arriving).toHaveLength(0);
  });

  test('duplicate keys in one response are counted once', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [inc('n'), inc('n')],
      collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p.arriving).toHaveLength(1);
  });

  test('throws EmptyFetchError when ITS returns nothing but we have active incidents', () => {
    expect(() => planIncidentChanges({ ...base, activeKeys: ['k1'], fetched: [], collectedAt: at('23:05'), prevCollectedAt: at('22:05') }))
      .toThrow(EmptyFetchError);
  });

  test('empty fetch with no active incidents is a plain no-op', () => {
    const p = planIncidentChanges({ ...base, activeKeys: [], fetched: [], collectedAt: at('23:05'), prevCollectedAt: at('22:05') });
    expect(p).toEqual({ quiet: [], arriving: [], seen: [], cleared: [] });
  });
});
