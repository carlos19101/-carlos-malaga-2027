import { methodNotAllowed, readJson, sendJson } from './_lib/http.js';
import {
  allowedRequestOrigin,
  authenticated,
  clearSessionCookie,
  createSessionToken,
  passcodeMatches,
  serviceConfiguration,
  sessionCookie,
} from './_lib/session.js';

export default async function handler(request, response) {
  const configuration = serviceConfiguration();
  if (request.method === 'GET') {
    sendJson(response, 200, { ok: true, configured: configuration.configured, authenticated: authenticated(request) });
    return;
  }
  if (!['POST', 'DELETE'].includes(request.method)) {
    methodNotAllowed(response, ['GET', 'POST', 'DELETE']);
    return;
  }
  if (!allowedRequestOrigin(request)) {
    sendJson(response, 403, { ok: false, error: 'origin-not-allowed' });
    return;
  }
  if (request.method === 'DELETE') {
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    return;
  }
  if (!configuration.configured) {
    sendJson(response, 503, { ok: false, configured: false, error: 'feedback-not-configured' });
    return;
  }
  try {
    const body = await readJson(request, 1024);
    if (!(await passcodeMatches(body.passcode, process.env.APP_PASSCODE_SCRYPT))) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      sendJson(response, 401, { ok: false, error: 'invalid-passcode' });
      return;
    }
    const token = createSessionToken(process.env.SESSION_SECRET);
    sendJson(response, 200, { ok: true, configured: true, authenticated: true }, { 'Set-Cookie': sessionCookie(token) });
  } catch (error) {
    sendJson(response, error.message === 'payload-too-large' ? 413 : 400, { ok: false, error: 'invalid-request' });
  }
}
