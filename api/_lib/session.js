import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'carlos_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signature(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSessionToken(secret, options = {}) {
  if (!secret) throw new Error('missing-session-secret');
  const nowSeconds = Math.floor((options.now instanceof Date ? options.now : new Date(options.now || Date.now())).getTime() / 1000);
  const payload = base64url(JSON.stringify({
    v: 1,
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds || SESSION_TTL_SECONDS),
    nonce: options.nonce || randomBytes(12).toString('base64url'),
  }));
  return `${payload}.${signature(secret, payload)}`;
}

export function verifySessionToken(token, secret, options = {}) {
  if (!token || !secret) return false;
  const [payload, suppliedSignature, extra] = String(token).split('.');
  if (!payload || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(secret, payload))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor((options.now instanceof Date ? options.now : new Date(options.now || Date.now())).getTime() / 1000);
    return decoded.v === 1 && Number.isFinite(decoded.iat) && Number.isFinite(decoded.exp)
      && decoded.iat <= nowSeconds + 60 && decoded.exp > nowSeconds;
  } catch {
    return false;
  }
}

export function passcodeMatches(supplied, expected) {
  if (!expected || typeof supplied !== 'string') return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator === -1 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  }));
}

export function authenticated(request, env = process.env, options = {}) {
  const token = parseCookies(request?.headers?.cookie || '')[SESSION_COOKIE];
  return verifySessionToken(token, env.SESSION_SECRET, options);
}

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function allowedRequestOrigin(request, env = process.env) {
  const origin = request?.headers?.origin;
  if (!origin) return false;
  const allowed = String(env.APP_ORIGIN || 'https://carlos-malaga-2027.vercel.app')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin);
}

export function serviceConfiguration(env = process.env) {
  const missing = [
    'APP_PASSCODE', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID',
  ].filter((name) => !env[name]);
  return { configured: missing.length === 0, missing };
}
