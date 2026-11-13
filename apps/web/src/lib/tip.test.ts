import { expect, test } from 'vitest';
import { tipSpot } from './tip';

const box = { width: 800, height: 600 };
const size = { width: 160, height: 40 };

test('sits centred above the point with a gap', () => {
  expect(tipSpot({ x: 400, y: 300 }, size, box)).toEqual({ left: 320, top: 248, below: false });
});

test('is pushed inside the left and right edges', () => {
  expect(tipSpot({ x: 20, y: 300 }, size, box).left).toBe(8);
  expect(tipSpot({ x: 790, y: 300 }, size, box).left).toBe(800 - 8 - 160);
});

test('flips below when there is no room above', () => {
  expect(tipSpot({ x: 400, y: 30 }, size, box)).toEqual({ left: 320, top: 42, below: true });
});

test('stays above when there is no room below either', () => {
  expect(tipSpot({ x: 400, y: 30 }, size, { width: 800, height: 70 }).below).toBe(false);
});

test('a tooltip wider than the box starts at the left edge', () => {
  expect(tipSpot({ x: 50, y: 300 }, { width: 900, height: 40 }, box).left).toBe(8);
});

test('with no room above or below it never starts above the box top', () => {
  expect(tipSpot({ x: 400, y: 30 }, size, { width: 800, height: 70 }).top).toBe(8);
});
