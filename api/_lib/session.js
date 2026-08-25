import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const SESSION_COOKIE = 'carlos_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSCODE_VERIFIER_VERSION = 'scrypt-v1';
const PASSCODE_KEY_BYTES = 32;
const PASSCODE_SALT_BYTES = 16;
const scrypt = promisify(scryptCallback);

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

function decodePasscodeVerifier(verifier) {
  if (typeof verifier !== 'string') return null;
  const [version, encodedSalt, encodedKey, extra] = verifier.split('$');
  if (version !== PASSCODE_VERIFIER_VERSION || !encodedSalt || !encodedKey || extra) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedSalt) || !/^[A-Za-z0-9_-]+$/.test(encodedKey)) return null;
  const salt = Buffer.from(encodedSalt, 'base64url');
  const key = Buffer.from(encodedKey, 'base64url');
  return salt.length === PASSCODE_SALT_BYTES && key.length === PASSCODE_KEY_BYTES ? { salt, key } : null;
}

async function derivePasscodeKey(passcode, salt) {
  return scrypt(passcode, salt, PASSCODE_KEY_BYTES, {
    cost: 16384,
    blockSize: 8,
    parallelization: 1,
    maxmem: 32 * 1024 * 1024,
  });
}

export async function createPasscodeVerifier(passcode, options = {}) {
  if (typeof passcode !== 'string' || passcode.length < 20 || passcode.length > 256) {
    throw new Error('passcode-must-have-20-to-256-characters');
  }
  const salt = options.salt ? Buffer.from(options.salt) : randomBytes(PASSCODE_SALT_BYTES);
  if (salt.length !== PASSCODE_SALT_BYTES) throw new Error('passcode-salt-must-have-16-bytes');
  const key = await derivePasscodeKey(passcode, salt);
  return `${PASSCODE_VERIFIER_VERSION}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function passcodeMatches(supplied, verifier) {
  if (typeof supplied !== 'string' || supplied.length > 256) return false;
  const decoded = decodePasscodeVerifier(verifier);
  if (!decoded) return false;
  const suppliedKey = await derivePasscodeKey(supplied, decoded.salt);
  return timingSafeEqual(suppliedKey, decoded.key);
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
    'APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID',
  ].filter((name) => !env[name]);
  return { configured: missing.length === 0, missing };
}
