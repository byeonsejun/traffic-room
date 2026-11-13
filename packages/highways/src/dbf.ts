const CP949 = new TextDecoder('euc-kr');

// dBase 파일에서 필요한 필드만 문자열(앞뒤 공백 제거)로 읽는다. 삭제 표시는 따로 거르지 않는다.
export function* readDbf(
  buf: Uint8Array,
  fields: string[],
  decode: (b: Uint8Array) => string = (b) => CP949.decode(b),
): Iterable<Record<string, string>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);

  const layout = new Map<string, [offset: number, length: number]>();
  let offset = 1; // 맨 앞 1바이트는 삭제 표시
  for (let p = 32; p < headerLength && buf[p] !== 0x0d; p += 32) {
    let end = p;
    while (end < p + 11 && buf[end] !== 0) end++;
    const name = new TextDecoder().decode(buf.subarray(p, end));
    const length = buf[p + 16] as number;
    layout.set(name, [offset, length]);
    offset += length;
  }
  const wanted = fields.map((name) => {
    const found = layout.get(name);
    if (!found) throw new Error(`DBF에 ${name} 필드가 없다`);
    return [name, found[0], found[1]] as const;
  });

  for (let i = 0; i < count; i++) {
    const start = headerLength + i * recordLength;
    const row: Record<string, string> = {};
    for (const [name, o, l] of wanted) {
      row[name] = decode(buf.subarray(start + o, start + o + l)).trim();
    }
    yield row;
  }
}
