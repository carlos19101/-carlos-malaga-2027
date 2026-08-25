import { describe, expect, it } from 'vitest';
import { buildDecisionJournal } from './decisionJournal.js';

function row(date, timestamp, values = {}, source = 'Agent Garmin') {
  return {
    Date: date,
    Timestamp: timestamp,
    RHR_bpm: values.rhr ?? '',
    HRV_night_ms: values.hrv ?? '',
    Sleep_min: values.sleepMinutes ?? '',
    Sleep_score: values.sleepScore ?? '',
    BodyBattery_gain: values.bodyBatteryGain ?? '',
    Readiness_Garmin: values.readiness ?? '',
    Pain_0_10: values.pain ?? '',
    DOMS_0_10: values.doms ?? '',
    Fatigue_0_10: values.fatigue ?? '',
    Coach_Status: values.status ?? '',
    Coach_Decision: values.decision ?? '',
    BodyBattery_current: values.bodyBattery ?? '',
    Source: source,
  };
}

describe('buildDecisionJournal', () => {
  it('buduje chronologię od najnowszej decyzji', () => {
    const result = buildDecisionJournal([
      row('2026-08-24', '2026-08-24 08:00', { status: 'YELLOW', decision: 'Recovery' }, 'Head Coach'),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(result.entries.map(({ date, status }) => [date, status])).toEqual([
      ['2026-08-25', 'GREEN'], ['2026-08-24', 'YELLOW'],
    ]);
  });

  it('cytuje tylko dowody dostępne najpóźniej w chwili decyzji', () => {
    const result = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00', { hrv: 60 }),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
      row('2026-08-25', '2026-08-25 10:00', { hrv: 90 }),
    ]);
    expect(result.entries[0].evidence).toContainEqual(expect.objectContaining({ field: 'hrv', value: 60 }));
  });

  it('rozróżnia sekundy przy wyborze najnowszego dowodu', () => {
    const result = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00:05', { hrv: 60 }),
      row('2026-08-25', '2026-08-25 08:00:45', { hrv: 69 }),
      row('2026-08-25', '2026-08-25 09:00:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(result.entries[0].evidence).toContainEqual(expect.objectContaining({ field: 'hrv', value: 69 }));
  });

  it('przy remisie czasu preferuje Garmin dla fizjologii i User dla odczuć', () => {
    const result = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00', { hrv: 60, pain: 3 }, 'User'),
      row('2026-08-25', '2026-08-25 08:00', { hrv: 69, pain: 0 }, 'Agent Garmin'),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(result.entries[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'hrv', value: 69 }),
      expect.objectContaining({ field: 'pain', value: 3 }),
    ]));
  });

  it('nie wybiera arbitralnie sprzecznego remisu', () => {
    const result = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00', { hrv: 60 }),
      row('2026-08-25', '2026-08-25 08:00', { hrv: 69 }),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(result.entries[0].evidence.some(({ field }) => field === 'hrv')).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'ambiguous-evidence-hrv' }));
  });

  it('odrzuca dowód poza kontraktem i zachowuje decyzję', () => {
    const result = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00', { rhr: 300 }),
      row('2026-08-25', '2026-08-25 09:00', { status: 'YELLOW', decision: 'Modify' }, 'Head Coach'),
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].evidence).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'invalid-evidence-rhr' }));
  });

  it('pomija zwykłe rekordy i respektuje limit', () => {
    const result = buildDecisionJournal([
      row('2026-08-23', '2026-08-23 08:00', { hrv: 60 }),
      row('2026-08-24', '2026-08-24 08:00', { decision: 'A' }, 'Head Coach'),
      row('2026-08-25', '2026-08-25 08:00', { decision: 'B' }, 'Head Coach'),
    ], { limit: 1 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].recommendation).toBe('B');
  });

  it('raportuje decyzję bez daty', () => {
    const result = buildDecisionJournal([row('', '2026-08-25 08:00', { decision: 'B' }, 'Head Coach')]);
    expect(result.entries).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'undated-decision', severity: 'error' }));
  });
});
