import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  const t = setInterval(onChange, 1000);
  return () => clearInterval(t);
};
const currentSecond = () => Math.floor(Date.now() / 1000);
// 서버 렌더와 첫 하이드레이션에서는 비워 두어(null) 서버와 브라우저 시각이 어긋나지 않게 한다.
const noSecond = () => null;

/** 1초마다 바뀌는 지금 시각(유닉스 초). 서버 렌더 · 첫 하이드레이션에서는 null. 시계 · 남은 시간 표시가 같이 쓴다. */
export function useSeconds(): number | null {
  return useSyncExternalStore(subscribe, currentSecond, noSecond);
}
