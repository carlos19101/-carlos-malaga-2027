import { authenticated } from '../_lib/session.js';
import { methodNotAllowed, sendJson } from '../_lib/http.js';
import { readStravaCredentials, stravaConfiguration } from '../_lib/strava.js';

export default function handler(request, response) {
  if (request.method !== 'GET') {
    methodNotAllowed(response, ['GET']);
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }
  const configuration = stravaConfiguration();
  if (!configuration.configured) {
    sendJson(response, 200, { ok: true, configured: false, connected: false });
    return;
  }
  const credentials = readStravaCredentials(request, process.env.STRAVA_TOKEN_SECRET);
  sendJson(response, 200, {
    ok: true,
    configured: true,
    connected: Boolean(credentials),
    athleteId: credentials?.athleteId || null,
    scope: credentials?.scope || [],
  });
}
