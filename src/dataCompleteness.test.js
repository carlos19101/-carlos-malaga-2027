import { describe, expect, it } from 'vitest';
import { computeDataCompleteness } from './dataCompleteness.js';

describe('computeDataCompleteness', () => {
  it('nie uznaje RPE 0 za kompletną ocenę ukończonego biegu', () => {
    const result = computeDataCompleteness({
      dailyState: 'calibrating', calibrationDays: '8/28', sourceOk: true,
      runs: [
        { feedbackComplete: true, meaningfulRpe: true, tcxRequired: true, tcxComplete: true },
        { feedbackComplete: true, meaningfulRpe: false, tcxRequired: true, tcxComplete: false },
      ],
    });
    expect(result.calibration).toEqual({ state: 'calibrating', progress: '8/28' });
    expect(result.feedback).toEqual({ complete: 1, total: 2, missing: 1 });
    expect(result.tcx).toEqual({ complete: 1, total: 2, missing: 1 });
  });

  it('nie wymaga TCX, gdy bieg nie ma zleconego zakresu HR', () => {
    const result = computeDataCompleteness({
      dailyState: 'ready', sourceOk: false,
      runs: [{ feedbackComplete: true, meaningfulRpe: true, tcxRequired: false, tcxComplete: false }],
    });
    expect(result.calibration.progress).toBe('GOTOWE');
    expect(result.tcx).toEqual({ complete: 0, total: 0, missing: 0 });
    expect(result.source).toBe('attention');
  });
});
