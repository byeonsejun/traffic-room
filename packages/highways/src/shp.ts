// SHX가 가리키는 위치의 PolyLine 레코드를 읽고, 파트를 이어 붙여 점 목록 하나로 돌려준다.
export function readShpLines(
  shp: Uint8Array,
  shx: Uint8Array,
  index: number,
): [number, number][] {
  const idx = new DataView(shx.buffer, shx.byteOffset, shx.byteLength);
  const offset = idx.getInt32(100 + index * 8, false) * 2;
  const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  const body = offset + 8;
  if (v.getInt32(body, true) === 0) return [];
  const numParts = v.getInt32(body + 36, true);
  const numPoints = v.getInt32(body + 40, true);
  const pointsAt = body + 44 + numParts * 4;
  const out: [number, number][] = [];
  for (let i = 0; i < numPoints; i++) {
    out.push([v.getFloat64(pointsAt + i * 16, true), v.getFloat64(pointsAt + i * 16 + 8, true)]);
  }
  return out;
}
