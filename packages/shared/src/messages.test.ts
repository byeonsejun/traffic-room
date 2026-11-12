import { describe, expect, test } from 'vitest';
import { parseClientMessage, parseServerMessage } from './messages.ts';
import type { Incident } from './incident.ts';

const sampleIncident: Incident = {
  key: 'ex-0001',
  category: 'accident',
  roadName: '경부선',
  direction: '서울',
  detail: '추돌사고',
  message: '2차로 추돌사고',
  lanesBlocked: '2차로',
  lon: 127.1,
  lat: 37.4,
  startedAt: '2026-11-11T22:00:00+09:00',
};

describe('messages', () => {
  test('parses a valid arrival envelope', () => {
    const m = parseServerMessage(
      JSON.stringify({ id: 12, type: 'incident.arrived', ts: '2026-11-11T23:00:00+09:00', payload: { incident: sampleIncident } }),
    );
    expect(m?.type).toBe('incident.arrived');
  });

  test('returns null for broken json or unknown type', () => {
    expect(parseServerMessage('{')).toBeNull();
    expect(parseServerMessage(JSON.stringify({ id: 1, type: 'nope', ts: 'x', payload: {} }))).toBeNull();
  });

  test('returns null when payload does not match the type', () => {
    expect(parseServerMessage(JSON.stringify({ id: 1, type: 'incident.cleared', ts: 'x', payload: {} }))).toBeNull();
  });

  test('client resume requires a non-negative integer', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'resume', lastId: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'resume', lastId: 40 }))).toEqual({ type: 'resume', lastId: 40 });
  });
});
