import { describe, expect, it, vi } from 'vitest';
import {
  applicationDataFromTables,
  fetchPrivateApplicationData,
  parsePrivateApplicationSnapshot,
  rowsFromValuesTable,
} from './appDataApi.js';

function table(headers, values) {
  return [headers, headers.map((header) => values[header] ?? '')];
}

const tables = {
  feed: table([
    'Date', 'Recovery', 'Readiness', 'Sleep', 'HRV', 'HRV 7d', 'RHR', 'Weight', 'Status', 'Decision',
    'Pain', 'DOMS', 'Fatigue', 'HRmax', 'LT1', 'LT2', 'Threshold Power', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5',
    'Run km 7d', 'Run km 28d', 'Run count 7d', 'sRPE 7d', 'sRPE 28d', 'Last Run Distance',
    'Last Run Pace', 'Last Run HR Avg', 'Last Run HR Max', 'Last Run RPE', 'Phase', 'Goal A', 'Goal B',
    'Goal C', 'Last Synced', 'Weight avg 7d', 'Weight delta 7d', 'Body Battery',
  ], { Date: '2026-08-25', Status: 'GREEN', HRV: '69', RHR: '46', Weight: '89' }),
  log: table([
    'Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'Pace', 'HR_avg',
    'HR_max', 'Power_avg', 'Power_max', 'RPE', 'sRPE', 'Pain', 'Garmin_Load', 'TE_Aerobic',
    'TE_Anaerobic', 'Cadence', 'GCT_ms', 'Notes', 'Source', 'Status', 'Session_ID',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm',
    'Time_In_Target_s', 'Time_Above_Target_s', 'Time_Below_Target_s', 'HR_Analyzed_Duration_s',
    'Leg_Fatigue_0_10', 'Feedback_ID', 'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At',
  ], { Date: '2026-08-25', Type: 'Bieg', Distance_km: '5', sRPE: '120', Session_ID: '2026-08-25-run-01' }),
  plan: table([
    'Data', 'Dzień', 'Rano', 'Później', 'Cel HR', 'RPE max', 'Status', 'Uwagi', 'Trening', 'Session',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Distance_Target_Min_km', 'Distance_Target_Max_km',
  ], { Data: '2026-08-25', Rano: 'Easy', HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Distance_Target_Min_km: '5', Distance_Target_Max_km: '6' }),
  raw: table([
    'Date', 'Timestamp', 'Weight_kg', 'RHR_bpm', 'HRV_night_ms', 'Sleep_min', 'Sleep_score',
    'BodyBattery_gain', 'Readiness_Garmin', 'Pain_0_10', 'DOMS_0_10', 'Fatigue_0_10',
    'Coach_Status', 'Coach_Decision', 'Source', 'BodyBattery_current',
  ], { Date: '2026-08-25', Timestamp: '2026-08-25 08:00', Weight_kg: '89', RHR_bpm: '46', HRV_night_ms: '69', Sleep_min: '420', Sleep_score: '73', Coach_Status: 'GREEN', Coach_Decision: 'Easy', Source: 'Head Coach' }),
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('prywatny transport danych', () => {
  it('zamienia tabelę Values API na rekordy i zachowuje nagłówki verbatim', () => {
    expect(rowsFromValuesTable([['Data', 'Cel HR'], ['25.08.2026', '145–158'], ['', '']]))
      .toEqual([{ Data: '25.08.2026', 'Cel HR': '145–158' }]);
  });

  it('waliduje wszystkie cztery kontrakty po prywatnym odczycie', () => {
    const data = applicationDataFromTables(tables);
    expect(data.feed[0].Status).toBe('GREEN');
    expect(data.log[0].Session_ID).toBe('2026-08-25-run-01');
  });

  it('nie przepuszcza brakującego wymaganego nagłówka', () => {
    const broken = { ...tables, plan: [['Data', 'Rano'], ['2026-08-25', 'Easy']] };
    expect(() => applicationDataFromTables(broken)).toThrow('DATA ERROR');
  });

  it('pobiera dane z same-origin cookie i bez cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, tables }));
    const data = await fetchPrivateApplicationData(undefined, fetchImpl);
    expect(data.raw).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/data', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }));
  });

  it('zachowuje status 401, aby aplikacja mogła zamknąć widok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { ok: false, error: 'authentication-required' }));
    await expect(fetchPrivateApplicationData(undefined, fetchImpl)).rejects.toMatchObject({ status: 401 });
  });

  it('zachowuje DATA ERROR z odpowiedzi 200 zamiast oznaczać aplikację jako offline', async () => {
    const broken = { ...tables, plan: [['Data', 'Rano'], ['2026-08-25', 'Easy']] };
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, tables: broken }));
    await expect(fetchPrivateApplicationData(undefined, fetchImpl)).rejects.toThrow('DATA ERROR — Plan');
  });

  it('akceptuje wyłącznie prywatny snapshot', () => {
    const legacy = JSON.stringify({ data: { feed: [{ Date: '2026-08-25' }] }, at: 1 });
    const privateSnapshot = JSON.stringify({ data: { feed: [] }, at: 2, mode: 'private' });
    const publicSnapshot = JSON.stringify({ data: { feed: [] }, at: 3, mode: 'public' });
    expect(parsePrivateApplicationSnapshot(legacy)).toBeNull();
    expect(parsePrivateApplicationSnapshot(publicSnapshot)).toBeNull();
    expect(parsePrivateApplicationSnapshot(privateSnapshot)).not.toBeNull();
  });
});
