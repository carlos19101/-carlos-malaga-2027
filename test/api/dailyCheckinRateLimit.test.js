import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readLoginLimitRows: vi.fn(), upsertLoginLimitRecord: vi.fn() }));
vi.mock('../../api/_lib/googleSheets.js', () => mocks);

import { consumeDailyCheckinRequest, DAILY_CHECKIN_REQUEST_LIMIT } from '../../api/_lib/dailyCheckinRateLimit.js';
import { loginRateLimitKey } from '../../api/_lib/loginRateLimit.js';

describe('limit porannych check-inów', () => {
  it('trwale zapisuje licznik pochodzący z HMAC adresu klienta', async () => {
    mocks.readLoginLimitRows.mockResolvedValue([]);
    mocks.upsertLoginLimitRecord.mockResolvedValue(undefined);
    const result = await consumeDailyCheckinRequest({ headers: { 'x-forwarded-for': '192.0.2.10' } }, { SESSION_SECRET: 'secret' }, { now: 1000 });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(mocks.upsertLoginLimitRecord).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^daily-checkin:/), failures: 1, rowNumber: null,
    }), expect.any(Object));
  });

  it('blokuje ponad 12 żądań w 10 minut i zwraca Retry-After', async () => {
    const now = 1000 * 60 * 60;
    const request = { headers: { 'x-forwarded-for': '192.0.2.11' } };
    const blocked = { key: `daily-checkin:${loginRateLimitKey(request, 'secret')}`, windowStartedAt: now - 1000, failures: DAILY_CHECKIN_REQUEST_LIMIT, blockedUntil: 0, updatedAt: now - 1000, rowNumber: 2 };
    mocks.readLoginLimitRows.mockResolvedValue([[blocked.key, blocked.windowStartedAt, blocked.failures, '', blocked.updatedAt]]);
    const result = await consumeDailyCheckinRequest(request, { SESSION_SECRET: 'secret' }, { now });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(600);
    expect(mocks.upsertLoginLimitRecord).toHaveBeenCalledWith(expect.objectContaining({ blockedUntil: now + 600000, failures: 13 }), expect.any(Object));
  });
});
