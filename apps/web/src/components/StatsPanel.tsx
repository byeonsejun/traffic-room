'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '@traffic-room/shared';
import { CATEGORY_LABEL, categoryColor } from '@/lib/tokens';
import { hhmm } from '@/lib/time';
import { useConsole } from '@/store/console';

const BUMP_MS = 1200;
const ORDER = Object.keys(CATEGORY_LABEL) as Category[];

export function StatsPanel({ arrivalId, collectedAt }: { arrivalId?: number; collectedAt: string | null }) {
  const incidents = useConsole((s) => s.incidents);
  const list = useMemo(() => Object.values(incidents), [incidents]);

  const rows = useMemo(() => {
    const n = Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<Category, number>;
    for (const i of list) n[i.category] += 1;
    return ORDER.map((c) => ({ c, n: n[c] })).sort((a, b) => b.n - a.n);
  }, [list]);
  const max = Math.max(1, ...rows.map((r) => r.n));

  // 새 상황이 도착하면 숫자가 잠깐 붉어진다.
  // 타이머는 새 도착이나 언마운트 때만 지운다. 도착 직후 해제가 feed[0] 이 되어 arrivalId 가
  // undefined 로 바뀌어도 1.2초 뒤에는 반드시 원래 색으로 돌아온다.
  const [bump, setBump] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (arrivalId === undefined) return;
    setBump(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBump(false), BUMP_MS);
  }, [arrivalId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <section className="kpi" aria-labelledby="kpi-title">
        <h2 id="kpi-title">진행 중인 돌발상황</h2>
        <p className={`count${bump ? ' is-bump' : ''}`} aria-live="polite">
          {list.length}
          <small>건</small>
        </p>
      </section>
      <section className="types" aria-labelledby="types-title">
        <h2 id="types-title">유형별</h2>
        <ul>
          {rows.map(({ c, n }) => (
            <li key={c} className={`trow${n === 0 ? ' is-zero' : ''}`}>
              <span className="name">{CATEGORY_LABEL[c]}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${n ? Math.max(2, (n / max) * 100) : 0}%`, background: categoryColor(c) }} />
              </span>
              <span className="n">{n}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="about">
        공공 교통 정보를 약 1시간 늦춰, 일어난 순서대로 다시 보여 줘요.
        {collectedAt && <> 마지막 수집은 {hhmm(collectedAt)}이에요.</>}
      </p>
    </>
  );
}
