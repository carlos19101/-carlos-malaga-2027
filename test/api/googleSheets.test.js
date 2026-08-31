import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { appendStravaActivity, createGoogleAssertion, readApplicationTables, readLoginLimitRows, updateTcxImport, updateTrainingFeedback, upsertLoginLimitRecord } from '../../api/_lib/googleSheets.js';
import { createStravaImportRecord } from '../../src/stravaImport.js';
import { createTcxImport } from '../../src/tcxImport.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey,
  };
}

const HEADERS = [
  'Date', 'Duration_min', 'RPE', 'sRPE', 'Pain', 'Session_ID',
  'Leg_Fatigue_0_10', 'Feedback_ID', 'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At',
];

describe('Google Sheets service account', () => {
  it.each([1, 0])('aktualizuje istniejący licznik logowania do %s przez PUT z RAW', async (failures) => {
    const { privateKey } = keyPair();
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).includes('oauth2.googleapis.com')) return jsonResponse(200, { access_token: 'limit-update-token', expires_in: 3600 });
      const parsed = new URL(url);
      expect(options.method).toBe('PUT');
      expect(decodeURIComponent(parsed.pathname)).toContain("'Auth_Limits'!A2:E2");
      expect(parsed.searchParams.get('valueInputOption')).toBe('RAW');
      expect(JSON.parse(options.body).values[0][2]).toBe(failures);
      return jsonResponse(200, { updatedCells: 5 });
    });
    await upsertLoginLimitRecord({
      key: 'test-client', rowNumber: 2, failures,
      windowStartedAt: Date.parse('2026-08-31T10:00:00Z'), blockedUntil: 0,
      updatedAt: Date.parse('2026-08-31T10:01:00Z'),
    }, {
      env: { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'limit-update@example.test', GOOGLE_PRIVATE_KEY: privateKey, GOOGLE_SHEET_ID: 'test-sheet' },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('tworzy prawidłowo podpisany JWT o ograniczonym zakresie', () => {
    const { privateKey, publicKey } = keyPair();
    const assertion = createGoogleAssertion({
      email: 'service@example.test', privateKey, now: new Date('2026-08-25T20:00:00.000Z'),
    });
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: 'service@example.test', scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('odczytuje tabelę, planuje update i wysyła wyłącznie komórki feedbacku', async () => {
    const { privateKey } = keyPair();
    const row = ['2026-08-25', 40, '', '', '', '2026-08-25-run-01', '', '', '', '', ''];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [HEADERS, row] }))
      .mockResolvedValueOnce(jsonResponse(200, { responses: [{ updatedRange: "'Training Log'!C2" }] }));
    const result = await updateTrainingFeedback({
      sessionId: '2026-08-25-run-01', feedbackId: 'feedback-12345678',
      submittedAt: '2026-08-25T20:00:00.000Z', rpe: 3, pain: 0, legFatigue: 2, notes: 'OK',
    }, {
      env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.test', GOOGLE_PRIVATE_KEY: privateKey, GOOGLE_SHEET_ID: 'sheet',
      },
      fetchImpl,
      now: new Date('2026-08-25T20:01:00.000Z'),
    });
    expect(result).toMatchObject({ action: 'update', rowNumber: 2, srpe: 120 });
    expect(decodeURIComponent(fetchImpl.mock.calls[1][0])).toContain("'Training Log'!A1:AR2000");
    const writeBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(writeBody.valueInputOption).toBe('RAW');
    expect(writeBody.data).toEqual(expect.arrayContaining([
      { range: "'Training Log'!C2", values: [[3]] },
      { range: "'Training Log'!G2", values: [[2]] },
    ]));
  });

  it('pobiera cztery arkusze jednym prywatnym batchGet', async () => {
    const { privateKey } = keyPair();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'private-read-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        valueRanges: [
          { values: [['Date'], ['2026-08-25']] },
          { values: [['Date'], ['2026-08-25']] },
          { values: [['Data'], ['2026-08-25']] },
          { values: [['Date'], ['2026-08-25']] },
        ],
      }));
    const result = await readApplicationTables({
      env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'private-read@example.test',
        GOOGLE_PRIVATE_KEY: privateKey,
        GOOGLE_SHEET_ID: 'private-sheet',
      },
      fetchImpl,
    });
    expect(Object.keys(result)).toEqual(['feed', 'log', 'plan', 'raw']);
    expect(result.plan[0]).toEqual(['Data']);
    const [url, options] = fetchImpl.mock.calls[1];
    expect(url).toContain('/values:batchGet?');
    expect(url).toContain('valueRenderOption=FORMATTED_VALUE');
    expect(new URL(url).searchParams.getAll('ranges')).toEqual([
      "'APP_FEED'", "'Training Log'", "'Plan'", "'Raw_Data'",
    ]);
    expect(options.headers.Authorization).toBe('Bearer private-read-token');
  });

  it('przetrwa równoległe utworzenie trwałej zakładki ochrony logowania', async () => {
    const { privateKey } = keyPair();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'limit-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { sheets: [] }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: 'A sheet with the name Auth_Limits already exists.' } }))
      .mockResolvedValueOnce(jsonResponse(200, { sheets: [{ properties: { title: 'Auth_Limits' } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { updatedRange: "'Auth_Limits'!A1:E1" }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [['Client_Key_HMAC', 'Window_Started_At', 'Failures', 'Blocked_Until', 'Updated_At']] }));
    await expect(readLoginLimitRows({
      env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'limit@example.test', GOOGLE_PRIVATE_KEY: privateKey, GOOGLE_SHEET_ID: 'private-sheet',
      },
      fetchImpl,
    })).resolves.toEqual([]);
    expect(fetchImpl.mock.calls[3][0]).toContain('fields=sheets.properties');
    expect(fetchImpl.mock.calls[4][0]).toContain('Auth_Limits');
  });

  it('import TCX zapisuje tylko ciągły blok atomowy dopasowanej sesji', async () => {
    const { privateKey } = keyPair();
    const headers = Array.from({ length: 43 }, (_, index) => `Column_${index + 1}`);
    headers[0] = 'Date';
    headers[23] = 'Session_ID';
    headers.splice(35, 6,
      'HR_Target_Min_bpm', 'HR_Target_Max_bpm',
      'Time_In_Target_s', 'Time_Above_Target_s', 'Time_Below_Target_s', 'HR_Analyzed_Duration_s',
    );
    const row = Array(43).fill('');
    row[0] = '2026-08-25';
    row[23] = '2026-08-25-run-01';
    const envelope = createTcxImport(`
      <Lap><Track>
        <Trackpoint><Time>2026-08-25T18:00:00Z</Time><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2026-08-25T18:00:01Z</Time><HeartRateBpm><Value>159</Value></HeartRateBpm></Trackpoint>
      </Track></Lap>`, {
      sessionId: '2026-08-25-run-01', targetMin: 145, targetMax: 158,
      sourceSha256: 'A'.repeat(64),
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tcx-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [headers, row] }))
      .mockResolvedValueOnce(jsonResponse(200, { responses: [{ updatedRange: "'Training Log'!AJ2:AO2" }] }));

    const result = await updateTcxImport(envelope, {
      env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'tcx-import@example.test',
        GOOGLE_PRIVATE_KEY: privateKey,
        GOOGLE_SHEET_ID: 'private-sheet',
      },
      fetchImpl,
    });
    expect(result).toMatchObject({ action: 'update', rowNumber: 2, range: 'AJ2:AO2' });
    expect(decodeURIComponent(fetchImpl.mock.calls[1][0])).toContain("'Training Log'!A1:AR2000");
    const writeBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(writeBody).toMatchObject({
      valueInputOption: 'RAW',
      data: [{ range: "'Training Log'!AJ2:AO2", values: [[145, 158, 1, 0, 0, 1]] }],
    });
  });

  it('import progresywny weryfikuje etap z Planu i zapisuje go razem z atomami', async () => {
    const { privateKey } = keyPair();
    const headers = Array.from({ length: 44 }, (_, index) => `Column_${index + 1}`);
    headers[0] = 'Date';
    headers[23] = 'Session_ID';
    headers.splice(35, 4, 'Time_In_Target_s', 'Time_Above_Target_s', 'Time_Below_Target_s', 'HR_Analyzed_Duration_s');
    headers[43] = 'HR_Target_Stages_JSON';
    const row = Array(44).fill('');
    row[0] = '2026-08-29';
    row[23] = '2026-08-29-run-01';
    const targetStages = JSON.stringify({ schema: 'carlos.hr-target-stages.v1', stages: [
      { name: 'WU', durationSeconds: 1, min: 135, max: 145 },
      { name: 'CD', durationSeconds: 1, max: 150 },
    ] });
    const envelope = createTcxImport(`
      <Lap><Track>
        <Trackpoint><Time>2026-08-29T18:00:00Z</Time><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2026-08-29T18:00:01Z</Time><HeartRateBpm><Value>149</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2026-08-29T18:00:02Z</Time><HeartRateBpm><Value>145</Value></HeartRateBpm></Trackpoint>
      </Track></Lap>`, {
      sessionId: '2026-08-29-run-01', targetStages, sourceSha256: 'B'.repeat(64),
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'staged-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [headers, row] }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [['Data', 'HR_Target_Stages_JSON'], ['2026-08-29', targetStages]] }))
      .mockResolvedValueOnce(jsonResponse(200, { responses: [{ updatedRange: "'Training Log'!AJ2:AM2" }, { updatedRange: "'Training Log'!AR2" }] }));

    const result = await updateTcxImport(envelope, {
      env: { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'staged@example.test', GOOGLE_PRIVATE_KEY: privateKey, GOOGLE_SHEET_ID: 'private-sheet' },
      fetchImpl,
    });
    expect(result).toMatchObject({ action: 'update', rowNumber: 2, range: 'AJ2:AM2' });
    expect(decodeURIComponent(fetchImpl.mock.calls[2][0])).toContain("'Plan'!A1:O2000");
    const writeBody = JSON.parse(fetchImpl.mock.calls[3][1].body);
    expect(writeBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: "'Training Log'!AJ2:AM2" }),
      expect.objectContaining({ range: "'Training Log'!AR2", values: [[envelope.targetStages]] }),
    ]));
  });

  it('import Stravy dopisuje nowy pełny wiersz wyłącznie, gdy Session_ID nie istnieje', async () => {
    const { privateKey } = keyPair();
    const headers = ['Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'RPE', 'sRPE', 'Notes', 'Source', 'Status', 'Session_ID'];
    const record = createStravaImportRecord({
      id: '123456789', name: 'Lekka mobilizacja', startLocal: '2026-08-25T16:00:18Z', elapsedSeconds: 3750, distanceMeters: 0,
    }, { activityId: '123456789', category: 'Mobilizacja', rpe: 1 }).record;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'strava-import-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { values: [headers] }))
      .mockResolvedValueOnce(jsonResponse(200, { updates: { updatedRange: "'Training Log'!A2:L2" } }));
    const result = await appendStravaActivity(record, {
      env: { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'strava-import@example.test', GOOGLE_PRIVATE_KEY: privateKey, GOOGLE_SHEET_ID: 'private-sheet' },
      fetchImpl,
    });
    expect(result).toMatchObject({ action: 'append', sessionId: 'strava-123456789', rowNumber: 2 });
    expect(decodeURIComponent(fetchImpl.mock.calls[1][0])).toContain("'Training Log'!A1:AR2000");
    expect(fetchImpl.mock.calls[2][0]).toContain(':append?');
    const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(body).toMatchObject({ majorDimension: 'ROWS', values: [expect.arrayContaining(['Mobilizacja', 'Strava', 'strava-123456789'])] });
  });
});
