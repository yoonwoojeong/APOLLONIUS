import { expect, test } from 'vitest';
import { mergeStars, scoreStars } from '../../../src/reasoning/stars';

test('scoreStars({L:4,E:6},{L:4,E:4}) → [true,true,false]', () => {
  expect(scoreStars({ L: 4, E: 6 }, { L: 4, E: 4 })).toEqual([true, true, false]);
});

test('mergeStars keeps best per star', () => {
  expect(mergeStars([true, false, true], [true, true, false])).toEqual([true, true, true]);
});
