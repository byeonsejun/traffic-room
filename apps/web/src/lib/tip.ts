type Pt = { x: number; y: number };
type Size = { width: number; height: number };

const GAP = 12;
/** 툴팁이 지도 가장자리에서 띄울 최소 간격. 실시간 핀 툴팁도 같은 값을 쓴다. */
export const TIP_EDGE = 8;
const EDGE = TIP_EDGE;

/**
 * 지도 위 한 점에 붙는 툴팁 자리(지도 상자 기준 좌상단). 점 위 가운데가 기본이고,
 * 위에 8px 여백을 못 지키면 점 아래로(아래도 자리가 없으면 위에 두되 상자 위로 넘치지 않게), 옆으로 넘치면 안쪽으로 민다.
 */
export function tipSpot(pt: Pt, size: Size, box: Size): { left: number; top: number; below: boolean } {
  const left = Math.max(EDGE, Math.min(pt.x - size.width / 2, box.width - EDGE - size.width));
  const above = pt.y - GAP - size.height;
  const below = above < EDGE && pt.y + GAP + size.height <= box.height - EDGE;
  return { left: Math.round(left), top: Math.round(below ? pt.y + GAP : Math.max(EDGE, above)), below };
}
