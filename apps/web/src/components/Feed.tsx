'use client';

import { useMemo } from 'react';
import type { Incident } from '@traffic-room/shared';
import { CATEGORY_LABEL, categoryColor } from '@/lib/tokens';
import { hhmm } from '@/lib/time';
import { useConsole, type FeedItem } from '@/store/console';

const RECENT_MAX = 8;

/** 원본 문구의 "** … **" 장식과 겹친 공백을 걷어 낸다. */
const tidy = (s: string) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

const title = (i: Incident) => `${i.roadName} ${tidy(i.message) || i.detail}`.trim();
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

  // 실시간으로 받은 것이 아직 없으면, 지금 진행 중인 상황 가운데 최근에 시작된 것을 보여 준다.
  const recent = useMemo<FeedItem[]>(() => {
    if (feed.length) return [];
    return Object.values(incidents)
      .filter((i) => i.startedAt && i.category !== 'construction' && i.category !== 'other')
      .sort((a, b) => Date.parse(b.startedAt!) - Date.parse(a.startedAt!))
      .slice(0, RECENT_MAX)
      .map((incident) => ({ id: 0, kind: 'arrived', incident, at: incident.startedAt!, fresh: false }));
  }, [feed.length, incidents]);

  const live = feed.length > 0;
  const items = live ? feed : recent;

  return (
    <section className="feed" aria-labelledby="feed-title">
      <h2 id="feed-title">{live ? '방금 들어온 상황' : '최근 시작된 상황'}</h2>
      {items.length === 0 ? (
        <p className="feed-empty">새 상황이 들어오면 여기에 차례로 쌓여요.</p>
      ) : (
        <ul>
          {items.map((it) => (
            <Card
              key={live ? `${it.id}` : it.incident.key}
              item={it}
              selected={it.kind === 'arrived' && it.incident.key === selectedKey}
              onPick={it.kind === 'arrived' && incidents[it.incident.key] ? () => select(it.incident.key) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
