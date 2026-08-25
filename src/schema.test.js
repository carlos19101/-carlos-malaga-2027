import { describe, expect, it } from 'vitest';
import { A, missingContractFields, SHEET_CONTRACTS, sheetContractError } from './schema';

const LIVE_HEADERS = {
  APP_FEED: [
    'Date', 'Recovery', 'Readiness', 'Strain', 'Sleep', 'Sleep Score', 'HRV', 'RHR', 'Weight', 'Waga',
    'Steps', 'Kroki', 'Status', 'Decision', 'Pain', 'HRmax', 'LT1', 'LT2', 'Threshold Power', 'Z1',
    'Z2', 'Z3', 'Z4', 'Z5', 'Run km 7d', 'sRPE 7d', 'Last Run Distance', 'Last Run Pace',
    'Last Run HR Avg', 'Last Run HR Max', 'Last Run RPE', 'Phase', 'Goal A', 'Goal B', 'Goal C',
    'Main Goal', 'Last Synced', 'sRPE 28d', 'Run km 28d', 'Run count 7d', 'HRV 7d',
    'Weight avg 7d', 'Weight delta 7d', 'DOMS', 'Fatigue', 'Body Battery',
  ],
  'Training Log': [
    'Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'Pace', 'HR_avg',
    'HR_max', 'Power_avg', 'Power_max', 'RPE', 'sRPE', 'Pain', 'Garmin_Load', 'TE_Aerobic',
    'TE_Anaerobic', 'Cadence', 'GCT_ms', 'Notes', 'Source', 'Status', 'Session_ID',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Time_In_Target_s', 'Time_Above_Target_s',
    'Time_Below_Target_s', 'HR_Analyzed_Duration_s',
  ],
  Plan: [
    'Data', 'Dzień', 'Rano', 'Później', 'Cel HR', 'RPE max', 'Status', 'Uwagi', 'Trening', 'Session',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Distance_Target_Min_km', 'Distance_Target_Max_km',
  ],
  Raw_Data: ['Date', 'Weight_kg'],
};

describe('kontrakty nagłówków Google Sheets', () => {
  Object.entries(LIVE_HEADERS).forEach(([sheetName, headers]) => {
    it(`${sheetName}: aktualny schemat spełnia kontrakt`, () => {
      expect(missingContractFields(headers, sheetName)).toEqual([]);
    });
  });

  it('każde pole kontraktu wskazuje istniejący zbiór aliasów', () => {
    Object.values(SHEET_CONTRACTS).flat().forEach(({ fields }) => {
      fields.forEach((field) => expect(A[field], field).toBeInstanceOf(Array));
    });
  });

  it('brak Body Battery w APP_FEED jest jawnym błędem kontraktu', () => {
    const headers = LIVE_HEADERS.APP_FEED.filter((header) => header !== 'Body Battery');
    expect(missingContractFields(headers, 'APP_FEED')).toEqual([
      expect.objectContaining({ id: 'bodyBattery', label: 'Body Battery' }),
    ]);
  });

  it('exact-match nie uznaje podobnego, lecz obcego nagłówka', () => {
    const headers = LIVE_HEADERS.APP_FEED.map((header) => header === 'Body Battery' ? 'Body Battery current' : header);
    expect(missingContractFields(headers, 'APP_FEED')).toEqual([
      expect.objectContaining({ id: 'bodyBattery' }),
    ]);
  });

  it('Plan akceptuje Session jako kontrolowany zamiennik Rano', () => {
    const headers = LIVE_HEADERS.Plan.filter((header) => header !== 'Rano');
    expect(missingContractFields(headers, 'Plan')).toEqual([]);
  });

  it('brak pola atomowego po migracji łamie kontrakt Training Log', () => {
    const headers = LIVE_HEADERS['Training Log'].filter((header) => header !== 'HR_Analyzed_Duration_s');
    expect(missingContractFields(headers, 'Training Log')).toEqual([
      expect.objectContaining({ id: 'logHrAnalyzedDuration', label: 'HR_Analyzed_Duration_s' }),
    ]);
  });

  it('brak Session_ID łamie idempotentny kontrakt Training Log', () => {
    const headers = LIVE_HEADERS['Training Log'].filter((header) => header !== 'Session_ID');
    expect(missingContractFields(headers, 'Training Log')).toEqual([
      expect.objectContaining({ id: 'logSessionId', label: 'Session_ID' }),
    ]);
  });

  it('brak celu dystansu po migracji łamie kontrakt Plan', () => {
    const headers = LIVE_HEADERS.Plan.filter((header) => header !== 'Distance_Target_Max_km');
    expect(missingContractFields(headers, 'Plan')).toEqual([
      expect.objectContaining({ id: 'planDistanceTargetMax', label: 'Distance_Target_Max_km' }),
    ]);
  });

  it('zwraca czytelny DATA ERROR dla pobranych wierszy bez wymaganej kolumny', () => {
    const headers = LIVE_HEADERS['Training Log'].filter((header) => header !== 'Date');
    const row = Object.fromEntries(headers.map((header) => [header, '']));
    expect(sheetContractError([row], 'Training Log')).toBe('Training Log: brak kolumn kontraktu: Date');
  });

  it('dodatkowe, nieużywane kolumny nie łamią kontraktu', () => {
    expect(missingContractFields([...LIVE_HEADERS.Raw_Data, 'Future_metric'], 'Raw_Data')).toEqual([]);
  });
});
