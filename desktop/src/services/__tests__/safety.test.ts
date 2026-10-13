import { describe, it, expect } from 'vitest';
import { computeFinalEQ } from '../eqDecisionEngine';
import { type EQLayer } from '../eqDecisionEngine';

describe('Safety Clamp', () => {
  const neutralLayer: EQLayer = { source: 'none', gains: new Array(31).fill(0), confidence: 0 };

  it('clamps upper bound to +6 dB', () => {
    const highLayer: EQLayer = { source: 'test', gains: new Array(31).fill(12), confidence: 1 };
    const decision = computeFinalEQ(highLayer, neutralLayer, neutralLayer, neutralLayer, neutralLayer);
    expect(decision.finalGains[0]).toBe(6);
  });

  it('clamps lower bound to -12 dB', () => {
    const lowLayer: EQLayer = { source: 'test', gains: new Array(31).fill(-20), confidence: 1 };
    const decision = computeFinalEQ(lowLayer, neutralLayer, neutralLayer, neutralLayer, neutralLayer);
    expect(decision.finalGains[0]).toBe(-12);
  });
});
