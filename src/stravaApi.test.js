import { describe, expect, it, vi } from 'vitest';
import { disconnectStrava, stravaActivities, stravaStatus } from './stravaApi.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('stravaApi', () => {
  it('odczytuje status i aktywności z prywatnych endpointów', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, configured: true, connected: true }))
      .mockResolvedValueOnce(response(200, { ok: true, activities: [{ id: '1' }] }));
    expect(await stravaStatus(fetchImpl)).toMatchObject({ connected: true, status: 200 });
    expect(await stravaActivities(200, 2, fetchImpl)).toMatchObject({ activities: [{ id: '1' }], status: 200 });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/strava/status', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/strava/activities?limit=200&page=2', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  });

  it('odłącza wyłącznie lokalne połączenie przez POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, connected: false }));
    expect(await disconnectStrava(fetchImpl)).toMatchObject({ ok: true, connected: false });
    expect(fetchImpl).toHaveBeenCalledWith('/api/strava/disconnect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({}), credentials: 'same-origin',
    }));
  });
});
