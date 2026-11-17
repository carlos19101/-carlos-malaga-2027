import { describe, expect, it } from 'vitest';
import { computeDayRule } from './dayRule.js';

const TODAY = '2026-11-17';

function entry(date, overrides = {}) {
  return {
    Date: date,
    HRV_orthostatic_rMSSD_ms: '100',
    HR_lying_bpm: '50',
    HR_standing_bpm: '60',
    Sleep_min: '480',
    Wellbeing: 'NORMAL',
    Symptom_Dizziness: 'NO',
    Symptom_Palpitations: 'NO',
    Symptom_Chest_Pain: 'NO',
    Symptom_Illness: 'NO',
    ...overrides,
  };
}

function priorDays(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2026, 10, 16 - index));
    return entry(day.toISOString().slice(0, 10));
  });
}

describe('reguła dnia', () => {
  it('brak dzisiejszego check-inu nie jest zielonym dniem', () => {
    expect(computeDayRule(priorDays(), TODAY)).toMatchObject({ status: 'missing', label: 'BRAK POMIARU' });
  });

  it('sam nocny odczyt Garmina nie jest porannym check-inem', () => {
    expect(computeDayRule([...priorDays(), { Date: TODAY, HRV_night_ms: '100', RHR_bpm: '50', Sleep_min: '480' }], TODAY).status).toBe('missing');
  });

  it('nie uznaje niepotwierdzonych objawów i niepoprawnego samopoczucia za prawidłowe', () => {
    expect(computeDayRule([...priorDays(), entry(TODAY, { Symptom_Illness: '', Wellbeing: 'OTHER' })], TODAY).status).toBe('incomplete');
  });

  it('odrzuca zerowe, niemożliwe i niedatowane pomiary z kalibracji', () => {
    const rows = [...priorDays(6), entry('2026-11-01', { HR_lying_bpm: '0' }), entry('2026-11-02', { HRV_orthostatic_rMSSD_ms: '999' }), entry('2026-02-30'), entry(TODAY)];
    expect(computeDayRule(rows, TODAY)).toMatchObject({ status: 'calibration', baseline: null, calibrationDays: 7 });
  });

  it('norma obejmuje maksymalnie 14 poprzednich ważnych dni, bez przyszłych odczytów', () => {
    const rows = [...priorDays(14), entry('2026-10-01', { HRV_orthostatic_rMSSD_ms: '10' }), entry('2026-11-18', { HRV_orthostatic_rMSSD_ms: '20' }), entry(TODAY)];
    expect(computeDayRule(rows, TODAY).baseline).toMatchObject({ days: 14, hrv: 100 });
  });

  it('gotowość Garmina nie zmienia wyniku reguły', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, { Readiness_Garmin: '1' })], TODAY);
    expect(result.status).toBe('green');
    expect(result.current).toMatchObject({ hrv: 100, lying: 50, delta: 10, sleep: 480 });
  });

  it('zostaje w kalibracji przed siedmioma wcześniejszymi pełnymi odczytami', () => {
    const result = computeDayRule([...priorDays(6), entry(TODAY)], TODAY);
    expect(result).toMatchObject({ status: 'calibration', label: 'KALIBRACJA', calibrationDays: 7, baseline: null });
  });

  it('nie używa ocenianego dnia do normy bazowej', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, { HRV_orthostatic_rMSSD_ms: '1' })], TODAY);
    expect(result.baseline).toMatchObject({ days: 7, hrv: 100, lying: 50, delta: 10 });
    expect(result.status).toBe('green');
  });

  it('objaw daje czerwony status także przed kalibracją', () => {
    const result = computeDayRule([entry(TODAY, { Symptom_Dizziness: 'YES' })], TODAY);
    expect(result).toMatchObject({ status: 'red', label: 'CZERWONY', symptoms: ['Zawroty głowy'] });
  });

  it('bólu w klatce nie zamienia w sugestię spokojnego treningu bez ostrzeżenia', () => {
    const result = computeDayRule([entry(TODAY, { Symptom_Chest_Pain: 'YES' })], TODAY);
    expect(result.status).toBe('red');
    expect(result.symptoms).toContain('Ból w klatce piersiowej');
  });

  it('progi są ścisłe: HRV równe 90%, HR leżąc +5, delta +10 i sen 7 h nie wyzwalają sygnału', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, {
      HRV_orthostatic_rMSSD_ms: '90', HR_lying_bpm: '55', HR_standing_bpm: '75', Sleep_min: '420', Wellbeing: 'GOOD',
    })], TODAY);
    expect(result.signals.every(({ triggered }) => !triggered)).toBe(true);
    expect(result.status).toBe('green');
  });

  it('HRV poniżej 90% normy wyzwala sygnał 1, ale pojedynczy sygnał pozostaje zielony', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, { HRV_orthostatic_rMSSD_ms: '89' })], TODAY);
    expect(result.signals.find(({ id }) => id === 1).triggered).toBe(true);
    expect(result.status).toBe('green');
  });

  it('tętno leżąc powyżej normy +5 wyzwala sygnał 1', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, { HR_lying_bpm: '56' })], TODAY);
    expect(result.signals.find(({ id }) => id === 1).triggered).toBe(true);
  });

  it('różnica ortostatyczna powyżej normy +10 wyzwala sygnał 2', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, { HR_standing_bpm: '71' })], TODAY);
    expect(result.signals.find(({ id }) => id === 2).triggered).toBe(true);
  });

  it('sen poniżej 7 h albo samopoczucie słabe wyzwala sygnał 3', () => {
    for (const current of [
      entry(TODAY, { Sleep_min: '419' }),
      entry(TODAY, { Wellbeing: 'BAD' }),
    ]) {
      expect(computeDayRule([...priorDays(), current], TODAY).signals.find(({ id }) => id === 3).triggered).toBe(true);
    }
  });

  it.each([
    [89, 50, 60, 480, 'GOOD', 'green'],
    [90, 50, 71, 419, 'GOOD', 'yellow'],
    [89, 56, 77, 419, 'BAD', 'red'],
  ])('liczy odchylenia i mapuje je na status %s', (hrv, lying, standing, sleep, wellbeing, status) => {
    const result = computeDayRule([...priorDays(), entry(TODAY, {
      HRV_orthostatic_rMSSD_ms: String(hrv), HR_lying_bpm: String(lying), HR_standing_bpm: String(standing),
      Sleep_min: String(sleep), Wellbeing: wellbeing,
    })], TODAY);
    expect(result.status).toBe(status);
  });

  it('nie klasyfikuje brakujących pól jako zielonych', () => {
    const result = computeDayRule([...priorDays(), entry(TODAY, {
      HRV_orthostatic_rMSSD_ms: '', HR_lying_bpm: '', HR_standing_bpm: '', Sleep_min: '',
    })], TODAY);
    expect(result.status).toBe('incomplete');
    expect(result.missing).toContain('HRV rMSSD');
  });

  it('pokazuje flagę trzech kolejnych nocy ze snem poniżej 7 h', () => {
    const rows = [
      entry('2026-11-15', { Sleep_min: '419' }),
      entry('2026-11-16', { Sleep_min: '400' }),
      entry(TODAY, { Sleep_min: '414' }),
    ];
    expect(computeDayRule(rows, TODAY).sleepStreak).toBe(true);
    expect(computeDayRule(rows.slice(1), TODAY).sleepStreak).toBe(false);
  });
});
