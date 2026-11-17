import { findLoginLimitRecord, loginRateLimitStatus } from '../../src/loginRateLimit.js';
import { loginRateLimitKey } from './loginRateLimit.js';
import { readLoginLimitRows, upsertLoginLimitRecord } from './googleSheets.js';

export const DAILY_CHECKIN_WINDOW_MS = 10 * 60 * 1000;
export const DAILY_CHECKIN_REQUEST_LIMIT = 12;
export const DAILY_CHECKIN_BLOCK_MS = 10 * 60 * 1000;

export async function consumeDailyCheckinRequest(request, env = process.env, options = {}) {
  const now = Number(options.now || Date.now());
  const key = `daily-checkin:${loginRateLimitKey(request, env.SESSION_SECRET)}`;
  const rows = await readLoginLimitRows(options);
  const record = findLoginLimitRecord(rows, key);
  const status = loginRateLimitStatus(record, now);
  if (!status.allowed) return { allowed: false, retryAfterSeconds: status.retryAfterSeconds };

  const startedAt = Number(record?.windowStartedAt || 0);
  const withinWindow = startedAt > 0 && now - startedAt < DAILY_CHECKIN_WINDOW_MS;
  const requests = (withinWindow ? Number(record?.failures || 0) : 0) + 1;
  const blockedUntil = requests > DAILY_CHECKIN_REQUEST_LIMIT ? now + DAILY_CHECKIN_BLOCK_MS : 0;
  const next = {
    key,
    windowStartedAt: withinWindow ? startedAt : now,
    failures: requests,
    blockedUntil,
    updatedAt: now,
    rowNumber: record?.rowNumber || null,
  };
  await upsertLoginLimitRecord(next, options);
  const nextStatus = loginRateLimitStatus(next, now);
  return { allowed: nextStatus.allowed, retryAfterSeconds: nextStatus.retryAfterSeconds };
}
