import type { Incident } from '@traffic-room/shared';

/** 원본 문구의 "** … **" 장식과 겹친 공백을 걷어 낸다. */
export const tidy = (s: string) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

/** 피드 카드와 지도 툴팁이 같이 쓰는 돌발 이름: 도로 + 상황 문구(없으면 세부). */
export const incidentTitle = (i: Incident) => `${i.roadName} ${tidy(i.message) || i.detail}`.trim();
