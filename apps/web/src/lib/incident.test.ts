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

test('a message that repeats itself is said once', () => {
  expect(incidentTitle({ ...base, roadName: '운천로56번길', message: '노면상태 불량 노면상태 불량' })).toBe('운천로56번길 노면상태 불량');
  const report = '[국토교통부 도로안심ㆍ서비스 국민참여단] 포트홀이 발생하였습니다. 빠른 조치 부탁드립니다.';
  expect(incidentTitle({ ...base, roadName: '수정로', message: `${report} ${report}` })).toBe(`수정로 ${report}`);
});

test('"::" parts drop the road name and repeated parts and read as one line', () => {
  const message = '구반포지하차도::구반포지하차도 ::1차로::[공사] 시설물 유지보수공사::도로공사  서울청';
  expect(incidentTitle({ ...base, roadName: '올림픽대로', message: `올림픽대로::${message}` }))
    .toBe('올림픽대로 구반포지하차도 · 1차로 · [공사] 시설물 유지보수공사 · 도로공사 서울청');
});

test('ordinary messages are left as they were', () => {
  expect(incidentTitle({ ...base, roadName: '중부선', message: '(갓길)대형화물차 고장처리중' })).toBe('중부선 (갓길)대형화물차 고장처리중');
  expect(incidentTitle({ ...base, roadName: '경부선', message: '서울 서울 방향 사고' })).toBe('경부선 서울 서울 방향 사고');
});

test('a part repeated further along is dropped too', () => {
  expect(incidentTitle({ ...base, roadName: '올림픽대로', message: '올림픽대로::구반포지하차도::1차로::구반포지하차도::[공사] 보수' }))
    .toBe('올림픽대로 구반포지하차도 · 1차로 · [공사] 보수');
});
