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
import { checkLoginRateLimit, clearLoginRateLimit, recordLoginFailure } from './_lib/loginRateLimit.js';

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
    const rateLimit = await checkLoginRateLimit(request);
    if (!rateLimit.allowed) {
      sendJson(response, 429, { ok: false, error: 'too-many-login-attempts' }, { 'Retry-After': String(rateLimit.retryAfterSeconds) });
      return;
    }
    if (!(await passcodeMatches(body.passcode, process.env.APP_PASSCODE_SCRYPT))) {
      const failure = await recordLoginFailure(request);
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!failure.allowed) {
        sendJson(response, 429, { ok: false, error: 'too-many-login-attempts' }, { 'Retry-After': String(failure.retryAfterSeconds) });
        return;
      }
      sendJson(response, 401, { ok: false, error: 'invalid-passcode' });
      return;
    }
    await clearLoginRateLimit(request);
    const token = createSessionToken(process.env.SESSION_SECRET);
    sendJson(response, 200, { ok: true, configured: true, authenticated: true }, { 'Set-Cookie': sessionCookie(token) });
  } catch (error) {
    const status = error.message === 'payload-too-large' ? 413 : error.message?.startsWith('google-rate-limit-') ? 503 : 400;
    sendJson(response, status, { ok: false, error: status === 503 ? 'login-protection-unavailable' : 'invalid-request' });
  }
}
