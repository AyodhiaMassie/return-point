import { describe, expect, it } from 'vitest';
import { maximumScroll, restorationTarget, scrollProgress } from '../src/scroll';

describe('scroll geometry', () => {
  it('uses scrollable height, excluding the viewport', () => { expect(maximumScroll(4000, 800)).toBe(3200); });
  it('calculates a percentage from the maximum scroll distance', () => { expect(scrollProgress(1600, 3200)).toBe(.5); });
  it.each([[0, 0], [-10, 0], [1000, 1], [250, .5]])('clamps position %s on a 500px page to %s', (position, expected) => {
    expect(scrollProgress(position, 500)).toBe(expected);
  });
  it('handles short and non-scrollable pages without division by zero', () => {
    expect(maximumScroll(200, 800)).toBe(0);
    expect(scrollProgress(30, 0)).toBe(0);
    expect(restorationTarget(.6, 0)).toBe(0);
  });
  it('adapts a saved proportion to the new layout', () => { expect(restorationTarget(.5, 5000)).toBe(2500); });
  it('rounds to a pixel and clamps invalid ranges', () => {
    expect(restorationTarget(.333, 100)).toBe(33);
    expect(restorationTarget(2, 400)).toBe(400);
    expect(restorationTarget(-1, 400)).toBe(0);
    expect(restorationTarget(.5, -50)).toBe(0);
  });
  it('handles non-finite geometry', () => {
    expect(scrollProgress(NaN, 100)).toBe(0);
    expect(restorationTarget(Infinity, 100)).toBe(0);
    expect(maximumScroll(Infinity, 500)).toBe(0);
  });
});
