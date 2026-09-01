import { describe, expect, it } from 'vitest';
import {
  COACH_ACTION,
  coachActionLabel,
  classifyCoachStatus,
  daysUntilRace,
  metricDeltaPercent,
  millisecondsUntilNextLocalMidnight,
  raceGoalMatrix,
  integrateCoachDecision,
  resolveCoachDecision,
  sourceFreshness,
  summarizeLoad,
} from './performance';

describe('coach decision', () => {
  it('Head Coach z arkusza ma pierwszeństwo przed automatem', () => {
    const d = resolveCoachDecision({
      sheetStatus: 'YELLOW',
      sheetDecision: 'Bieg odpuszczony — DOMS.',
      fallbackInput: { recovery: 90, sleep: 90, dataOk: true },
    });
    expect(d.status).toBe('YELLOW');
    expect(d.action).toBe(COACH_ACTION.RECOVERY);
    expect(d.recommendation).toContain('DOMS');
    expect(d.source).toBe('head-coach');
  });

  it('fallback daje YELLOW dla Recovery 57', () => {
    const d = classifyCoachStatus({ recovery: 57, sleep: 82, hrv: 54, hrv7d: 62, pain: 0, dataOk: true });
    expect(d.status).toBe('YELLOW');
    expect(d.action).toBe(COACH_ACTION.CONTROL);
  });

  it('ból >=4 daje RED w fallbacku', () => {
    expect(classifyCoachStatus({ recovery: 90, sleep: 90, pain: 4, dataOk: true })).toMatchObject({ status: 'RED', action: COACH_ACTION.NO_TRAIN });
  });

  it('żółty status rozróżnia trening kontrolowany od dnia regeneracyjnego', () => {
    expect(resolveCoachDecision({ sheetStatus: 'YELLOW', sheetDecision: 'Zachowaj rezerwę.', plannedSession: 'Easy 6 km' }).action).toBe(COACH_ACTION.CONTROL);
    expect(resolveCoachDecision({ sheetStatus: 'YELLOW', sheetDecision: 'Dziś OFF / recovery.' }).action).toBe(COACH_ACTION.RECOVERY);
  });

  it('brak integralnych danych nie udaje decyzji treningowej', () => {
    const d = classifyCoachStatus({ recovery: 90, sleep: 90, dataOk: false });
    expect(d).toMatchObject({ status: 'RED', action: COACH_ACTION.NO_DECISION });
    expect(coachActionLabel(d.action)).toBe('BRAK PEWNEJ DECYZJI');
  });

  it('zielony status oznacza wykonanie planu', () => {
    const d = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy zgodnie z planem.' });
    expect(d.action).toBe(COACH_ACTION.TRAIN);
    expect(coachActionLabel(d.action)).toBe('TRENUJ ZGODNIE Z PLANEM');
  });

  it('błąd integralności blokuje pewną decyzję także przy zielonym statusie źródłowym', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({ decision, integrity: { validationOk: false, freshnessState: 'fresh' } });
    expect(result).toMatchObject({ status: 'RED', action: COACH_ACTION.NO_DECISION, confidence: 'NONE' });
    expect(result.engineAdjustments).toEqual(['integrity-gate']);
  });

  it('nieświeże dane blokują decyzję zamiast używać starego statusu', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({ decision, integrity: { validationOk: true, freshnessState: 'stale' } });
    expect(result.action).toBe(COACH_ACTION.NO_DECISION);
    expect(result.reasons).toContain('dane starsze niż 36 godzin');
  });

  it('brak dzisiejszego APP_FEED blokuje decyzję zamiast przenosić werdykt z wczoraj', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({ decision, integrity: { validationOk: true, freshnessState: 'previous-day' } });
    expect(result.action).toBe(COACH_ACTION.NO_DECISION);
    expect(result.reasons).toContain('brak wpisu APP_FEED z bieżącego dnia');
  });

  it('czerwony sygnał bólowy ma pierwszeństwo przed zielonym statusem źródłowym', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 4, doms: 2, fatigue: 2 },
    });
    expect(result).toMatchObject({ status: 'RED', action: COACH_ACTION.NO_TRAIN, confidence: 'SUPPORTED' });
    expect(result.engineAdjustments).toEqual(['red-recovery-gate']);
  });

  it('sygnał pomostowy zmienia tylko zielony trening na kontrolowany', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 0, doms: 2, fatigue: 2 },
      daily: { state: 'calibrating', bridgeSignal: { active: true } },
    });
    expect(result).toMatchObject({ status: 'YELLOW', action: COACH_ACTION.CONTROL, confidence: 'LIMITED' });
    expect(result.engineAdjustments).toEqual(['pre-calibration-bridge']);
  });

  it('Execution OVER i load ratio są dowodem, ale bez zatwierdzonej reguły nie zmieniają działania', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 0, doms: 2, fatigue: 2 },
      daily: { state: 'ready', bridgeSignal: { active: false } },
      execution: { status: 'over' },
      load: { loadRatio: 1.51, calibrationDays: '28/28' },
    });
    expect(result.action).toBe(COACH_ACTION.TRAIN);
    expect(result.evidence).toEqual(expect.arrayContaining(['OSTATNIA SESJA: over', 'LOAD RATIO: 1.51']));
    expect(result.engineAdjustments).toEqual([]);
  });

  it('niepełne RPE wyłącza load ratio i pozostawia jawne ograniczenie metodologiczne', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Easy.' });
    const result = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 0, doms: 2, fatigue: 2 },
      daily: { state: 'ready', bridgeSignal: { active: false } },
      load: { loadRatio: null, ratioStatus: 'unreliable-internal-load', calibrationDays: '28/28' },
    });
    expect(result.limitations).toContain('Load ratio: wyłączone — niepełne RPE/sRPE');
    expect(result.evidence).not.toEqual(expect.arrayContaining([expect.stringContaining('LOAD RATIO:')]));
  });

  it('aktywny wzorzec trzech easy ogranicza kolejne easy, ale nie inną jednostkę', () => {
    const decision = resolveCoachDecision({ sheetStatus: 'GREEN', sheetDecision: 'Wykonaj plan.' });
    const pattern = { state: 'active', active: true, appliesToday: true, sample: '3/3', required: 3, thresholdPct: 40 };
    const result = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 0, doms: 2, fatigue: 2 },
      daily: { state: 'ready', bridgeSignal: { active: false } },
      patterns: { easyExecution: pattern },
    });
    expect(result).toMatchObject({ status: 'YELLOW', action: COACH_ACTION.CONTROL, confidence: 'SUPPORTED' });
    expect(result.engineAdjustments).toEqual(['repeated-easy-over-target']);

    const unrelated = integrateCoachDecision({
      decision,
      integrity: { validationOk: true, freshnessState: 'fresh' },
      recovery: { pain: 0, doms: 2, fatigue: 2 },
      daily: { state: 'ready', bridgeSignal: { active: false } },
      patterns: { easyExecution: { ...pattern, appliesToday: false } },
    });
    expect(unrelated.action).toBe(COACH_ACTION.TRAIN);
  });
});

describe('metricDeltaPercent', () => {
  it('porównuje HRV do indywidualnego 7d baseline', () => {
    expect(metricDeltaPercent(54, 62)).toBeCloseTo(-12.9032, 3);
  });
});

describe('summarizeLoad', () => {
  it('sumuje 7 i 28 dni bez wymuszania ratio przy małej próbce', () => {
    const now = new Date('2026-08-22T12:00:00');
    const r = summarizeLoad([
      { date: '2026-08-20', srpe: 215 },
      { date: '2026-08-18', srpe: 85 },
    ], now);
    expect(r.sum7).toBe(300);
    expect(r.sum28).toBe(300);
    expect(r.ratio).toBeNull();
  });
});

describe('sourceFreshness', () => {
  it('oznacza stary pomiar jako stale na podstawie czasu źródłowego, nie czasu kliknięcia refresh', () => {
    const f = sourceFreshness(new Date('2026-08-20T20:00:00'), new Date('2026-08-22T20:30:00'));
    expect(f.state).toBe('stale');
  });
  it('oznacza świeży pomiar jako fresh', () => {
    expect(sourceFreshness(new Date('2026-08-22T07:00:00'), new Date('2026-08-22T20:30:00')).state).toBe('fresh');
  });
  it('nie uznaje wczorajszego APP_FEED za dzisiejszy check-in tylko dlatego, że ma mniej niż 36 godzin', () => {
    expect(sourceFreshness(
      new Date('2026-08-31T22:10:54+02:00'),
      new Date('2026-09-01T08:00:00+02:00'),
      36,
      { requireCurrentDay: true, contentDate: '2026-08-31' },
    )).toMatchObject({ state: 'previous-day' });
  });
});

describe('Málaga race matrix', () => {
  it('trzyma oficjalny dystans 21.0975 km i stabilne splity', () => {
    const [a, b, c] = raceGoalMatrix();
    expect(a).toMatchObject({ finish: '1:45:00', pace: '4:59/km', km5: '24:53', km10: '49:46', km15: '1:14:39' });
    expect(b).toMatchObject({ finish: '1:50:00', pace: '5:13/km', km5: '26:04', km10: '52:08', km15: '1:18:12' });
    expect(c).toMatchObject({ finish: '2:00:00', pace: '5:41/km', km5: '28:26', km10: '56:53', km15: '1:25:19' });
  });
  it('liczy dni kalendarzowe do 7 marca 2027', () => {
    expect(daysUntilRace(new Date('2026-08-22T20:30:00'))).toBe(197);
  });
  it('liczy lokalne dni kalendarzowe przez jesienne przejście DST', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Warsaw';
    try {
      expect(daysUntilRace(new Date('2026-10-24T20:30:00'), '2026-10-26')).toBe(2);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});

describe('local midnight rollover', () => {
  it('planuje najbliższą lokalną północ także w dniu zmiany DST', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Warsaw';
    try {
      const now = new Date(2026, 9, 25, 0, 30, 0, 0);
      expect(millisecondsUntilNextLocalMidnight(now)).toBe(24.5 * 60 * 60 * 1000);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('odrzuca nieprawidłową datę timera', () => {
    expect(millisecondsUntilNextLocalMidnight('invalid')).toBeNull();
  });
});
