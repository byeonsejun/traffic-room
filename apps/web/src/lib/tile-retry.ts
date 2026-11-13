import type { Map as MlMap } from 'maplibre-gl';

/** 실패한 타일을 다시 부탁하기까지 기다리는 시간. 세 번까지 점점 길게. */
export const TILE_RETRY_DELAYS = [1000, 4000, 15000];
/** 세 번 다 실패한 타일도 이만큼 지나면 다시 세 번 시도할 수 있다(긴 장애 뒤 회복). */
export const TILE_RETRY_COOLDOWN_MS = 60_000;

type TileEvent = {
  error?: unknown;
  sourceId?: string;
  tile?: { tileID?: { canonical?: { z: number; x: number; y: number } } };
};

/**
 * 받다가 실패한 타일을 잠시 뒤 다시 부탁한다. MapLibre 는 실패한 타일을 'errored' 로 두고 다시 받지 않아서,
 * 바탕 지도(OpenFreeMap) 요청이 잠깐 실패하면 그 칸이 캐시에서 빠질 때까지 빈 사각형으로 남았다.
 * 지도를 옮겨 요청이 취소된 경우(AbortError)는 건드리지 않고, 타일과 상관없는 지도 오류는 그대로 로그에 남긴다
 * ('error' 리스너가 하나라도 있으면 MapLibre 가 스스로 console.error 하지 않는다).
 */
export function retryFailedTiles(map: Pick<MlMap, 'on' | 'off' | 'refreshTiles'>): () => void {
  // 타일마다 시도 횟수와, 대기 중인 재시도가 있는지. 다 쓰면 식힌 뒤 지워서 다시 세고, 계속 쌓이지 않게 한다.
  const tries = new Map<string, { n: number; pending: boolean }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const keyOf = (sourceId: string, t: { z: number; x: number; y: number }) => `${sourceId}/${t.z}/${t.x}/${t.y}`;
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const refresh = (sourceId: string, t: { z: number; x: number; y: number }) => {
    try {
      map.refreshTiles(sourceId, [{ z: t.z, x: t.x, y: t.y }]);
    } catch {
      // 그 사이 소스가 사라졌으면(지도를 다시 만듦) 할 일이 없다.
    }
  };

  const onError = (e: TileEvent) => {
    const t = e.tile?.tileID?.canonical;
    // 타일과 상관없는 오류는 MapLibre 가 하던 대로 통째로 남긴다(지도 오류에는 비밀값이 섞이지 않는다).
    if (!t || !e.sourceId) return console.error('[map]', e.error);
    if (e.error instanceof Error && e.error.name === 'AbortError') return;
    const sourceId = e.sourceId;
    const key = keyOf(sourceId, t);
    const entry = tries.get(key) ?? { n: 0, pending: false };
    tries.set(key, entry);
    if (entry.pending) return;
    if (entry.n >= TILE_RETRY_DELAYS.length) {
      if (entry.n === TILE_RETRY_DELAYS.length) {
        console.error(`[map-tile] ${key} 다시 받기 ${entry.n}번 실패`);
        entry.n += 1;
        // 식힌 뒤 횟수를 지우고 한 번 더 부탁한다. 또 실패하면 오류가 다시 와서 처음부터 센다.
        later(() => {
          tries.delete(key);
          refresh(sourceId, t);
        }, TILE_RETRY_COOLDOWN_MS);
      }
      return;
    }
    entry.pending = true;
    later(() => {
      entry.pending = false;
      refresh(sourceId, t);
    }, TILE_RETRY_DELAYS[entry.n]!);
    entry.n += 1;
  };
  // 다시 받아지면 다음 실패 때 처음부터 세 번 시도할 수 있게 지운다.
  const onData = (e: TileEvent) => {
    const t = e.tile?.tileID?.canonical;
    if (t && e.sourceId) tries.delete(keyOf(e.sourceId, t));
  };

  map.on('error', onError as never);
  map.on('sourcedata', onData as never);
  return () => {
    map.off('error', onError as never);
    map.off('sourcedata', onData as never);
    timers.forEach(clearTimeout);
    timers.clear();
    tries.clear();
  };
}
