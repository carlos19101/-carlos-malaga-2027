import { describe, expect, it } from 'vitest';
import { computeLoadMap, LOAD_MAP_CONTRACTS, parseSessionMinutes } from './loadMap.js';

describe('parseSessionMinutes', () => {
  it('odróżnia mm:ss od hh:mm:ss', () => {
    expect(parseSessionMinutes('51:39')).toBeCloseTo(51.65, 8);
    expect(parseSessionMinutes('1:20:30')).toBeCloseTo(80.5, 8);
  });
});

describe('computeLoadMap', () => {
  const rows = [
    { date: '2026-08-18', type: 'Bieg', name: 'Easy', km: '4', duration: '32:00', rpe: 2, srpe: 64 },
    { date: '2026-08-20', type: 'Siła', name: 'Nogi', duration: '45:00', rpe: 4, srpe: 180 },
    { date: '2026-08-23', type: 'Bieg', name: 'Easy long', km: '6', duration: '48:00', rpe: 2, srpe: 96 },
    { date: '2026-08-24', type: 'Boks', name: 'Technika', duration: '60:00', rpe: 3, srpe: 180 },
    { date: '2026-08-25', type: 'Mobilizacja', name: 'Mobilizacja po biegu', duration: '20:00', rpe: 1, srpe: 20 },
    { date: '2026-08-25', type: 'Bieg', name: 'Easy base', km: '6,8', duration: '51:39', rpe: 2, srpe: 103, pain: 0, legFatigue: 2 },
  ];

  it('liczy osie niezależnie bez jednej liczby Master Load', () => {
    const result = computeLoadMap(rows, '2026-08-25');
    expect(result.running).toMatchObject({ km7: 12.8, km28: 16.8, count7: 2, count28: 3, averageDistance7: 6.4 });
    expect(result.longRun).toMatchObject({ latestKm: 6, longest7Km: 6.8, longest30Km: 6.8, share7Pct: 46.88 });
    expect(result.sessionSpike).toMatchObject({ currentKm: 6.8, referenceKm: 6, valuePct: 13.33, state: 'calibrating', confidence: 'partial-history' });
    expect(result.systemic).toMatchObject({ boxing7: 1, strength7: 1, mobility7: 1 });
    expect(result.mechanical).toMatchObject({ pain: 0, legFatigue: 2, state: 'observed' });
  });

  it('RPE zero nie zamienia ukończonej sesji w zerowe obciążenie', () => {
    const result = computeLoadMap([
      { date: '2026-08-25', type: 'Bieg', km: 6.8, duration: '51:39', rpe: 0, srpe: 0 },
      { date: '2026-08-24', type: 'Recovery', km: '', duration: '', rpe: 0, srpe: 0 },
    ], '2026-08-25');
    expect(result.internal).toMatchObject({ srpe7: 0, rpeZeroSessions7: 1, state: 'unreliable', state28: 'unreliable' });
  });

  it('niewiarygodne RPE w chronicznym oknie blokuje jakość 28d nawet poza ostatnim tygodniem', () => {
    const result = computeLoadMap([
      { date: '2026-08-10', type: 'Bieg', km: 6, duration: '45:00', rpe: 0, srpe: 0 },
      { date: '2026-08-25', type: 'Recovery', km: '', duration: '', rpe: 0, srpe: 0 },
    ], '2026-08-25');
    expect(result.internal).toMatchObject({ state: 'missing', state28: 'unreliable', rpeZeroSessions28: 1 });
  });

  it('nie pokazuje spike bez wcześniejszego punktu odniesienia', () => {
    const result = computeLoadMap([
      { date: '2026-08-25', type: 'Bieg', km: 6.8, duration: '51:39', rpe: 2, srpe: 103 },
    ], '2026-08-25');
    expect(result.sessionSpike).toMatchObject({ valuePct: null, state: 'no-reference', confidence: 'none' });
  });

  it('nie pokazuje ujemnego zera przy praktycznie identycznym dystansie', () => {
    const result = computeLoadMap([
      { date: '2026-08-23', type: 'Bieg', km: 6.80067, duration: '50:00', rpe: 2, srpe: 100 },
      { date: '2026-08-25', type: 'Bieg', km: 6.8, duration: '50:00', rpe: 2, srpe: 100 },
    ], '2026-08-25');
    expect(result.sessionSpike.valuePct).toBe(0);
    expect(Object.is(result.sessionSpike.valuePct, -0)).toBe(false);
  });

  it('pełne 30 dni historii kończy kalibrację bez progu liczby treningów', () => {
    const result = computeLoadMap([
      { date: '2026-07-27', type: 'Bieg', km: 5, duration: '40:00', rpe: 2, srpe: 80 },
      { date: '2026-08-25', type: 'Bieg', km: 6, duration: '45:00', rpe: 2, srpe: 90 },
    ], '2026-08-25');
    expect(result.sessionSpike).toMatchObject({ valuePct: 20, historyDays: 30, state: 'ready', confidence: 'full-history' });
  });

  it('jawnie odmawia wyliczenia rozkładu intensywności bez danych strefowych', () => {
    expect(computeLoadMap(rows, '2026-08-25').intensity).toMatchObject({ state: 'not-computable' });
  });

  it('publikuje kontrakty danych i wymagania historii', () => {
    expect(LOAD_MAP_CONTRACTS.sessionSpike).toMatchObject({ windowDays: 30, calibration: 'HISTORIA CZĘŚCIOWA' });
    expect(LOAD_MAP_CONTRACTS.internalLoad.required).toEqual(['date', 'duration', 'rpe']);
  });

  it('nie klasyfikuje mobilizacji jako siły', () => {
    const result = computeLoadMap([
      { date: '2026-08-25', type: 'Mobilizacja', name: 'Lekka mobilność', duration: '45:00', rpe: 1, srpe: 45 },
    ], '2026-08-25');

    expect(result.systemic).toMatchObject({ boxing7: 0, strength7: 0, mobility7: 1, state: 'observed' });
  });
});
