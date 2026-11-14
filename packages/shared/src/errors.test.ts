import { expect, test } from 'vitest';
import { errorCode } from './errors.ts';

test('errorCode keeps a string code or the error name, never the message', () => {
  expect(errorCode(Object.assign(new Error('postgres://u:secret@h/db'), { code: '22P02' }))).toBe('22P02');
  expect(errorCode(new TypeError('postgres://u:secret@h/db'))).toBe('TypeError');
  expect(errorCode({ code: 42 })).toBe('unknown');
  expect(errorCode(null)).toBe('unknown');
});
