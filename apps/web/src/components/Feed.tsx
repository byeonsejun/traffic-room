'use client';

import { useMemo } from 'react';
import type { Incident } from '@traffic-room/shared';
import { CATEGORY_LABEL, categoryColor } from '@/lib/tokens';
import { hhmm } from '@/lib/time';
import { incidentTitle as title, tidy } from '@/lib/incident';
import { useConsole, type FeedItem } from '@/store/console';

const RECENT_MAX = 8;

const subtitle = (i: Incident) => tidy(i.lanesBlocked) || tidy(i.detail) || CATEGORY_LABEL[i.category];

function Card({ item, selected, onPick }: { item: FeedItem; selected: boolean; onPick?: () => void }) {
  const { incident: i, kind, fresh } = item;
  const cleared = kind === 'cleared';
  const when = cleared ? item.at : i.startedAt ?? item.at;
  // 공사는 오래 이어지는 상황이라 새로 들어와도 등장 연출을 하지 않는다.
  const loud = fresh && i.category !== 'construction';
  const cls = `ev${cleared ? ' is-cleared' : ''}${loud ? ' is-new' : ''}`;
  const body = (
    <>
      <span className="k" style={{ background: categoryColor(i.category) }} aria-hidden="true" />
      <span className="txt">
        <span className="t1">{title(i)}</span>
        <span className="t2">
          {cleared && <span className="tag">해제</span>}
          {subtitle(i)}
        </span>
      </span>
      <time className="tm" dateTime={when}>{hhmm(when)}</time>
    </>
  );
  if (cleared || !onPick) return <li className={cls}>{body}</li>;
  return (
    <li>
      <button type="button" className={cls} aria-pressed={selected} onClick={onPick}>
        {body}
      </button>
    </li>
  );
}

export function Feed() {
  const feed = useConsole((s) => s.feed);
  const incidents = useConsole((s) => s.incidents);
  const selectedKey = useConsole((s) => s.selectedKey);
  const select = useConsole((s) => s.select);

  // 지금 진행 중인 상황 가운데 최근에 시작된 것. 실시간으로 받은 것이 있으면 그 아래를 채워서,
  // 첫 이벤트가 도착하는 순간 목록이 한 줄로 줄어들지 않게 한다. 위에 이미 있는 상황은 빼고,
  // 합쳐서 RECENT_MAX 건이 될 때까지만 채운다.
  const recent = useMemo<FeedItem[]>(() => {
    const room = RECENT_MAX - feed.length;
    if (room <= 0) return [];
    const shown = new Set(feed.map((f) => f.incident.key));
    return Object.values(incidents)
      .filter((i) => i.startedAt && i.category !== 'construction' && i.category !== 'other' && !shown.has(i.key))
      .sort((a, b) => Date.parse(b.startedAt!) - Date.parse(a.startedAt!))
      .slice(0, room)
      .map((incident) => ({ id: 0, kind: 'arrived', incident, at: incident.startedAt!, fresh: false }));
  }, [feed, incidents]);

  const live = feed.length > 0;
  const card = (it: FeedItem, key: string) => (
    <Card
      key={key}
      item={it}
      selected={it.kind === 'arrived' && it.incident.key === selectedKey}
      onPick={it.kind === 'arrived' && incidents[it.incident.key] ? () => select(it.incident.key) : undefined}
    />
  );

  return (
    <section className="feed" aria-labelledby="feed-title">
      <h2 id="feed-title">{live ? '방금 들어온 상황' : '최근 시작된 상황'}</h2>
      {!live && recent.length === 0 ? (
        <p className="feed-empty">새 상황이 들어오면 여기에 차례로 쌓여요.</p>
      ) : (
        <div className="feed-scroll">
          <ul>
            {live ? feed.map((it) => card(it, `${it.id}`)) : recent.map((it) => card(it, it.incident.key))}
          </ul>
          {live && recent.length > 0 && (
            <>
              <h3 className="feed-sub">그 전에 시작된 상황</h3>
              <ul>{recent.map((it) => card(it, it.incident.key))}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
