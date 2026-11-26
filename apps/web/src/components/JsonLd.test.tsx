import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { JsonLd } from './JsonLd';

test('escapes < so a value cannot close the script early', () => {
  const html = renderToStaticMarkup(<JsonLd data={{ name: 'a</script>' }} />);
  expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
  expect(html.match(/<\/script>/g)).toHaveLength(1);
  expect(html.endsWith('</script>')).toBe(true);
  expect(html).toContain('a\\u003c/script>');
});
