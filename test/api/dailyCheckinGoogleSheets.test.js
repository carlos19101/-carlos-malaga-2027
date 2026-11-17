import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { updateDailyCheckin } from '../../api/_lib/googleSheets.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function environment() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: `daily-checkin-${Math.random()}@example.test`,
    GOOGLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    GOOGLE_SHEET_ID: 'daily-checkin-test-sheet',
  };
}

const headers = [
  'Date', 'Timestamp', 'Weight_kg', 'RHR_bpm', 'HRV_night_ms', 'Sleep_min', 'Sleep_score',
  'BodyBattery_gain', 'Readiness_Garmin', 'Pain_0_10', 'DOMS_0_10', 'Fatigue_0_10',
  'Coach_Status', 'Coach_Decision', 'Source', 'BodyBattery_current',
  'HRV_orthostatic_rMSSD_ms', 'HR_lying_bpm', 'HR_standing_bpm', 'Wellbeing',
  'Symptom_Dizziness', 'Symptom_Palpitations', 'Symptom_Chest_Pain', 'Symptom_Illness',
  'Checkin_Saved_At', 'Checkin_Source',
];
const checkin = {
  date: '2026-11-17', hrvOrthostatic: 56, hrLying: 48, hrStanding: 62,
  sleepMinutes: 450, weightKg: null, hrvNight: null, wellbeing: 'GOOD',
  symptoms: { dizziness: false, palpitations: true, chestPain: false, illness: false },
};

describe('zapis check-inu w Raw_Data', () => {
  it('aktualizuje istniejący dzień wyłącznie w kolumnach pomiaru i feedbacku', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: 'checkin-write-token', expires_in: 3600 }))
      .mockResolvedValueOnce(response(200, { values: [headers, ['2026-11-17', 'old timestamp', 90, 47, 60, 430, 80]] }))
      .mockResolvedValueOnce(response(200, { responses: [{ updatedRange: "'Raw_Data'!Q2" }] }));
    const result = await updateDailyCheckin(checkin, { env: environment(), fetchImpl, now: new Date('2026-11-17T08:00:00Z') });
    expect(result).toMatchObject({ action: 'update', rowNumber: 2 });
    const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data).toEqual(expect.arrayContaining([
      { range: "'Raw_Data'!Q2", values: [[56]] },
      { range: "'Raw_Data'!R2", values: [[48]] },
      { range: "'Raw_Data'!S2", values: [[62]] },
      { range: "'Raw_Data'!F2", values: [[450]] },
      { range: "'Raw_Data'!U2", values: [['NO']] },
      { range: "'Raw_Data'!V2", values: [['YES']] },
    ]));
    expect(body.data.some(({ range }) => range === "'Raw_Data'!B2" || range === "'Raw_Data'!D2" || range === "'Raw_Data'!E2")).toBe(false);
  });

  it('dopina nowy dzień przez append i pozostawia niepodane pola puste', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: 'checkin-append-token', expires_in: 3600 }))
      .mockResolvedValueOnce(response(200, { values: [headers] }))
      .mockResolvedValueOnce(response(200, { updates: { updatedRange: "'Raw_Data'!A109:Z109" } }));
    const result = await updateDailyCheckin(checkin, { env: environment(), fetchImpl, now: new Date('2026-11-17T08:00:00Z') });
    expect(result).toMatchObject({ action: 'append', rowNumber: 109 });
    expect(decodeURIComponent(fetchImpl.mock.calls[2][0])).toContain("'Raw_Data'!A:BI:append");
    const values = JSON.parse(fetchImpl.mock.calls[2][1].body).values[0];
    expect(values[headers.indexOf('Date')]).toBe('2026-11-17');
    expect(values[headers.indexOf('Weight_kg')]).toBe('');
    expect(values[headers.indexOf('HRV_orthostatic_rMSSD_ms')]).toBe(56);
  });
});
