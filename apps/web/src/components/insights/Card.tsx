import type { ReactNode } from 'react';

export type LoadStatus = 'loading' | 'ok' | 'error';

/**
 * 분석 카드 틀. 제목 줄 오른쪽에 "표로 보기"가 붙는다(카드가 기준 위치).
 * 기록이 없으면 그림 자리에 같은 높이로 이유를 적어 화면이 출렁이지 않게 한다.
 */
export function Card({ id, title, note, className, status, empty, height, children }: {
  id: string;
  title: string;
  note?: ReactNode;
  className: string;
  status: LoadStatus;
  /** 받았는데 그릴 기록이 없을 때 */
  empty: boolean;
  height: number;
  children: ReactNode;
}) {
  // 실패는 위 띠가 한 번만 알린다. 카드마다 되풀이하지 않는다.
  const message = status === 'ok' && empty ? '아직 기록이 없어요' : null;
  return (
    <section className={`ins-card ${className}`} aria-labelledby={id}>
      <header className="ins-card-head">
        <h3 id={id}>{title}</h3>
        {note && <p>{note}</p>}
      </header>
      {status === 'ok' && !empty ? children : (
        <div className="ins-empty" style={{ height }}>{message}</div>
      )}
    </section>
  );
}
