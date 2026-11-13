/** 상태 색의 뜻. 색만으로 알리지 않도록 원활 · 서행 · 정체를 글자로 함께 둔다. */
export function StatusLegend({ ranges = true }: { ranges?: boolean }) {
  const items = [
    { name: '원활', range: '70 이상', color: 'var(--flow)' },
    { name: '서행', range: '40–70', color: 'var(--slow)' },
    { name: '정체', range: '40 미만', color: 'var(--jam)' },
  ];
  return (
    <ul className="status-legend" aria-label="속도 단계">
      {items.map((i) => (
        <li key={i.name}>
          <i style={{ background: i.color }} aria-hidden="true" />
          {i.name}{ranges && <small>{i.range}</small>}
        </li>
      ))}
    </ul>
  );
}
