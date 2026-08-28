export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 5;

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function parseLoginLimitRecord(values = [], rowNumber = null) {
  return {
    key: String(values[0] || ''),
    windowStartedAt: timestamp(values[1]),
    failures: positiveInteger(values[2]),
    blockedUntil: timestamp(values[3]),
    updatedAt: timestamp(values[4]),
    rowNumber,
  };
}

export function findLoginLimitRecord(rows = [], key) {
  const index = rows.findIndex((row) => String(row?.[0] || '') === key);
  return index === -1 ? null : parseLoginLimitRecord(rows[index], index + 2);
}

export function loginRateLimitStatus(record, now = Date.now()) {
  const retryAfterMs = Math.max(0, Number(record?.blockedUntil || 0) - now);
  return {
    allowed: retryAfterMs === 0,
    retryAfterSeconds: retryAfterMs ? Math.ceil(retryAfterMs / 1000) : 0,
  };
}

export function nextLoginFailure(record, key, now = Date.now()) {
  const windowStartedAt = Number(record?.windowStartedAt || 0);
  const withinWindow = windowStartedAt > 0 && now - windowStartedAt < LOGIN_FAILURE_WINDOW_MS;
  const failures = (withinWindow ? Number(record?.failures || 0) : 0) + 1;
  const blockedUntil = failures >= LOGIN_FAILURE_LIMIT ? now + LOGIN_BLOCK_MS : 0;
  return {
    key,
    windowStartedAt: withinWindow ? windowStartedAt : now,
    failures,
    blockedUntil,
    updatedAt: now,
    rowNumber: record?.rowNumber || null,
  };
}

export function clearedLoginLimitRecord(record, key, now = Date.now()) {
  return {
    key,
    windowStartedAt: 0,
    failures: 0,
    blockedUntil: 0,
    updatedAt: now,
    rowNumber: record?.rowNumber || null,
  };
}
