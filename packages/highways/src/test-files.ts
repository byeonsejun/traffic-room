// 테스트용 DBF/SHP/SHX 바이트 조립 도구.
export function makeDbf(fields: [name: string, length: number][], rows: Uint8Array[][]): Uint8Array {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((n, [, l]) => n + l, 0);
  const out = new Uint8Array(headerLength + rows.length * recordLength).fill(0x20);
  const v = new DataView(out.buffer);
  out[0] = 3;
  v.setUint32(4, rows.length, true);
  v.setUint16(8, headerLength, true);
  v.setUint16(10, recordLength, true);
  fields.forEach(([name, length], i) => {
    const p = 32 + i * 32;
    out.fill(0, p, p + 32);
    out.set(new TextEncoder().encode(name), p);
    out[p + 11] = 'C'.charCodeAt(0);
    out[p + 16] = length;
  });
  out[headerLength - 1] = 0x0d;
  rows.forEach((row, r) => {
    let p = headerLength + r * recordLength + 1;
    out[p - 1] = 0x20;
    row.forEach((cell, c) => {
      out.set(cell, p);
      p += (fields[c] as [string, number])[1];
    });
  });
  return out;
}

export const ascii = (s: string) => new TextEncoder().encode(s);

// 경부고속도로 (CP949)
export const GYEONGBU_CP949 = Uint8Array.of(
  0xb0, 0xe6, 0xba, 0xce, 0xb0, 0xed, 0xbc, 0xd3, 0xb5, 0xb5, 0xb7, 0xce,
);

// parts: 레코드마다 [파트[점[]]]
export function makeShp(records: [number, number][][][]): { shp: Uint8Array; shx: Uint8Array } {
  const bodies = records.map((parts) => {
    const pts = parts.flat();
    const b = new Uint8Array(44 + parts.length * 4 + pts.length * 16);
    const v = new DataView(b.buffer);
    v.setInt32(0, 3, true);
    v.setInt32(36, parts.length, true);
    v.setInt32(40, pts.length, true);
    let start = 0;
    parts.forEach((part, i) => {
      v.setInt32(44 + i * 4, start, true);
      start += part.length;
    });
    pts.forEach(([x, y], i) => {
      v.setFloat64(44 + parts.length * 4 + i * 16, x, true);
      v.setFloat64(44 + parts.length * 4 + i * 16 + 8, y, true);
    });
    return b;
  });
  const shpLength = 100 + bodies.reduce((n, b) => n + 8 + b.length, 0);
  const shp = new Uint8Array(shpLength);
  const shx = new Uint8Array(100 + bodies.length * 8);
  const sv = new DataView(shp.buffer);
  const xv = new DataView(shx.buffer);
  let off = 100;
  bodies.forEach((b, i) => {
    sv.setInt32(off, i + 1, false);
    sv.setInt32(off + 4, b.length / 2, false);
    shp.set(b, off + 8);
    xv.setInt32(100 + i * 8, off / 2, false);
    xv.setInt32(100 + i * 8 + 4, b.length / 2, false);
    off += 8 + b.length;
  });
  return { shp, shx };
}
