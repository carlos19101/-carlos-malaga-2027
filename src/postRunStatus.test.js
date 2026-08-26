import { describe, expect, it } from 'vitest';
import { tcxDataStatus, trainingFeedbackStatus } from './postRunStatus.js';

describe('trainingFeedbackStatus', () => {
  it('uznaje zera za kompletną ocenę, a nie brak danych', () => {
    expect(trainingFeedbackStatus({ rpe: 0, pain: '0', legFatigue: 2 })).toMatchObject({
      complete: true,
      missing: [],
    });
  });

  it('wskazuje brakujące pole oceny', () => {
    expect(trainingFeedbackStatus({ rpe: 2, pain: '', legFatigue: 1 })).toMatchObject({
      complete: false,
      missing: ['pain'],
    });
  });
});

describe('tcxDataStatus', () => {
  it('wymaga kompletnego i sumującego się zestawu atomowego', () => {
    expect(tcxDataStatus({
      targetMin: 145,
      targetMax: 158,
      timeInTarget: 2358,
      timeAboveTarget: 242,
      timeBelowTarget: 17,
      analyzedDuration: 2617,
    }).complete).toBe(true);
  });

  it('nie uznaje niespójnych czasów za zapisany TCX', () => {
    expect(tcxDataStatus({
      targetMin: 145,
      targetMax: 158,
      timeInTarget: 100,
      timeAboveTarget: 20,
      timeBelowTarget: 10,
      analyzedDuration: 150,
    })).toMatchObject({ complete: false, validDuration: false });
  });
});
