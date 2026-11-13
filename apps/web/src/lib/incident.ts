import type { Incident } from '@traffic-room/shared';

/** 원본 문구의 "** … **" 장식과 겹친 공백을 걷어 낸다. */
export const tidy = (s: string) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

/** 같은 문장이 공백 하나를 사이에 두고 통째로 두 번 나오면 한 번만 둔다(원본 ITS 문구에 실제로 있다). */
function once(s: string): string {
  const mid = s.length / 2;
  if (!Number.isInteger(mid - 0.5)) return s;
  const a = s.slice(0, mid - 0.5);
  return s[mid - 0.5] === ' ' && a === s.slice(mid + 0.5) ? a : s;
}

/**
 * 상황 문구 정리. 서울시 출처 문구는 "도로명::구간::구간::차로::[공사]내용::…" 처럼 "::" 로 이어져 있어
 * 도로명과 바로 앞과 같은 조각을 빼고 " · " 로 잇는다.
 */
function describe(message: string, roadName: string): string {
  const parts = message.split('::').map((p) => once(tidy(p))).filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) {
    if (p === roadName || p === kept.at(-1)) continue;
    kept.push(p);
  }
  return kept.join(' · ');
}

/** 피드 카드와 지도 툴팁이 같이 쓰는 돌발 이름: 도로 + 상황 문구(없으면 세부). */
export const incidentTitle = (i: Incident) =>
  `${i.roadName} ${describe(i.message, i.roadName) || tidy(i.detail)}`.trim();
