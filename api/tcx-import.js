import { methodNotAllowed, readJson, sendJson } from './_lib/http.js';
import { allowedRequestOrigin, authenticated, serviceConfiguration } from './_lib/session.js';
import { updateTcxImport } from './_lib/googleSheets.js';
import { validateTcxImportEnvelope } from '../src/tcxImport.js';

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
    sendJson(response, 503, { ok: false, configured: false, error: 'tcx-import-not-configured' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }

  try {
    const envelope = await readJson(request, 8192);
    const validation = validateTcxImportEnvelope(envelope);
    if (validation.action !== 'valid') {
      sendJson(response, 422, {
        ok: false,
        error: 'validation-error',
        reason: validation.reason,
        invalidAtomicHeaders: validation.invalidAtomicHeaders,
      });
      return;
    }
    const result = await updateTcxImport(envelope);
    const status = {
      update: 200,
      noop: 200,
      conflict: 409,
      'missing-session': 404,
      'duplicate-session': 409,
      'contract-error': 409,
    }[result.action] || 500;
    sendJson(response, status, {
      ok: status < 300,
      action: result.action,
      sessionId: result.sessionId,
      rowNumber: result.rowNumber,
      reason: result.reason,
      range: result.range,
      conflicts: result.conflicts,
      missingHeaders: result.missingHeaders,
    });
  } catch (error) {
    console.error('tcx-import', error.message);
    const status = error.message === 'payload-too-large' ? 413 : error instanceof SyntaxError ? 400 : 502;
    const code = status === 413 ? 'payload-too-large' : status === 400 ? 'invalid-request' : 'sheets-unavailable';
    sendJson(response, status, { ok: false, error: code });
  }
}
