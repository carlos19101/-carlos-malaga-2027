import { describe, expect, it } from 'vitest';
import { attachDecisionOutcomes, buildDecisionJournal, verifyDecisionStatus } from './decisionJournal.js';

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

  it('oznacza status albo rekomendację bez pary jako niekompletną decyzję', () => {
    const result = buildDecisionJournal([
      row('2026-08-24', '2026-08-24 08:00', { status: 'YELLOW' }, 'Head Coach'),
      row('2026-08-25', '2026-08-25 08:00', { decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(result.entries).toHaveLength(2);
    expect(result.issues.filter(({ id }) => id.startsWith('incomplete-decision-'))).toHaveLength(2);
    expect(result.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      expect.stringContaining('brak Coach_Decision'),
      expect.stringContaining('brak Coach_Status'),
    ]));
  });

  it('raportuje decyzję bez daty', () => {
    const result = buildDecisionJournal([row('', '2026-08-25 08:00', { decision: 'B' }, 'Head Coach')]);
    expect(result.entries).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'undated-decision', severity: 'error' }));
  });
});

describe('verifyDecisionStatus', () => {
  it('potwierdza zgodny status APP_FEED i Raw_Data z tego samego dnia', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'YELLOW', decision: 'Recovery' }, 'Head Coach'),
    ]);
    expect(verifyDecisionStatus({ date: '2026-08-25', status: 'YELLOW' }, journal.entries)).toMatchObject({ state: 'verified', mismatches: [] });
  });

  it('raportuje błąd przy rozbieżnym statusie źródeł', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'RED', decision: 'Stop' }, 'Head Coach'),
    ]);
    const result = verifyDecisionStatus({ date: '2026-08-25', status: 'GREEN' }, journal.entries);
    expect(result.state).toBe('mismatch');
    expect(result.mismatches[0]).toMatchObject({ field: 'coachStatus', fromFeed: 'GREEN', computed: 'RED', severity: 'error' });
  });

  it('brak decyzji Raw_Data pozostawia jawny stan unverified bez fałszywego alarmu', () => {
    expect(verifyDecisionStatus({ date: '2026-08-25', status: 'GREEN' }, [])).toMatchObject({ state: 'unverified', mismatches: [] });
  });

  it('nie porównuje decyzji z innego dnia', () => {
    const journal = buildDecisionJournal([
      row('2026-08-24', '2026-08-24 09:00', { status: 'RED', decision: 'Stop' }, 'Head Coach'),
    ]);
    expect(verifyDecisionStatus({ date: '2026-08-25', status: 'GREEN' }, journal.entries).state).toBe('unverified');
  });
});

describe('attachDecisionOutcomes', () => {
  it('łączy decyzję z sesją z tego samego dnia i reakcją następnego dnia', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 08:00', { hrv: 60, rhr: 45 }),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [
      { date: '2026-08-25', timestamp: '2026-08-25 18:00', name: 'Easy 6 km', rpe: 2, executionStatus: 'ok' },
    ], [
      { date: '2026-08-26', values: { hrv: 66, rhr: 47 } },
    ], { today: '2026-08-27' });
    expect(result.entries[0].outcome).toMatchObject({
      state: 'observed',
      intent: 'training',
      executionRecord: 'session-recorded',
      sessions: [expect.objectContaining({ name: 'Easy 6 km', executionStatus: 'ok' })],
      reaction: { date: '2026-08-26', hrv: 66, rhr: 47, hrvDelta: 6, rhrDelta: 2 },
    });
    expect(result.outcomeCalibration).toMatchObject({ state: 'calibrating', sample: '1/3' });
  });

  it('nie udaje wyniku, gdy brakuje zapisu sesji lub następnego pomiaru', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'YELLOW', decision: 'Recovery' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome).toMatchObject({ state: 'no-session-recorded', sessions: [], reaction: null });
  });

  it('oznacza dzisiejszą decyzję bez sesji jako pending', () => {
    const journal = buildDecisionJournal([
      row('2026-08-27', '2026-08-27 09:00', { status: 'GREEN', decision: 'Easy' }, 'Head Coach'),
    ]);
    expect(attachDecisionOutcomes(journal, [], [], { today: '2026-08-27' }).entries[0].outcome.state).toBe('pending');
  });

  it('kalibruje się dopiero po trzech zaobserwowanych decyzjach', () => {
    const journal = buildDecisionJournal([
      row('2026-08-23', '2026-08-23 09:00', { status: 'GREEN', decision: 'A' }, 'Head Coach'),
      row('2026-08-24', '2026-08-24 09:00', { status: 'GREEN', decision: 'B' }, 'Head Coach'),
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'C' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [
      { date: '2026-08-23', timestamp: '2026-08-23 18:00' }, { date: '2026-08-24', timestamp: '2026-08-24 18:00' }, { date: '2026-08-25', timestamp: '2026-08-25 18:00' },
    ], [], { today: '2026-08-27' });
    expect(result.outcomeCalibration).toMatchObject({ state: 'ready', sample: '3/3' });
  });

  it('oznacza sesję zapisaną mimo jawnej decyzji o regeneracji bez oceniania jej skutku', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'YELLOW', decision: 'OFF / recovery' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [{ date: '2026-08-25', timestamp: '2026-08-25 18:00', name: 'Easy 6 km' }], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome).toMatchObject({
      state: 'observed', intent: 'recovery', executionRecord: 'session-during-recovery',
    });
  });

  it('oznacza wyłącznie brak zapisu po decyzji treningowej', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy bieg' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome.executionRecord).toBe('training-not-recorded');
  });

  it('nie przypisuje sesji sprzed decyzji jako jej wyniku', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 18:00', { status: 'GREEN', decision: 'Easy bieg' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [
      { date: '2026-08-25', timestamp: '2026-08-25 07:00', name: 'Poranny bieg' },
    ], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome).toMatchObject({
      state: 'session-before-decision', sessions: [], preDecisionSessions: [expect.objectContaining({ name: 'Poranny bieg' })],
    });
  });

  it('nie liczy sesji bez godziny jako obserwacji przyczynowej', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00', { status: 'GREEN', decision: 'Easy bieg' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [{ date: '2026-08-25', name: 'Easy' }], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome).toMatchObject({ state: 'same-day-time-unknown', sessions: [] });
  });

  it('rozstrzyga chronologię także po sekundach', () => {
    const journal = buildDecisionJournal([
      row('2026-08-25', '2026-08-25 09:00:30', { status: 'GREEN', decision: 'Easy bieg' }, 'Head Coach'),
    ]);
    const result = attachDecisionOutcomes(journal, [
      { date: '2026-08-25', timestamp: '2026-08-25 09:00:15', name: 'Za wcześnie' },
      { date: '2026-08-25', timestamp: '2026-08-25 09:00:45', name: 'Po decyzji' },
    ], [], { today: '2026-08-27' });
    expect(result.entries[0].outcome.sessions.map(({ name }) => name)).toEqual(['Po decyzji']);
    expect(result.entries[0].outcome.preDecisionSessions.map(({ name }) => name)).toEqual(['Za wcześnie']);
  });
});
