import { describe, expect, it } from 'vitest';
import { progressDomain } from './progressChart.js';

describe('progress chart display range', () => {
  it('uses observations and the distance target, not a zero baseline', () => {
    expect(progressDomain([10, 12, 15.01], 18)).toEqual({ min: 8, max: 18, ticks: [8, 13, 18] });
  });
  it('includes the time target below slower results', () => {
    const domain = progressDomain([55, 51], 47.5);
    expect(domain.min).toBeLessThanOrEqual(47.5);
    expect(domain.max).toBeGreaterThanOrEqual(55);
  });
  it('includes results beyond the goal', () => {
    const domain = progressDomain([15, 22], 18);
    expect(domain.max).toBeGreaterThanOrEqual(22);
    expect(domain.ticks).toHaveLength(3);
  });
  it('keeps a non-zero range for equal or missing observations', () => {
    for (const domain of [progressDomain([18, 18], 18), progressDomain([], 18), progressDomain([null, NaN], NaN)]) {
      expect(domain.max).toBeGreaterThan(domain.min);
      expect(domain.ticks.every(Number.isFinite)).toBe(true);
    }
  });
});
