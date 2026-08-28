import { describe, expect, it } from 'vitest';
import { createStravaImportRecord, planStravaActivityAppend, validateStravaImportRequest } from './stravaImport.js';

const headers = [
  'Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'RPE', 'sRPE',
  'Notes', 'Source', 'Status', 'Session_ID',
];

function activity(overrides = {}) {
  return {
    id: '123456789', name: 'Popołudniowy trening', startLocal: '2026-08-25T16:00:18Z',
    movingSeconds: 3749, elapsedSeconds: 3750, distanceMeters: 0, ...overrides,
  };
}

describe('kontrolowany import Stravy', () => {
  it('akceptuje wyłącznie świadomie wybraną kategorię i RPE', () => {
    expect(validateStravaImportRequest({ activityId: '123456789', category: 'Mobilizacja', rpe: 1 })).toMatchObject({ action: 'valid' });
    expect(validateStravaImportRequest({ activityId: '123', category: 'Bieg', rpe: 0 })).toMatchObject({ action: 'invalid', errors: { category: expect.any(String), rpe: expect.any(String) } });
  });

  it('tworzy deterministyczny wpis mobilizacji z pełnym czasem Stravy i sRPE', () => {
    const result = createStravaImportRecord(activity(), { activityId: '123456789', category: 'Mobilizacja', rpe: 1 });
    expect(result).toMatchObject({
      action: 'ready',
      record: {
        sessionId: 'strava-123456789', category: 'Mobilizacja', rpe: 1,
        values: {
          date: '2026-08-25', time: '16:00:18', type: 'Mobilizacja', duration: 62.5, durationText: '62:30', srpe: 62.5,
          source: 'Strava', status: 'DONE', sessionId: 'strava-123456789',
        },
      },
    });
  });

  it('odmawia zapisu, gdy źródło nie odpowiada wybranemu ID', () => {
    expect(createStravaImportRecord(activity({ id: '999' }), { activityId: '123456789', category: 'Mobilizacja', rpe: 1 }))
      .toMatchObject({ action: 'invalid-source' });
  });

  it('dopisuje pełny wiersz raz i chroni go przez Session_ID', () => {
    const prepared = createStravaImportRecord(activity(), { activityId: '123456789', category: 'Mobilizacja', rpe: 1 }).record;
    const first = planStravaActivityAppend([headers], prepared);
    expect(first).toMatchObject({ action: 'append', sessionId: 'strava-123456789' });
    expect(first.rowValues).toEqual([
      '2026-08-25', '16:00:18', 'Mobilizacja', 'Popołudniowy trening', '', 62.5, '62:30', 1, 62.5,
      expect.stringContaining('123456789'), 'Strava', 'DONE', 'strava-123456789',
    ]);
    expect(planStravaActivityAppend([headers, first.rowValues], prepared)).toMatchObject({
      action: 'noop', sessionId: 'strava-123456789', rowNumber: 2,
    });
  });
});
