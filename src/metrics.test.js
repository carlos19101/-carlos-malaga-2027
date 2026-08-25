import { describe, expect, it } from 'vitest';
import { compareVerifierMetrics, computeVerifierMetrics, crossValidate } from './metrics';

describe('computeVerifierMetrics', () => {
  const today = new Date(2026, 7, 25, 12);

  it('liczy lokalne, domknięte okna 7 i 28 dni', () => {
    const result = computeVerifierMetrics([
      { date: '2026-08-25', type: 'Bieg', km: '5,5', srpe: '50' },
      { date: '2026-08-19', type: 'Bieg', km: '4', srpe: '40' },
      { date: '2026-08-18', type: 'Bieg', km: '3', srpe: '30' },
      { date: '2026-07-29', type: 'Bieg', km: '2', srpe: '20' },
      { date: '2026-07-28', type: 'Bieg', km: '100', srpe: '1000' },
    ], [], today);
    expect(result).toMatchObject({ km7: 9.5, km28: 14.5, srpe7: 90, srpe28: 140, sessions7: 2 });
  });

  it('kilometry i sessions liczy tylko dla biegu, a sRPE dla wszystkich sesji', () => {
    const result = computeVerifierMetrics([
      { date: '2026-08-24', type: 'Bieg', km: '6,8', srpe: '80' },
      { date: '2026-08-24', type: 'Siła', km: '12', srpe: '60' },
      { date: '2026-08-23', type: 'Recovery', km: '', srpe: '15' },
    ], [], today);
    expect(result).toMatchObject({ km7: 6.8, srpe7: 155, sessions7: 1 });
  });

  it('ignoruje wiersze bez daty i z przyszłości', () => {
    const result = computeVerifierMetrics([
      { date: '', type: 'Bieg', km: '50', srpe: '500' },
      { date: '2026-08-26', type: 'Bieg', km: '50', srpe: '500' },
      { date: '2026-08-25', type: 'Bieg', km: '5', srpe: '50' },
    ], [], today);
    expect(result).toMatchObject({ km7: 5, srpe7: 50, sessions7: 1 });
  });

  it('pusty log zwraca zera, nie NaN', () => {
    expect(computeVerifierMetrics([], [], today)).toEqual({
      km7: 0, km28: 0, srpe7: 0, srpe28: 0, sessions7: 0, weight: null,
    });
  });

  it('wybiera ostatnią niepustą wagę nie późniejszą niż dziś', () => {
    const result = computeVerifierMetrics([], [
      { date: '2026-08-23', weight: '89,6' },
      { date: '2026-08-25', weight: '' },
      { date: '2026-08-25', weight: '90,0' },
      { date: '2026-08-26', weight: '91' },
    ], today);
    expect(result.weight).toBe(90);
  });

  it('używa numerów lokalnych dni i pozostaje stabilny przy zmianie DST', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Warsaw';
    try {
      const result = computeVerifierMetrics([
        { date: '2026-10-19', type: 'Bieg', km: '1', srpe: '10' },
        { date: '2026-10-25', type: 'Bieg', km: '2', srpe: '20' },
      ], [], new Date(2026, 9, 25, 12));
      expect(result).toMatchObject({ km7: 3, srpe7: 30, sessions7: 2 });
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});

describe('crossValidate', () => {
  const computed = { km7: 17.97, km28: 24.77, srpe7: 215, srpe28: 300, sessions7: 2, weight: 89.6 };

  it('zgodność wszystkich pól zwraca pustą tablicę', () => {
    expect(crossValidate(computed, computed)).toEqual([]);
  });

  it('duży rozjazd kilometrów ma severity error', () => {
    const mismatches = crossValidate({ ...computed, km7: 24.77 }, { ...computed, km7: 17.97 });
    expect(mismatches).toEqual([expect.objectContaining({
      field: 'km7', fromFeed: 17.97, computed: 24.77, delta: 6.8, severity: 'error',
    })]);
  });

  it('różnica km w tolerancji 0.05 nie tworzy wpisu', () => {
    expect(crossValidate({ ...computed, km7: 18 }, { ...computed, km7: 17.97 })).toEqual([]);
  });

  it('różnica poza tolerancją, lecz poniżej progu error daje warning', () => {
    const mismatches = crossValidate({ ...computed, km7: 18.05 }, { ...computed, km7: 17.97 });
    expect(mismatches[0]).toMatchObject({ field: 'km7', severity: 'warning' });
  });

  it('sessions wymaga dokładnej zgodności', () => {
    const mismatches = crossValidate({ ...computed, sessions7: 3 }, { ...computed, sessions7: 2 });
    expect(mismatches[0]).toMatchObject({ field: 'sessions7', severity: 'error' });
  });

  it('brak pola w APP_FEED pomija porównanie', () => {
    expect(crossValidate(computed, { ...computed, weight: '' })).toEqual([]);
    const comparison = compareVerifierMetrics(computed, { ...computed, weight: '' })
      .find(({ field }) => field === 'weight');
    expect(comparison).toMatchObject({ field: 'weight', fromFeed: null, severity: 'skipped' });
  });

  it('obsługuje liczby z polskim przecinkiem', () => {
    expect(crossValidate(
      { ...computed, weight: '89,60' },
      { ...computed, weight: '89,6' },
    )).toEqual([]);
  });

  it('potwierdza realny snapshot produkcyjny z 25.08.2026', () => {
    const liveComputed = computeVerifierMetrics([
      { date: '2026-08-18', type: 'Bieg', km: '4,62', srpe: '85' },
      { date: '2026-08-20', type: 'Bieg', km: '6,55', srpe: '90' },
      { date: '2026-08-20', type: 'Siła', km: '', srpe: '125' },
      { date: '2026-08-21', type: 'Recovery', km: '', srpe: '0' },
      { date: '2026-08-23', type: 'Bieg', km: '6,80067', srpe: '0' },
      { date: '2026-08-24', type: 'Recovery', km: '', srpe: '0' },
    ], [
      { date: '2026-08-23', weight: '89,6' },
      { date: '2026-08-25', weight: '90' },
    ], new Date(2026, 7, 25, 12));
    const comparisons = compareVerifierMetrics(liveComputed, {
      km7: '13,35', km28: '17,97', srpe7: '215', srpe28: '300', sessions7: '2', weight: '90',
    });
    expect(liveComputed.km7).toBeCloseTo(13.35067, 8);
    expect(liveComputed.km28).toBeCloseTo(17.97067, 8);
    expect(liveComputed).toMatchObject({ srpe7: 215, srpe28: 300, sessions7: 2, weight: 90 });
    expect(comparisons.map(({ field, severity }) => [field, severity])).toEqual([
      ['km7', 'ok'], ['km28', 'ok'], ['srpe7', 'ok'], ['srpe28', 'ok'], ['sessions7', 'ok'], ['weight', 'ok'],
    ]);
  });
});
