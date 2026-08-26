import { describe, expect, it } from 'vitest';
import { baseline, computeDailyMetrics, normalizeRawData, preCalibrationTrend, zScore } from './dailyMetrics.js';

function raw(date, timestamp, values = {}, source = 'Agent Garmin') {
  return {
    Date: date,
    Timestamp: timestamp,
    Weight_kg: values.weight ?? '',
    RHR_bpm: values.rhr ?? '',
    HRV_night_ms: values.hrv ?? '',
    Sleep_min: values.sleepMinutes ?? '',
    Sleep_score: values.sleepScore ?? '',
    Source: source,
  };
}

function dateOffset(day) {
  return `2026-01-${String(day).padStart(2, '0')}`;
}

describe('normalizeRawData', () => {
  it('scala pola atomowo i wybiera najnowszy prawidłowy odczyt', () => {
    const result = normalizeRawData([
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 60, rhr: 47 }),
      raw('2026-08-25', '2026-08-25 09:30', { hrv: 69, sleepScore: 73 }),
      raw('2026-08-25', '2026-08-25 09:31', { weight: 90 }, 'User'),
    ]);
    expect(result.days[0].values).toEqual({ hrv: 69, rhr: 47, sleepMinutes: null, sleepScore: 73, weight: 90 });
    expect(result.days[0].rawRowCount).toBe(3);
  });

  it('wynik nie zależy od kolejności wierszy', () => {
    const rows = [
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 60 }),
      raw('2026-08-25', '2026-08-25 10:00', { hrv: 69 }),
    ];
    expect(normalizeRawData(rows).days).toEqual(normalizeRawData([...rows].reverse()).days);
  });

  it('rozróżnia sekundy w Timestamp i wybiera naprawdę najnowszą próbkę', () => {
    const result = normalizeRawData([
      raw('2026-08-25', '2026-08-25 09:00:05', { hrv: 60 }),
      raw('2026-08-25', '2026-08-25 09:00:45', { hrv: 69 }),
    ]);
    expect(result.days[0].values.hrv).toBe(69);
    expect(result.days[0].selections.hrv.timestamp).toBe('2026-08-25 09:00:45');
  });

  it('przy remisie czasu preferuje Agent Garmin dla fizjologii i User dla wagi', () => {
    const result = normalizeRawData([
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 60, weight: 89 }, 'User'),
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 69, weight: 90 }, 'Agent Garmin'),
    ]);
    expect(result.days[0].values.hrv).toBe(69);
    expect(result.days[0].values.weight).toBe(89);
  });

  it('sprzeczny remis tego samego źródła jest błędem, nie arbitralnym wyborem', () => {
    const result = normalizeRawData([
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 60 }),
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 69 }),
    ]);
    expect(result.days[0].values.hrv).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'ambiguous-hrv', severity: 'error' }));
  });

  it('raportuje aktualizację wartości w tym samym dniu', () => {
    const result = normalizeRawData([
      raw('2026-08-25', '2026-08-25 09:00', { sleepMinutes: 300 }),
      raw('2026-08-25', '2026-08-25 10:00', { sleepMinutes: 420 }),
    ]);
    expect(result.days[0].values.sleepMinutes).toBe(420);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'updated-sleepMinutes', severity: 'info' }));
  });

  it('odrzuca wartości poza kontraktem', () => {
    const result = normalizeRawData([raw('2026-08-25', '2026-08-25 09:00', { rhr: 300, sleepScore: 101 })]);
    expect(result.days[0].values.rhr).toBeNull();
    expect(result.issues.filter(({ severity }) => severity === 'error')).toHaveLength(2);
  });

  it('raportuje wiersz bez daty i rozjazd Date/Timestamp', () => {
    const result = normalizeRawData([
      raw('', '2026-08-25 09:00', { hrv: 60 }),
      raw('2026-08-25', '2026-08-24 09:00', { hrv: 61 }),
    ]);
    expect(result.undatedSkipped).toBe(1);
    expect(result.issues.map(({ id }) => id)).toEqual(expect.arrayContaining(['undated-row', 'timestamp-date-mismatch']));
  });
});

describe('baseline i zScore', () => {
  it('wyklucza oceniany dzień z własnego baseline', () => {
    const series = [
      { date: '2026-01-01', value: 50 },
      { date: '2026-01-02', value: 1000 },
    ];
    const result = baseline(series, '2026-01-02', 30, { minSamples: 1, minHistoryDays: 1 });
    expect(result).toMatchObject({ mean: 50, n: 1, historyDays: 1, ready: true });
  });

  it('nie jest gotowy przed 28 dniami mimo wielu rekordów', () => {
    const series = Array.from({ length: 20 }, (_, index) => ({ date: '2026-01-01', value: 50 + index }));
    const result = baseline(series, '2026-01-10');
    expect(result).toMatchObject({ ready: false, calibrationDays: '9/28' });
    expect(zScore(70, result)).toBeNull();
  });

  it('nie jest gotowy przy 28 dniach rozpiętości, ale zbyt małej próbce', () => {
    const result = baseline([
      { date: '2026-01-01', value: 50 },
      { date: '2026-01-29', value: 60 },
    ], '2026-01-30');
    expect(result).toMatchObject({ ready: false, historyDays: 29, n: 2, coverage: 1 });
  });

  it('gotowy baseline używa odchylenia standardowego próby', () => {
    const series = Array.from({ length: 15 }, (_, index) => ({
      date: dateOffset(index + 1), value: index + 1,
    }));
    series.push({ date: '2026-01-29', value: 16 });
    const result = baseline(series, '2026-01-30');
    expect(result.ready).toBe(true);
    expect(result.n).toBe(16);
    expect(result.mean).toBeCloseTo(8.5, 8);
    expect(result.sd).toBeCloseTo(4.760952, 5);
    expect(zScore(18, result)).toBeCloseTo((18 - 8.5) / result.sd, 8);
  });

  it('zScore zwraca null dla zerowego rozproszenia', () => {
    expect(zScore(50, { ready: true, mean: 50, sd: 0 })).toBeNull();
  });

  it('coverage zależy od rozpiętości historii, nie liczby obserwacji', () => {
    const result = baseline([
      { date: '2026-01-01', value: 50 },
      { date: '2026-01-29', value: 60 },
    ], '2026-01-30', 30, { minSamples: 2, minHistoryDays: 28 });
    expect(result.coverage).toBe(1);
    expect(result.sampleCoverage).toBeLessThan(0.1);
    expect(result.ready).toBe(true);
  });
});

describe('computeDailyMetrics', () => {
  it('przy obecnej historii zwraca KALIBRACJA zamiast z-score', () => {
    const rows = [21, 22, 23, 24, 25].map((day) => raw(
      `2026-08-${day}`,
      `2026-08-${day} 09:00`,
      { hrv: 50 + day, rhr: 46, sleepScore: 70, sleepMinutes: 420, weight: 90 },
    ));
    const result = computeDailyMetrics(rows, '2026-08-25');
    expect(result).toMatchObject({ state: 'calibrating', calibrationDays: '4/28', historyDays: 4 });
    expect(result.metrics.hrv.baseline).toMatchObject({ n: 4, ready: false });
    expect(result.metrics.hrv.zScore).toBeNull();
  });

  it('wykrywa co najmniej dwudniową lukę, ale nie pojedynczy brak dnia', () => {
    const twoDayGap = computeDailyMetrics([
      raw('2026-08-20', '2026-08-20 09:00', { hrv: 60 }),
      raw('2026-08-23', '2026-08-23 09:00', { hrv: 61 }),
    ], '2026-08-24');
    expect(twoDayGap.issues).toContainEqual(expect.objectContaining({ id: 'data-gap', severity: 'warning' }));

    const oneDayGap = computeDailyMetrics([
      raw('2026-08-20', '2026-08-20 09:00', { hrv: 60 }),
      raw('2026-08-22', '2026-08-22 09:00', { hrv: 61 }),
    ], '2026-08-23');
    expect(oneDayGap.issues.filter(({ id }) => id === 'data-gap')).toEqual([]);
  });

  it('ignoruje przyszłe dni przy wyborze current i historii', () => {
    const result = computeDailyMetrics([
      raw('2026-08-25', '2026-08-25 09:00', { hrv: 60 }),
      raw('2026-08-26', '2026-08-26 09:00', { hrv: 100 }),
    ], '2026-08-25');
    expect(result.current.values.hrv).toBe(60);
    expect(result.days).toHaveLength(1);
  });

  it('przed kalibracją wykrywa trzy kolejne dni RHR w górę i HRV w dół', () => {
    const result = computeDailyMetrics([
      raw('2026-08-23', '2026-08-23 09:00', { rhr: 45, hrv: 70 }),
      raw('2026-08-24', '2026-08-24 09:00', { rhr: 47, hrv: 65 }),
      raw('2026-08-25', '2026-08-25 09:00', { rhr: 49, hrv: 60 }),
    ], '2026-08-25');
    expect(result.bridgeSignal).toMatchObject({
      state: 'active', active: true, reason: 'three-day-rhr-up-hrv-down',
    });
    expect(result.bridgeSignal.interpretation).toContain('nigdy samodzielnie do zatrzymania treningu');
  });

  it('reguła pomostowa nie uruchamia się przy luce lub niepełnym zestawie HRV/RHR', () => {
    const gap = computeDailyMetrics([
      raw('2026-08-22', '2026-08-22 09:00', { rhr: 45, hrv: 70 }),
      raw('2026-08-24', '2026-08-24 09:00', { rhr: 47, hrv: 65 }),
      raw('2026-08-25', '2026-08-25 09:00', { rhr: 49, hrv: 60 }),
    ], '2026-08-25');
    expect(gap.bridgeSignal).toMatchObject({ state: 'unavailable', active: false, reason: 'non-consecutive-days' });

    const missing = computeDailyMetrics([
      raw('2026-08-23', '2026-08-23 09:00', { rhr: 45, hrv: 70 }),
      raw('2026-08-24', '2026-08-24 09:00', { rhr: 47 }),
      raw('2026-08-25', '2026-08-25 09:00', { rhr: 49, hrv: 60 }),
    ], '2026-08-25');
    expect(missing.bridgeSignal).toMatchObject({ state: 'unavailable', active: false, reason: 'missing-rhr-or-hrv' });
  });

  it('wyłącza regułę pomostową, gdy baseline HRV i RHR jest gotowy', () => {
    const days = Array.from({ length: 30 }, (_, index) => raw(
      `2026-01-${String(index + 1).padStart(2, '0')}`,
      `2026-01-${String(index + 1).padStart(2, '0')} 09:00`,
      { rhr: 45 + index / 10, hrv: 80 - index / 10 },
    ));
    const result = computeDailyMetrics(days, '2026-01-30');
    expect(result.metrics.hrv.baseline.ready).toBe(true);
    expect(result.metrics.rhr.baseline.ready).toBe(true);
    expect(result.bridgeSignal).toMatchObject({ state: 'disabled', active: false, reason: 'baseline-ready' });
  });
});

describe('preCalibrationTrend', () => {
  it('nie uznaje dwóch dni za trzydniowy trend', () => {
    expect(preCalibrationTrend([], '2026-08-25')).toMatchObject({ active: false, state: 'unavailable' });
  });
});
