import { createHash, createSign } from 'node:crypto';
import { feedbackBatchData, planTrainingFeedbackUpdate } from '../../src/trainingFeedbackServer.js';
import { reconcileTcxImport, resolvePlanStagedTarget, TCX_STAGED_IMPORT_SCHEMA } from '../../src/tcxImport.js';
import { stringifyHrTargetStages } from '../../src/hrTargetStages.js';
import { planStravaActivityAppend } from '../../src/stravaImport.js';

let tokenCache = null;

export const APPLICATION_SHEET_RANGES = {
  feed: "'APP_FEED'",
  log: "'Training Log'",
  plan: "'Plan'",
  raw: "'Raw_Data'",
};

const TRAINING_LOG_TABLE_RANGE = "'Training Log'!A1:AR2000";
const PLAN_TABLE_RANGE = "'Plan'!A1:O2000";
const TRAINING_LOG_APPEND_RANGE = "'Training Log'!A:A";
const LOGIN_LIMIT_SHEET = 'Auth_Limits';
const LOGIN_LIMIT_RANGE = "'Auth_Limits'!A1:E2000";
const LOGIN_LIMIT_HEADER = ['Client_Key_HMAC', 'Window_Started_At', 'Failures', 'Blocked_Until', 'Updated_At'];

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
  const identity = createHash('sha256')
    .update(String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''))
    .update('\0')
    .update(String(env.GOOGLE_PRIVATE_KEY || ''))
    .digest('hex');
  if (tokenCache?.identity === identity && tokenCache.expiresAt > now + 60000) return tokenCache.value;
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
  tokenCache = { identity, value: body.access_token, expiresAt: now + Number(body.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function valuesUrl(sheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;
}

function batchValuesUrl(sheetId, ranges) {
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  ranges.forEach((range) => params.append('ranges', range));
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`;
}

function spreadsheetUrl(sheetId) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
}

function hasLoginLimitSheet(metadata = {}) {
  return (metadata.sheets || []).some((sheet) => sheet?.properties?.title === LOGIN_LIMIT_SHEET);
}

async function loginLimitMetadata(env, fetchImpl, headers) {
  const response = await fetchImpl(`${spreadsheetUrl(env.GOOGLE_SHEET_ID)}?fields=sheets.properties`, { headers });
  if (!response.ok) throw new Error(`google-rate-limit-metadata-${response.status}`);
  return response.json();
}

async function ensureLoginLimitSheet(env, fetchImpl, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const metadata = await loginLimitMetadata(env, fetchImpl, headers);
  if (hasLoginLimitSheet(metadata)) return;
  const createResponse = await fetchImpl(`${spreadsheetUrl(env.GOOGLE_SHEET_ID)}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: LOGIN_LIMIT_SHEET, hidden: true } } }] }),
  });
  if (!createResponse.ok) {
    // Dwie równoległe pierwsze próby mogą obie zobaczyć brak zakładki. Google zwraca
    // wtedy konflikt albo 400; ponowny odczyt rozstrzyga, czy druga instancja już ją utworzyła.
    const afterRace = await loginLimitMetadata(env, fetchImpl, headers);
    if (!hasLoginLimitSheet(afterRace)) throw new Error(`google-rate-limit-create-${createResponse.status}`);
  }
  const headerResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, "'Auth_Limits'!A1:E1")}?valueInputOption=RAW`, {
    method: 'PUT', headers, body: JSON.stringify({ majorDimension: 'ROWS', values: [LOGIN_LIMIT_HEADER] }),
  });
  if (!headerResponse.ok) throw new Error(`google-rate-limit-header-${headerResponse.status}`);
}

export async function readLoginLimitRows(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  await ensureLoginLimitSheet(env, fetchImpl, token);
  const response = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, LOGIN_LIMIT_RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`google-rate-limit-read-${response.status}`);
  const values = (await response.json()).values || [];
  return values.slice(1);
}

export async function upsertLoginLimitRecord(record, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const values = [[
    record.key,
    record.windowStartedAt ? new Date(record.windowStartedAt).toISOString() : '',
    record.failures,
    record.blockedUntil ? new Date(record.blockedUntil).toISOString() : '',
    new Date(record.updatedAt).toISOString(),
  ]];
  const range = record.rowNumber ? `'Auth_Limits'!A${record.rowNumber}:E${record.rowNumber}` : "'Auth_Limits'!A:E";
  const suffix = record.rowNumber ? '' : ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  const response = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, range)}${suffix}`, {
    method: record.rowNumber ? 'PUT' : 'POST', headers,
    body: JSON.stringify({ majorDimension: 'ROWS', values }),
  });
  if (!response.ok) throw new Error(`google-rate-limit-write-${response.status}`);
}

export async function readApplicationTables(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const entries = Object.entries(APPLICATION_SHEET_RANGES);
  const response = await fetchImpl(batchValuesUrl(env.GOOGLE_SHEET_ID, entries.map(([, range]) => range)), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`google-read-${response.status}`);
  const body = await response.json();
  const valueRanges = Array.isArray(body.valueRanges) ? body.valueRanges : [];
  return Object.fromEntries(entries.map(([key], index) => [
    key,
    Array.isArray(valueRanges[index]?.values) ? valueRanges[index].values : [],
  ]));
}

export async function updateTrainingFeedback(feedback, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const tableResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, TRAINING_LOG_TABLE_RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
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

export async function updateTcxImport(envelope, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const tableResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, TRAINING_LOG_TABLE_RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!tableResponse.ok) throw new Error(`google-read-${tableResponse.status}`);
  const values = (await tableResponse.json()).values || [];
  const table = {
    headers: Array.isArray(values[0]) ? values[0].map((value) => String(value ?? '')) : [],
    rows: values.slice(1).map((row, index) => ({ rowNumber: index + 2, values: row })),
  };
  const staged = envelope.schema === TCX_STAGED_IMPORT_SCHEMA;
  let reconciliation;
  if (staged) {
    const planResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, PLAN_TABLE_RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!planResponse.ok) throw new Error(`google-plan-read-${planResponse.status}`);
    const planValues = (await planResponse.json()).values || [];
    const planTable = {
      headers: Array.isArray(planValues[0]) ? planValues[0].map((value) => String(value ?? '')) : [],
      rows: planValues.slice(1).map((row, index) => ({ rowNumber: index + 2, values: row })),
    };
    const planTarget = resolvePlanStagedTarget(table, planTable, envelope.sessionId);
    if (planTarget.action !== 'resolved') return planTarget;
    const proposedStages = stringifyHrTargetStages(envelope.targetStages);
    if (planTarget.targetStages !== proposedStages) {
      return {
        action: 'conflict', sessionId: envelope.sessionId,
        reason: 'Cel etapowy z TCX nie odpowiada celowi zapisanym w Planie.',
        conflicts: [{ header: 'HR_Target_Stages_JSON', current: planTarget.targetStages, proposed: proposedStages }],
      };
    }
    reconciliation = reconcileTcxImport(table, envelope, { allowStageBootstrap: true });
  } else {
    reconciliation = reconcileTcxImport(table, envelope);
  }
  if (reconciliation.action !== 'update') return reconciliation;

  const updateResponse = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      valueInputOption: 'RAW',
      includeValuesInResponse: true,
      data: reconciliation.updates.map((update) => ({
        range: `'Training Log'!${update.range}`,
        values: [update.values],
      })),
    }),
  });
  if (!updateResponse.ok) throw new Error(`google-write-${updateResponse.status}`);
  const result = await updateResponse.json();
  return {
    ...reconciliation,
    updatedRanges: result.responses?.map(({ updatedRange }) => updatedRange).filter(Boolean) || [],
  };
}

export async function appendStravaActivity(record, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const tableResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, TRAINING_LOG_TABLE_RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!tableResponse.ok) throw new Error(`google-read-${tableResponse.status}`);
  const table = (await tableResponse.json()).values || [];
  const plan = planStravaActivityAppend(table, record);
  if (plan.action !== 'append') return plan;

  const appendResponse = await fetchImpl(`${valuesUrl(env.GOOGLE_SHEET_ID, TRAINING_LOG_APPEND_RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=true`, {
    method: 'POST', headers,
    body: JSON.stringify({ majorDimension: 'ROWS', values: [plan.rowValues] }),
  });
  if (!appendResponse.ok) throw new Error(`google-write-${appendResponse.status}`);
  const response = await appendResponse.json();
  return {
    ...plan,
    updatedRange: response.updates?.updatedRange || null,
    rowNumber: response.updates?.updatedRange?.match(/!(?:[A-Z]+)(\d+)(?::[A-Z]+\d+)?$/)?.[1]
      ? Number(response.updates.updatedRange.match(/!(?:[A-Z]+)(\d+)(?::[A-Z]+\d+)?$/)[1]) : null,
  };
}
