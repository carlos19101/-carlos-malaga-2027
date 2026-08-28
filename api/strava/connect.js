import { authenticated } from '../_lib/session.js';
import { createStravaState, redirect, stravaAuthorizeUrl, stravaConfiguration, stravaStateCookie, stravaReturnUrl } from '../_lib/strava.js';

export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    response.end();
    return;
  }
  if (!authenticated(request)) {
    redirect(response, stravaReturnUrl(process.env, 'authentication-required'));
    return;
  }
  if (!stravaConfiguration().configured) {
    redirect(response, stravaReturnUrl(process.env, 'not-configured'));
    return;
  }
  const state = createStravaState(process.env.STRAVA_TOKEN_SECRET);
  redirect(response, stravaAuthorizeUrl(process.env, state), { 'Set-Cookie': stravaStateCookie(state) });
}
