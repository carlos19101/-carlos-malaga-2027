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

  it('uznaje zapis z wieloetapowym celem HR bez wymuszania fałszywego jednego zakresu', () => {
    expect(tcxDataStatus({
      targetStages: JSON.stringify({ schema: 'carlos.hr-target-stages.v1', stages: [
        { name: 'WU', durationSeconds: 600, min: 135, max: 145 },
        { name: 'CD', durationSeconds: 480, max: 150 },
      ] }),
      timeInTarget: 900,
      timeAboveTarget: 120,
      timeBelowTarget: 60,
      analyzedDuration: 1080,
    })).toMatchObject({ complete: true, validTarget: true, targetMode: 'staged' });
  });

  it('uznaje etapy dystansowe za cel HR, gdy atomy są kompletne', () => {
    expect(tcxDataStatus({
      targetStages: JSON.stringify({ schema: 'carlos.hr-target-stages.v2', basis: 'distance', stages: [
        { name: 'WU', distanceMeters: 1000, min: 135, max: 145 },
        { name: 'Easy', distanceMeters: 3000, min: 145, max: 158 },
        { name: 'CD', distanceMeters: 1000, max: 150 },
      ] }),
      timeInTarget: 1770,
      timeAboveTarget: 160,
      timeBelowTarget: 74,
      analyzedDuration: 2004,
    })).toMatchObject({ complete: true, validTarget: true, targetMode: 'staged' });
  });
});
