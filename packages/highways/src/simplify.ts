type Point = [number, number];

// 더글러스-포커. 양 끝점은 항상 남긴다. 긴 선에서도 스택이 넘치지 않게 반복문으로 돈다.
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const [x1, y1] = points[first] as Point;
    const [x2, y2] = points[last] as Point;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1e-9;
    let index = -1;
    let max = 0;
    for (let k = first + 1; k < last; k++) {
      const [px, py] = points[k] as Point;
      const dist = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
      if (dist > max) {
        max = dist;
        index = k;
      }
    }
    if (index !== -1 && max > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
