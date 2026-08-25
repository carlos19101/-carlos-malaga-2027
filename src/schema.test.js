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
    'Time_Below_Target_s', 'HR_Analyzed_Duration_s', 'Leg_Fatigue_0_10', 'Feedback_ID',
    'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At',
  ],
  Plan: [
    'Data', 'Dzień', 'Rano', 'Później', 'Cel HR', 'RPE max', 'Status', 'Uwagi', 'Trening', 'Session',
    'HR_Target_Min_bpm', 'HR_Target_Max_bpm', 'Distance_Target_Min_km', 'Distance_Target_Max_km',
  ],
  Raw_Data: [
    'Date', 'Timestamp', 'Weight_kg', 'RHR_bpm', 'HRV_night_ms', 'Sleep_min', 'Sleep_score',
    'BodyBattery_gain', 'Readiness_Garmin', 'Pain_0_10', 'DOMS_0_10', 'Fatigue_0_10',
    'Coach_Status', 'Coach_Decision', 'Source', 'BodyBattery_current',
  ],
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

  it('brak Feedback_ID łamie kontrakt formularza treningowego', () => {
    const headers = LIVE_HEADERS['Training Log'].filter((header) => header !== 'Feedback_ID');
    expect(missingContractFields(headers, 'Training Log')).toEqual([
      expect.objectContaining({ id: 'logFeedbackId', label: 'Feedback_ID' }),
    ]);
  });

  it('brak celu dystansu po migracji łamie kontrakt Plan', () => {
    const headers = LIVE_HEADERS.Plan.filter((header) => header !== 'Distance_Target_Max_km');
    expect(missingContractFields(headers, 'Plan')).toEqual([
      expect.objectContaining({ id: 'planDistanceTargetMax', label: 'Distance_Target_Max_km' }),
    ]);
  });

  it('brak atomowego HRV łamie kontrakt Daily Metrics w Raw_Data', () => {
    const headers = LIVE_HEADERS.Raw_Data.filter((header) => header !== 'HRV_night_ms');
    expect(missingContractFields(headers, 'Raw_Data')).toEqual([
      expect.objectContaining({ id: 'rawHrv', label: 'HRV_night_ms' }),
    ]);
  });

  it('brak rekomendacji Head Coacha łamie kontrakt dziennika decyzji', () => {
    const headers = LIVE_HEADERS.Raw_Data.filter((header) => header !== 'Coach_Decision');
    expect(missingContractFields(headers, 'Raw_Data')).toEqual([
      expect.objectContaining({ id: 'rawCoachDecision', label: 'Coach_Decision' }),
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
