'use client';

import { useEffect } from 'react';
import { MapView } from '@/components/MapView';
import { useConsole, type Snapshot } from '@/store/console';

// 임시 마운트: 화면 구성은 Task 10에서 Console 로 바꾼다.
export default function Home() {
  useEffect(() => {
    fetch('/api/snapshot')
      .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
      .then((s) => s && useConsole.getState().applySnapshot(s))
      .catch(() => {});
  }, []);
  return (
    <main style={{ height: '100vh' }}>
      <MapView />
    </main>
  );
}
