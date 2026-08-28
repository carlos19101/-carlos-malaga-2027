import { allowedRequestOrigin, authenticated } from '../_lib/session.js';
import { methodNotAllowed, sendJson } from '../_lib/http.js';
import { clearStravaTokenCookie } from '../_lib/strava.js';

export default function handler(request, response) {
  if (request.method !== 'POST') {
    methodNotAllowed(response, ['POST']);
    return;
  }
  if (!allowedRequestOrigin(request)) {
    sendJson(response, 403, { ok: false, error: 'origin-not-allowed' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }
  sendJson(response, 200, { ok: true, connected: false }, { 'Set-Cookie': clearStravaTokenCookie() });
}
