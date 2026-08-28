import { appendStravaActivity } from '../_lib/googleSheets.js';
import { methodNotAllowed, readJson, sendJson } from '../_lib/http.js';
import { allowedRequestOrigin, authenticated, serviceConfiguration } from '../_lib/session.js';
import { getStravaActivity, readStravaCredentials, stravaConfiguration, stravaTokenCookie } from '../_lib/strava.js';
import { createStravaImportRecord, validateStravaImportRequest } from '../../src/stravaImport.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    methodNotAllowed(response, ['POST']);
    return;
  }
  if (!allowedRequestOrigin(request)) {
    sendJson(response, 403, { ok: false, error: 'origin-not-allowed' });
    return;
  }
  if (!serviceConfiguration().configured || !stravaConfiguration().configured) {
    sendJson(response, 503, { ok: false, error: 'strava-import-not-configured' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }
  const credentials = readStravaCredentials(request, process.env.STRAVA_TOKEN_SECRET);
  if (!credentials) {
    sendJson(response, 409, { ok: false, error: 'strava-not-connected' });
    return;
  }

  try {
    const validation = validateStravaImportRequest(await readJson(request, 2048));
    if (validation.action !== 'valid') {
      sendJson(response, 422, { ok: false, error: 'validation-error', fields: validation.errors });
      return;
    }
    const source = await getStravaActivity(credentials, validation.value.activityId, process.env, fetch);
    const prepared = createStravaImportRecord(source.activity, validation.value);
    if (prepared.action !== 'ready') {
      sendJson(response, 422, { ok: false, error: 'source-validation-error', reason: prepared.reason });
      return;
    }
    const result = await appendStravaActivity(prepared.record);
    const status = {
      append: 201, noop: 200, 'duplicate-session': 409, 'contract-error': 409,
    }[result.action] || 500;
    sendJson(response, status, {
      ok: status < 300,
      action: result.action,
      sessionId: result.sessionId,
      activityId: result.activityId || prepared.record.activityId,
      category: prepared.record.category,
      rowNumber: result.rowNumber,
      missingHeaders: result.missingHeaders,
    }, source.refreshed ? { 'Set-Cookie': stravaTokenCookie(source.credentials, process.env.STRAVA_TOKEN_SECRET) } : {});
  } catch (error) {
    console.error('strava-import', error.message);
    const status = error.message === 'payload-too-large' ? 413
      : error instanceof SyntaxError ? 400
        : error.message === 'strava-activity-404' ? 404 : 502;
    const code = status === 413 ? 'payload-too-large'
      : status === 400 ? 'invalid-request'
        : status === 404 ? 'strava-activity-not-found' : 'strava-import-unavailable';
    sendJson(response, status, { ok: false, error: code }, error.credentials
      ? { 'Set-Cookie': stravaTokenCookie(error.credentials, process.env.STRAVA_TOKEN_SECRET) } : {});
  }
}
