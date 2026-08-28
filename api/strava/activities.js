import { authenticated } from '../_lib/session.js';
import { methodNotAllowed, sendJson } from '../_lib/http.js';
import { listStravaActivities, queryValue, readStravaCredentials, stravaConfiguration, stravaTokenCookie } from '../_lib/strava.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    methodNotAllowed(response, ['GET']);
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }
  if (!stravaConfiguration().configured) {
    sendJson(response, 503, { ok: false, error: 'strava-not-configured' });
    return;
  }
  const credentials = readStravaCredentials(request, process.env.STRAVA_TOKEN_SECRET);
  if (!credentials) {
    sendJson(response, 409, { ok: false, error: 'strava-not-connected' });
    return;
  }
  try {
    const result = await listStravaActivities(credentials, process.env, fetch, {
      limit: queryValue(request, 'limit') || 10,
      page: queryValue(request, 'page') || 1,
    });
    sendJson(response, 200, {
      ok: true, activities: result.activities, page: result.page, limit: result.limit, hasMore: result.hasMore,
    }, result.refreshed
      ? { 'Set-Cookie': stravaTokenCookie(result.credentials, process.env.STRAVA_TOKEN_SECRET) }
      : {});
  } catch (error) {
    console.error('strava-activities', error.message);
    const status = error.message === 'strava-scope-not-granted' ? 403 : 502;
    sendJson(response, status, { ok: false, error: status === 403 ? 'strava-scope-required' : 'strava-unavailable' }, error.credentials
      ? { 'Set-Cookie': stravaTokenCookie(error.credentials, process.env.STRAVA_TOKEN_SECRET) }
      : {});
  }
}
