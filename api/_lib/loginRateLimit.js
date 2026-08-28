import { createHmac } from 'node:crypto';
import {
  clearedLoginLimitRecord,
  findLoginLimitRecord,
  loginRateLimitStatus,
  nextLoginFailure,
} from '../../src/loginRateLimit.js';
import { readLoginLimitRows, upsertLoginLimitRecord } from './googleSheets.js';

function clientAddress(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request?.headers?.['x-real-ip'] || '').trim() || 'unknown-client';
}

export function loginRateLimitKey(request, secret) {
  if (!secret) throw new Error('missing-session-secret');
  return createHmac('sha256', secret).update(clientAddress(request)).digest('base64url');
}

async function currentRecord(request, env, options = {}) {
  const key = loginRateLimitKey(request, env.SESSION_SECRET);
  const rows = await readLoginLimitRows(options);
  return { key, record: findLoginLimitRecord(rows, key) };
}

export async function checkLoginRateLimit(request, env = process.env, options = {}) {
  const { key, record } = await currentRecord(request, env, options);
  return { key, record, ...loginRateLimitStatus(record, options.now || Date.now()) };
}

export async function recordLoginFailure(request, env = process.env, options = {}) {
  const { key, record } = await currentRecord(request, env, options);
  const next = nextLoginFailure(record, key, options.now || Date.now());
  await upsertLoginLimitRecord(next, options);
  return { record: next, ...loginRateLimitStatus(next, options.now || Date.now()) };
}

export async function clearLoginRateLimit(request, env = process.env, options = {}) {
  const { key, record } = await currentRecord(request, env, options);
  if (!record) return;
  await upsertLoginLimitRecord(clearedLoginLimitRecord(record, key, options.now || Date.now()), options);
}
