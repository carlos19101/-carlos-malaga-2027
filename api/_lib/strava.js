import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './session.js';

export const STRAVA_TOKEN_COOKIE = 'carlos_strava_token';
export const STRAVA_STATE_COOKIE = 'carlos_strava_oauth_state';
export const STRAVA_REQUIRED_SCOPE = 'activity:read_all';
const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sameValue(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encryptionKey(secret) {
  return createHash('sha256').update(String(secret || '')).digest();
}

function nowSeconds(now = new Date()) {
  return Math.floor((now instanceof Date ? now : new Date(now)).getTime() / 1000);
}

function appOrigin(env = process.env) {
  return String(env.APP_ORIGIN || 'https://carlos-malaga-2027.vercel.app')
    .split(',').map((value) => value.trim()).filter(Boolean)[0];
}

function cookie(name, value, { path, sameSite, maxAge }) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

function safeScope(scope) {
  return String(scope || '').split(/\s+/).map((value) => value.trim()).filter(Boolean).filter((value) => /^[a-z:_-]+$/i.test(value));
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function tokenPayload(value) {
  const refreshToken = typeof value?.refreshToken === 'string' && value.refreshToken.length <= 2048 ? value.refreshToken : null;
  const accessToken = typeof value?.accessToken === 'string' && value.accessToken.length <= 2048 ? value.accessToken : '';
  const expiresAt = finite(value?.expiresAt);
  const athleteId = String(value?.athleteId || '').trim();
  if (!refreshToken || !expiresAt || !athleteId || athleteId.length > 64) return null;
  return { v: 1, refreshToken, accessToken, expiresAt, athleteId, scope: safeScope(value.scope) };
}

export function stravaConfiguration(env = process.env) {
  const missing = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_TOKEN_SECRET']
    .filter((name) => !env[name]);
  return { configured: missing.length === 0, missing };
}

export function createStravaState(secret, options = {}) {
  if (!secret) throw new Error('missing-strava-token-secret');
  const now = nowSeconds(options.now);
  const payload = base64url(JSON.stringify({
    v: 1,
    iat: now,
    exp: now + (options.ttlSeconds || STATE_TTL_SECONDS),
    nonce: options.nonce || randomBytes(18).toString('base64url'),
  }));
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifyStravaState(state, secret, options = {}) {
  if (!state || !secret) return false;
  const [payload, suppliedSignature, extra] = String(state).split('.');
  if (!payload || !suppliedSignature || extra || !sameValue(suppliedSignature, hmac(secret, payload))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = nowSeconds(options.now);
    return decoded.v === 1 && typeof decoded.nonce === 'string' && decoded.nonce.length >= 12
      && Number.isFinite(decoded.iat) && Number.isFinite(decoded.exp)
      && decoded.iat <= now + 60 && decoded.exp > now;
  } catch {
    return false;
  }
}

export function stravaStateCookie(state) {
  return cookie(STRAVA_STATE_COOKIE, state, {
    path: '/api/strava/callback', sameSite: 'Lax', maxAge: STATE_TTL_SECONDS,
  });
}

export function clearStravaStateCookie() {
  return cookie(STRAVA_STATE_COOKIE, '', {
    path: '/api/strava/callback', sameSite: 'Lax', maxAge: 0,
  });
}

export function sealStravaCredentials(value, secret) {
  const payload = tokenPayload(value);
  if (!payload || !secret) throw new Error('invalid-strava-credentials');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function openStravaCredentials(sealed, secret) {
  if (!sealed || !secret) return null;
  const [version, ivValue, ciphertextValue, tagValue, extra] = String(sealed).split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue || !tagValue || extra) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const value = tokenPayload(JSON.parse(plaintext));
    return value ? { ...value, scope: value.scope } : null;
  } catch {
    return null;
  }
}

export function readStravaCredentials(request, secret) {
  return openStravaCredentials(parseCookies(request?.headers?.cookie || '')[STRAVA_TOKEN_COOKIE], secret);
}

export function stravaTokenCookie(credentials, secret) {
  return cookie(STRAVA_TOKEN_COOKIE, sealStravaCredentials(credentials, secret), {
    path: '/api/strava', sameSite: 'Strict', maxAge: TOKEN_TTL_SECONDS,
  });
}

export function clearStravaTokenCookie() {
  return cookie(STRAVA_TOKEN_COOKIE, '', {
    path: '/api/strava', sameSite: 'Strict', maxAge: 0,
  });
}

export function stravaAuthorizeUrl(env = process.env, state) {
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: String(env.STRAVA_CLIENT_ID || ''),
    response_type: 'code',
    redirect_uri: `${appOrigin(env)}/api/strava/callback`,
    approval_prompt: 'auto',
    scope: STRAVA_REQUIRED_SCOPE,
    state: String(state || ''),
  }).toString();
  return url.toString();
}

function validTokenResponse(body, previous = {}) {
  const refreshToken = typeof body?.refresh_token === 'string' && body.refresh_token.length <= 2048
    ? body.refresh_token : previous.refreshToken;
  const accessToken = typeof body?.access_token === 'string' && body.access_token.length <= 2048 ? body.access_token : '';
  const expiresAt = finite(body?.expires_at);
  const athleteId = String(body?.athlete?.id || previous.athleteId || '').trim();
  const scope = safeScope(body?.scope || previous.scope?.join(' '));
  if (!refreshToken || !accessToken || !expiresAt || !athleteId) return null;
  return { refreshToken, accessToken, expiresAt, athleteId, scope };
}

async function tokenRequest(params, env = process.env, fetchImpl = fetch) {
  const response = await fetchImpl('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: String(env.STRAVA_CLIENT_ID || ''),
      client_secret: String(env.STRAVA_CLIENT_SECRET || ''),
      ...params,
    }),
  });
  if (!response.ok) throw new Error(`strava-token-${response.status}`);
  return response.json();
}

export async function exchangeStravaCode(code, env = process.env, fetchImpl = fetch) {
  if (typeof code !== 'string' || !code || code.length > 1024) throw new Error('invalid-strava-code');
  const body = await tokenRequest({ code, grant_type: 'authorization_code' }, env, fetchImpl);
  const credentials = validTokenResponse(body);
  if (!credentials) throw new Error('invalid-strava-token-response');
  if (!credentials.scope.includes(STRAVA_REQUIRED_SCOPE)) throw new Error('strava-scope-not-granted');
  return credentials;
}

export async function refreshStravaCredentials(credentials, env = process.env, fetchImpl = fetch) {
  const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: credentials?.refreshToken || '' }, env, fetchImpl);
  const refreshed = validTokenResponse(body, credentials);
  if (!refreshed) throw new Error('invalid-strava-token-response');
  if (!refreshed.scope.includes(STRAVA_REQUIRED_SCOPE)) throw new Error('strava-scope-not-granted');
  return refreshed;
}

export async function activeStravaCredentials(credentials, env = process.env, fetchImpl = fetch, options = {}) {
  const now = nowSeconds(options.now);
  if (!credentials) throw new Error('strava-not-connected');
  if (credentials.accessToken && credentials.expiresAt > now + 300) return { credentials, refreshed: false };
  return { credentials: await refreshStravaCredentials(credentials, env, fetchImpl), refreshed: true };
}

function text(value, limit = 160) {
  return String(value || '').trim().slice(0, limit);
}

export function normalizeStravaActivity(activity = {}) {
  const id = String(activity.id || '').trim();
  if (!id || id.length > 64) return null;
  return {
    id,
    name: text(activity.name),
    type: text(activity.type, 40),
    sportType: text(activity.sport_type, 40),
    startAt: text(activity.start_date, 64),
    startLocal: text(activity.start_date_local, 64),
    distanceMeters: finite(activity.distance),
    movingSeconds: finite(activity.moving_time),
    elapsedSeconds: finite(activity.elapsed_time),
    averageSpeedMps: finite(activity.average_speed),
    averageHeartRate: finite(activity.average_heartrate),
    maxHeartRate: finite(activity.max_heartrate),
    elevationGainMeters: finite(activity.total_elevation_gain),
  };
}

export async function listStravaActivities(credentials, env = process.env, fetchImpl = fetch, options = {}) {
  const active = await activeStravaCredentials(credentials, env, fetchImpl, options);
  try {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.search = new URLSearchParams({ per_page: String(Math.min(Math.max(Number(options.limit) || 10, 1), 30)) }).toString();
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${active.credentials.accessToken}` },
    });
    if (!response.ok) throw new Error(`strava-activities-${response.status}`);
    const body = await response.json();
    return {
      credentials: active.credentials,
      refreshed: active.refreshed,
      activities: Array.isArray(body) ? body.map(normalizeStravaActivity).filter(Boolean) : [],
    };
  } catch (error) {
    error.credentials = active.refreshed ? active.credentials : null;
    throw error;
  }
}

export function queryValue(request, name) {
  if (request?.query && request.query[name] !== undefined) return String(request.query[name]);
  try {
    return new URL(request?.url || '/', 'https://carlos.local').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

export function redirect(response, url, headers = {}) {
  response.statusCode = 302;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  response.setHeader('Location', url);
  response.end();
}

export function stravaReturnUrl(env = process.env, status) {
  const url = new URL(appOrigin(env));
  url.searchParams.set('strava', status);
  return url.toString();
}
