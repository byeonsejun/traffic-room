import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { EChart } from './EChart';

// jsdom 에는 canvas 가 없다. ECharts 대신 받은 옵션만 남긴다.
vi.mock('./EChartCanvas', () => ({ default: () => <div data-canvas="" /> }));

afterEach(cleanup);

const table = { columns: ['시각', '평균 속도(km/h)'], rows: [['01:00', 84], ['02:00', 79]] };

test('the chart is one named image and its values open as a table', async () => {
  const { getByRole, queryByRole } = render(
    <EChart option={{}} height={56} ariaLabel="평균 속도 추이" table={table} />,
  );
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(getByRole('img', { name: '평균 속도 추이' }).style.height).toBe('56px');
  expect(queryByRole('table')).toBeNull();

  const toggle = getByRole('button', { name: '표로 보기' });
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const rows = [...getByRole('table').querySelectorAll('tbody tr')].map((r) => r.textContent);
  expect(rows).toEqual(['01:0084', '02:0079']);

  fireEvent.click(getByRole('button', { name: '표 닫기' }));
  expect(queryByRole('table')).toBeNull();
});
