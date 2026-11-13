import { expect, test } from 'vitest';
import type { Incident } from '@traffic-room/shared';
import { incidentTitle, tidy } from './incident';

const base: Incident = {
  key: 'k', category: 'accident', roadName: '경부선', direction: '서울', detail: '1차로', message: '',
  lanesBlocked: '', lon: 127, lat: 37, startedAt: null,
};

test('tidy strips ** decorations and collapses spaces', () => {
  expect(tidy('** 사고  처리 중 **')).toBe('사고 처리 중');
});

test('title is the road plus the tidied message, falling back to detail', () => {
  expect(incidentTitle({ ...base, message: '**추돌사고**' })).toBe('경부선 추돌사고');
  expect(incidentTitle(base)).toBe('경부선 1차로');
});
