import type { Map as MlMap } from 'maplibre-gl';
import { logFailure } from './log';

/** 실패한 타일을 다시 부탁하기까지 기다리는 시간. 세 번까지 점점 길게. */
export const TILE_RETRY_DELAYS = [1000, 4000, 15000];

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
  const tries = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const keyOf = (sourceId: string, t: { z: number; x: number; y: number }) => `${sourceId}/${t.z}/${t.x}/${t.y}`;

  const onError = (e: TileEvent) => {
    const t = e.tile?.tileID?.canonical;
    if (!t || !e.sourceId) return logFailure('map', e.error);
    if (e.error instanceof Error && e.error.name === 'AbortError') return;
    const sourceId = e.sourceId;
    const key = keyOf(sourceId, t);
    const n = tries.get(key) ?? 0;
    if (n >= TILE_RETRY_DELAYS.length) {
      if (n === TILE_RETRY_DELAYS.length) logFailure('map-tile', e.error);
      tries.set(key, n + 1);
      return;
    }
    tries.set(key, n + 1);
    const timer = setTimeout(() => {
      timers.delete(timer);
      try {
        map.refreshTiles(sourceId, [{ z: t.z, x: t.x, y: t.y }]);
      } catch {
        // 그 사이 소스가 사라졌으면(지도를 다시 만듦) 할 일이 없다.
      }
    }, TILE_RETRY_DELAYS[n]);
    timers.add(timer);
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
  };
}
