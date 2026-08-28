import {
  clearStravaStateCookie,
  exchangeStravaCode,
  queryValue,
  redirect,
  stravaConfiguration,
  stravaReturnUrl,
  stravaTokenCookie,
  verifyStravaState,
} from '../_lib/strava.js';
import { parseCookies } from '../_lib/session.js';
import { STRAVA_STATE_COOKIE } from '../_lib/strava.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    response.end();
    return;
  }
  const configuration = stravaConfiguration();
  if (!configuration.configured) {
    redirect(response, stravaReturnUrl(process.env, 'not-configured'), { 'Set-Cookie': clearStravaStateCookie() });
    return;
  }
  const state = queryValue(request, 'state');
  const savedState = parseCookies(request.headers?.cookie || '')[STRAVA_STATE_COOKIE];
  const closeState = clearStravaStateCookie();
  if (!state || !savedState || state !== savedState || !verifyStravaState(state, process.env.STRAVA_TOKEN_SECRET)) {
    redirect(response, stravaReturnUrl(process.env, 'state-invalid'), { 'Set-Cookie': closeState });
    return;
  }
  if (queryValue(request, 'error')) {
    redirect(response, stravaReturnUrl(process.env, 'cancelled'), { 'Set-Cookie': closeState });
    return;
  }
  try {
    const credentials = await exchangeStravaCode(queryValue(request, 'code'));
    redirect(response, stravaReturnUrl(process.env, 'connected'), {
      'Set-Cookie': [stravaTokenCookie(credentials, process.env.STRAVA_TOKEN_SECRET), closeState],
    });
  } catch (error) {
    const status = error.message === 'strava-scope-not-granted' ? 'scope-required' : 'connection-failed';
    redirect(response, stravaReturnUrl(process.env, status), { 'Set-Cookie': closeState });
  }
}
