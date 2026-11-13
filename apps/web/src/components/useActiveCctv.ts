import { useMemo } from 'react';
import type { Cctv } from '@traffic-room/shared';
import { pickCctvs } from '@/lib/cctv';
import { useConsole } from '@/store/console';

/** 지금 CCTV 패널이 트는 CCTV(와 후보). 패널과 지도가 함께 쓴다. */
export function useActiveCctv(cctvs: Cctv[]) {
  const incident = useConsole((s) => (s.selectedKey ? s.incidents[s.selectedKey] : undefined));
  const cctvId = useConsole((s) => s.cctvId);
  return useMemo(() => pickCctvs(cctvs, incident, cctvId), [cctvs, incident, cctvId]);
}
