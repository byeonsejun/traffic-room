// 표준노드링크 좌표계(GRS80 중부원점 TM)를 경위도로 바꾼다. Snyder 역변환식.
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const LON0 = (127 * Math.PI) / 180;
const LAT0 = (38 * Math.PI) / 180;
const K0 = 1.0;
const FE = 200000.0;
const FN = 600000.0;

const E4 = E2 * E2;
const E6 = E4 * E2;
const C0 = 1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;

function meridianArc(phi: number): number {
  return (
    A *
    (C0 * phi -
      ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * phi) +
      ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * phi) -
      ((35 * E6) / 3072) * Math.sin(6 * phi))
  );
}

const M0 = meridianArc(LAT0);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

export function tmToLonLat(x: number, y: number): [number, number] {
  const m = M0 + (y - FN) / K0;
  const mu = m / (A * C0);
  const p1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1);
  const c1 = EP2 * Math.cos(p1) ** 2;
  const t1 = Math.tan(p1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const d = (x - FE) / (n1 * K0);
  const lat =
    p1 -
    ((n1 * Math.tan(p1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    LON0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
      Math.cos(p1);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
