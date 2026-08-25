import { methodNotAllowed, readJson, sendJson } from './_lib/http.js';
import { allowedRequestOrigin, authenticated, serviceConfiguration } from './_lib/session.js';
import { updateTrainingFeedback } from './_lib/googleSheets.js';
import { validateTrainingFeedback } from '../src/trainingFeedback.js';

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
    sendJson(response, 503, { ok: false, error: 'feedback-not-configured' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }

  try {
    const body = await readJson(request, 4096);
    const validated = validateTrainingFeedback(body);
    if (!validated.ok) {
      sendJson(response, 422, { ok: false, error: 'validation-error', fields: validated.errors });
      return;
    }
    const result = await updateTrainingFeedback(validated.value);
    const status = {
      update: 200, noop: 200, stale: 200,
      'session-not-found': 404, 'duplicate-session': 409, 'contract-error': 409, invalid: 422,
    }[result.action] || 500;
    sendJson(response, status, {
      ok: status < 300,
      action: result.action,
      sessionId: result.sessionId,
      feedbackId: result.feedbackId,
      rowNumber: result.rowNumber,
      reason: result.reason,
      missingHeaders: result.missingHeaders,
    });
  } catch (error) {
    console.error('training-feedback', error.message);
    sendJson(response, 502, { ok: false, error: 'sheets-unavailable' });
  }
}
