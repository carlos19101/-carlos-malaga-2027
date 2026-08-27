import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGoogleAssertion, readApplicationTables, updateTcxImport, updateTrainingFeedback } from '../../api/_lib/googleSheets.js';
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
    expect(decodeURIComponent(fetchImpl.mock.calls[1][0])).toContain("'Training Log'!A1:AQ2000");
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
    expect(decodeURIComponent(fetchImpl.mock.calls[1][0])).toContain("'Training Log'!A1:AQ2000");
    const writeBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(writeBody).toMatchObject({
      valueInputOption: 'RAW',
      data: [{ range: "'Training Log'!AJ2:AO2", values: [[145, 158, 1, 0, 0, 1]] }],
    });
  });
});
