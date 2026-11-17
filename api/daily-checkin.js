import { isInvalidRequestError, methodNotAllowed, readJson, sendJson } from './_lib/http.js';
import { allowedRequestOrigin, authenticated, serviceConfiguration } from './_lib/session.js';
import { updateDailyCheckin } from './_lib/googleSheets.js';
import { consumeDailyCheckinRequest } from './_lib/dailyCheckinRateLimit.js';
import { validateDailyCheckin } from '../src/dailyCheckin.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    methodNotAllowed(response, ['POST']);
    return;
  }
  if (!allowedRequestOrigin(request)) {
    sendJson(response, 403, { ok: false, error: 'origin-not-allowed' });
    return;
  }
  if (!serviceConfiguration().configured) {
    sendJson(response, 503, { ok: false, configured: false, error: 'private-data-not-configured' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }

  try {
    const rate = await consumeDailyCheckinRequest(request);
    if (!rate.allowed) {
      sendJson(response, 429, { ok: false, error: 'rate-limited' }, { 'Retry-After': String(rate.retryAfterSeconds) });
      return;
    }
    const body = await readJson(request, 4096);
    const validated = validateDailyCheckin(body);
    if (!validated.ok) {
      sendJson(response, 422, { ok: false, error: 'validation-error', fields: validated.errors });
      return;
    }
    const result = await updateDailyCheckin(validated.value);
    if (result.action === 'contract-error') {
      sendJson(response, 409, { ok: false, action: result.action, missingHeaders: result.missingHeaders });
      return;
    }
    if (!['append', 'update'].includes(result.action)) {
      sendJson(response, 422, { ok: false, error: 'invalid-checkin' });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      action: result.action,
      date: result.date,
      rowNumber: result.rowNumber || null,
    });
  } catch (error) {
    console.error('daily-checkin', error.message);
    const status = error.message === 'payload-too-large' ? 413 : isInvalidRequestError(error) ? 400 : 502;
    const code = status === 413 ? 'payload-too-large' : status === 400 ? 'invalid-request' : 'checkin-unavailable';
    sendJson(response, status, { ok: false, error: code });
  }
}
