import { describe, expect, it } from 'vitest';
import {
  LOGIN_BLOCK_MS,
  LOGIN_FAILURE_LIMIT,
  clearedLoginLimitRecord,
  findLoginLimitRecord,
  loginRateLimitStatus,
  nextLoginFailure,
} from './loginRateLimit.js';

describe('login rate limit', () => {
  it('uses a rolling failure window and blocks the fifth incorrect attempt', () => {
    const start = Date.parse('2026-08-28T10:00:00Z');
    let record = null;
    for (let count = 1; count <= LOGIN_FAILURE_LIMIT; count += 1) {
      record = nextLoginFailure(record, 'hashed-client', start + count * 1000);
    }
    expect(record.failures).toBe(LOGIN_FAILURE_LIMIT);
    expect(record.blockedUntil).toBe(start + LOGIN_FAILURE_LIMIT * 1000 + LOGIN_BLOCK_MS);
    expect(loginRateLimitStatus(record, start + LOGIN_FAILURE_LIMIT * 1000)).toEqual({ allowed: false, retryAfterSeconds: 900 });
  });

  it('starts a clean counter outside the failure window', () => {
    const first = nextLoginFailure(null, 'hashed-client', 1000);
    const next = nextLoginFailure(first, 'hashed-client', 16 * 60 * 1000);
    expect(next.failures).toBe(1);
    expect(next.windowStartedAt).toBe(16 * 60 * 1000);
  });

  it('finds a persisted row and clears it after a successful login', () => {
    const record = findLoginLimitRecord([
      ['another-key', '2026-08-28T10:00:00.000Z', 2, '', '2026-08-28T10:00:01.000Z'],
      ['hashed-client', '2026-08-28T10:00:00.000Z', 4, '', '2026-08-28T10:00:01.000Z'],
    ], 'hashed-client');
    expect(record.rowNumber).toBe(3);
    expect(clearedLoginLimitRecord(record, 'hashed-client', 2000)).toMatchObject({ failures: 0, blockedUntil: 0, rowNumber: 3 });
  });
});
