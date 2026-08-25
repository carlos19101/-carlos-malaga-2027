import { createSign } from 'node:crypto';
import { feedbackBatchData, planTrainingFeedbackUpdate } from '../../src/trainingFeedbackServer.js';

let tokenCache = null;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createGoogleAssertion({ email, privateKey, now = new Date() }) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = base64urlJson({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey.replaceAll('\\n', '\n')).toString('base64url')}`;
}

async function accessToken(env = process.env, fetchImpl = fetch) {
  const now = Date.now();
  if (tokenCache?.expiresAt > now + 60000) return tokenCache.value;
  const assertion = createGoogleAssertion({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`google-auth-${response.status}`);
  const body = await response.json();
  tokenCache = { value: body.access_token, expiresAt: now + Number(body.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function valuesUrl(sheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;
}

export async function updateTrainingFeedback(feedback, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const tableResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, "'Training Log'!A1:AI2000")}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!tableResponse.ok) throw new Error(`google-read-${tableResponse.status}`);
  const table = (await tableResponse.json()).values || [];
  const plan = planTrainingFeedbackUpdate(table, feedback, { syncedAt: options.now || new Date() });
  if (plan.action !== 'update') return plan;

  const updateResponse = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      valueInputOption: 'RAW',
      includeValuesInResponse: true,
      data: feedbackBatchData(plan),
    }),
  });
  if (!updateResponse.ok) throw new Error(`google-write-${updateResponse.status}`);
  const result = await updateResponse.json();
  return { ...plan, updatedRanges: result.responses?.map(({ updatedRange }) => updatedRange).filter(Boolean) || [] };
}
