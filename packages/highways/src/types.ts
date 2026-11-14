/**
 * 화면에 배포하는 고속도로 모양 파일(`/highways.json`)의 모양. 빌드 코드(node:fs 등)와 떨어뜨려 두어
 * 웹이 타입만 가져다 써도 빌드 코드가 웹의 타입 검사나 번들에 끌려 들어가지 않게 한다(`@traffic-room/highways/types`).
 */
export type HighwaysFile = {
  source: string;
  routes: string[];
  links: [linkId: string, routeIndex: number, lengthM: number, coords: [number, number][]][];
};
