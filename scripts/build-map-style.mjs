// OpenFreeMap dark 스타일을 받아 상황실 팔레트로 색만 바꾼 뒤 정적 파일로 저장한다.
// 한 번 실행해 나온 apps/web/public/map-style.json 을 커밋하고, 이후에는 그 파일만 쓴다.
//   node scripts/build-map-style.mjs
import { writeFileSync } from 'node:fs';

const SRC = 'https://tiles.openfreemap.org/styles/dark';
const OUT = new URL('../apps/web/public/map-style.json', import.meta.url);

const C = {
  background: '#0C131D', water: '#0A1018', land: '#101A27',
  road: '#16212F', highway: '#1F2F45', label: '#7C8A9B', halo: '#0C131D', line: '#1D2A3A',
};

const res = await fetch(SRC);
if (!res.ok) throw new Error(`스타일을 받지 못했습니다: HTTP ${res.status}`);
const style = await res.json();

const DROP = /building|poi|aeroway|oneway/;
const set = (l, group, prop, value) => {
  l[group] ??= {};
  l[group][prop] = value;
};

// 질감 래스터(ne2_shaded)와 패턴은 팔레트를 깨뜨리므로 쓰지 않는다.
style.layers = style.layers.filter((l) => l.type !== 'raster');
for (const [id, src] of Object.entries(style.sources)) if (src.type === 'raster') delete style.sources[id];
style.layers = style.layers.filter((l) => !DROP.test(l.id) && !DROP.test(l['source-layer'] ?? ''));

for (const l of style.layers) {
  const sl = l['source-layer'];
  if (l.type === 'background') set(l, 'paint', 'background-color', C.background);
  else if (l.type === 'fill') {
    set(l, 'paint', 'fill-color', sl === 'water' ? C.water : C.land);
    delete l.paint['fill-opacity'];
    delete l.paint['fill-pattern'];
  } else if (l.type === 'line') {
    if (sl === 'water' || sl === 'waterway') set(l, 'paint', 'line-color', C.water);
    else if (sl === 'boundary') set(l, 'paint', 'line-color', C.line);
    else if (/motorway|major/.test(l.id) && !/casing/.test(l.id)) set(l, 'paint', 'line-color', C.highway);
    else if (/casing/.test(l.id)) set(l, 'paint', 'line-color', C.background);
    else if (/railway/.test(l.id)) set(l, 'paint', 'line-color', C.line);
    else set(l, 'paint', 'line-color', C.road);
  } else if (l.type === 'symbol') {
    set(l, 'paint', 'text-color', C.label);
    set(l, 'paint', 'text-halo-color', C.halo);
    // 대문자 라벨은 쓰지 않는다(디자인 원칙). 원본 스타일의 대문자 변환을 걷어 낸다.
    if (l.layout) delete l.layout['text-transform'];
    if (l.id !== 'highway_name_motorway') {
      set(l, 'layout', 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
    }
  }
}

writeFileSync(OUT, JSON.stringify(style));
console.log(`저장했습니다: ${style.layers.length}개 레이어`);
