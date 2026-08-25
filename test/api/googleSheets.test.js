import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGoogleAssertion, updateTrainingFeedback } from '../../api/_lib/googleSheets.js';

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
    const writeBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(writeBody.valueInputOption).toBe('RAW');
    expect(writeBody.data).toEqual(expect.arrayContaining([
      { range: "'Training Log'!C2", values: [[3]] },
      { range: "'Training Log'!G2", values: [[2]] },
    ]));
  });
});
