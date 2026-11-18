import { describe, expect, it } from 'vitest';
import { planDailyCheckinUpsert, validateDailyCheckin, warsawDate } from './dailyCheckin.js';

const HEADERS = [
  'Date', 'Weight_kg', 'HRV_night_ms', 'Sleep_min', 'HRV_orthostatic_rMSSD_ms', 'HR_lying_bpm',
  'HR_standing_bpm', 'Wellbeing', 'Symptom_Dizziness', 'Symptom_Palpitations',
  'Symptom_Chest_Pain', 'Symptom_Illness', 'Checkin_Saved_At', 'Checkin_Source',
];

function checkin(overrides = {}) {
  return {
    date: '2026-11-17', hrvOrthostatic: '56', hrLying: '48', hrStanding: '62', sleepHours: '7.5',
    wellbeing: 'normal', symptomsConfirmed: true,
    symptoms: { dizziness: false, palpitations: false, chestPain: false, illness: false },
    hrvNight: '', weightKg: '', ...overrides,
  };
}

describe('poranny check-in', () => {
  it('używa daty Europe/Warsaw, także blisko północy UTC', () => {
    expect(warsawDate(new Date('2026-11-16T23:30:00.000Z'))).toBe('2026-11-17');
  });

  it.each([
    ['00:30 czasu polskiego', '2026-11-18T23:30:00.000Z', '2026-11-19'],
    ['23:30 czasu polskiego', '2026-11-19T22:30:00.000Z', '2026-11-19'],
  ])('zapis o %s przypisuje check-in do daty lokalnej Europe/Warsaw', (_label, instant, localDate) => {
    const savedDate = warsawDate(new Date(instant));
    expect(savedDate).toBe(localDate);

    const result = validateDailyCheckin(checkin({ date: savedDate }), { now: new Date(instant) });
    expect(result.ok).toBe(true);
    const plan = planDailyCheckinUpsert(HEADERS, [], result.value, { now: new Date(instant) });
    expect(plan.action).toBe('append');
    expect(plan.date).toBe(localDate);
    expect(plan.row[HEADERS.indexOf('Date')]).toBe(localDate);
  });

  it('normalizuje sen do minut, zachowuje pustki i rozdziela HRV nocne od porannego', () => {
    const result = validateDailyCheckin(checkin(), { now: new Date('2026-11-17T10:00:00Z') });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      hrvOrthostatic: 56, hrLying: 48, hrStanding: 62, sleepMinutes: 450,
      hrvNight: null, weightKg: null,
    });
  });

  it('akceptuje polski przecinek dziesiętny i zapisuje 6,9 h jako 414 minut', () => {
    const result = validateDailyCheckin(checkin({ sleepHours: '6,9', hrvOrthostatic: '55,5', weightKg: '90,2' }), {
      now: new Date('2026-11-17T10:00:00Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ sleepMinutes: 414, hrvOrthostatic: 55.5, weightKg: 90.2 });
  });

  it('odrzuca nieprawidłowe liczby, przyszłą datę, brak odczucia i niepotwierdzone objawy', () => {
    const result = validateDailyCheckin(checkin({ date: '2026-11-18', hrLying: '900', wellbeing: '', symptomsConfirmed: false }), {
      now: new Date('2026-11-17T10:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveProperty('date');
    expect(result.errors).toHaveProperty('hrLying');
    expect(result.errors).toHaveProperty('wellbeing');
    expect(result.errors).toHaveProperty('symptoms');
  });

  it('pozwala zapisać niepełny pomiar bez zamiany braków na zero', () => {
    const result = validateDailyCheckin(checkin({ hrvOrthostatic: '', hrLying: '', hrStanding: '', sleepHours: '' }), {
      now: new Date('2026-11-17T10:00:00Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ hrvOrthostatic: null, hrLying: null, hrStanding: null, sleepMinutes: null });
  });

  it('aktualizuje ostatni wiersz danej daty wyłącznie w kolumnach check-inu', () => {
    const result = validateDailyCheckin(checkin({ weightKg: '90.2', hrvNight: '61' }), { now: new Date('2026-11-17T10:00:00Z') });
    const plan = planDailyCheckinUpsert(HEADERS, [
      { rowNumber: 4, values: ['2026-11-17', '90', '60', '420', ''] },
      { rowNumber: 8, values: ['2026-11-17', '90', '61', ''] },
    ], result.value, { now: new Date('2026-11-17T10:00:00Z') });
    expect(plan.action).toBe('update');
    expect(plan.rowNumber).toBe(8);
    expect(plan.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'HRV_orthostatic_rMSSD_ms', value: 56 }),
      expect.objectContaining({ header: 'HRV_night_ms', value: 61 }),
      expect.objectContaining({ header: 'Weight_kg', value: 90.2 }),
      expect.objectContaining({ header: 'Sleep_min', value: 450 }),
    ]));
    expect(plan.updates.some(({ header }) => header === 'RHR_bpm' || header === 'Timestamp' || header === 'Source')).toBe(false);
  });

  it('tworzy jeden pusty rekord z datą, gdy dzień nie istnieje', () => {
    const result = validateDailyCheckin(checkin(), { now: new Date('2026-11-17T10:00:00Z') });
    const plan = planDailyCheckinUpsert(HEADERS, [], result.value, { now: new Date('2026-11-17T10:00:00Z') });
    expect(plan.action).toBe('append');
    expect(plan.row).toHaveLength(HEADERS.length);
    expect(plan.row[0]).toBe('2026-11-17');
    expect(plan.row[HEADERS.indexOf('Weight_kg')]).toBe('');
    expect(plan.row[HEADERS.indexOf('RHR_bpm')]).toBeUndefined();
  });

  it('blokuje zapis, gdy nie ma nowego kontraktu nagłówków', () => {
    const result = validateDailyCheckin(checkin(), { now: new Date('2026-11-17T10:00:00Z') });
    expect(planDailyCheckinUpsert(['Date'], [], result.value).action).toBe('contract-error');
  });
});
