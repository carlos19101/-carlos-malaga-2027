import { describe, expect, it } from 'vitest';
import { createStravaImportRecord, planStravaActivityAppend, STRAVA_IMPORT_FIELDS, STRAVA_RUN_FIELDS, validateStravaImportRequest } from './stravaImport.js';
const activity = {id:'123',sportType:'Run',startLocal:'2026-09-25T18:01:02Z',distanceMeters:8012,elapsedSeconds:3660,movingSeconds:3600,hasHeartRate:true,averageHeartRate:150.5,maxHeartRate:175};
const request = {activityId:'123',category:'Bieg',rpe:null};
const headers = [...Object.values(STRAVA_IMPORT_FIELDS),...Object.values(STRAVA_RUN_FIELDS),'HR_Target_Min_bpm','Pain'];
const prepare = (changes={},input={}) => createStravaImportRecord({...activity,...changes},{...request,...input});
describe('running import keeps objective evidence separate from feedback and target',()=>{
  it.each([null,'',undefined])('keeps absent RPE %s blank, never zero',rpe=>{
    expect(prepare({}, {rpe}).record.values).toMatchObject({rpe:'',srpe:'',hrAvg:150.5,hrMax:175,distance:8.01,duration:61,durationText:'61:00'});
  });
  it('uses elapsed time for duration and sRPE; labels moving fallback',()=>{
    expect(prepare({}, {rpe:3}).record.values.srpe).toBe(183);
    expect(prepare({elapsedSeconds:null},{rpe:3}).record.values).toMatchObject({duration:60,srpe:180,notes:expect.stringContaining('proxy')});
  });
  it.each(['Run','TrailRun','VirtualRun'])('accepts source type %s',sportType=>expect(prepare({sportType}).action).toBe('ready'));
  it.each(['Ride','Workout','WeightTraining',''])('rejects other source type %s',sportType=>expect(prepare({sportType}).action).toBe('invalid-source'));
  it('rejects mislabelling a run, invalid local clock, absent distance and inverted HR',()=>{
    expect(prepare({}, {category:'Siła',rpe:3}).action).toBe('invalid-source');
    for(const changes of [{startLocal:'2026-09-25T25:00:00Z'},{startLocal:'',startAt:'2026-09-25T18:00:00Z'},{distanceMeters:null},{distanceMeters:0},{averageHeartRate:190,maxHeartRate:150}])expect(prepare(changes).action).toBe('invalid-source');
    expect(validateStravaImportRequest({...request,rpe:0}).action).toBe('invalid');
  });
  it('does not invent HR when missing or not disclosed',()=>{
    expect(prepare({hasHeartRate:false}).record.values).toMatchObject({hrAvg:'',hrMax:''});
    expect(prepare({averageHeartRate:null,maxHeartRate:0}).record.values).toMatchObject({hrAvg:'',hrMax:''});
  });
  it('writes existing HR aliases; leaves targets and pain empty and repeat import unchanged',()=>{
    const record=prepare().record;
    const aliasHeaders=headers.map(h=>h.replace('HR avg','HR_avg').replace('HR max','HR_max'));
    const plan=planStravaActivityAppend([aliasHeaders],record);
    expect(plan.action).toBe('append');
    expect(plan.rowValues[aliasHeaders.indexOf('HR_avg')]).toBe(150.5);
    expect(plan.rowValues[aliasHeaders.indexOf('HR_Target_Min_bpm')]).toBe('');
    expect(plan.rowValues[aliasHeaders.indexOf('Pain')]).toBe('');
    const prior=[...plan.rowValues];prior[headers.indexOf('RPE')]=4;
    expect(planStravaActivityAppend([aliasHeaders,prior],record).action).toBe('noop');
    expect(prior[headers.indexOf('RPE')]).toBe(4);
  });
  it('blocks same-day legacy TCX and undated runs, but not a boxing session',()=>{
    const record=prepare().record;
    const row=Array(headers.length).fill('');
    row[headers.indexOf('Date')]='2026-09-25';row[headers.indexOf('Type')]='Bieg';row[headers.indexOf('Session_ID')]='old-tcx';
    expect(planStravaActivityAppend([headers,row],record).action).toBe('possible-duplicate');
    row[headers.indexOf('Date')]='???';expect(planStravaActivityAppend([headers,row],record).action).toBe('possible-duplicate');
    row[headers.indexOf('Type')]='Boks';expect(planStravaActivityAppend([headers,row],record).action).toBe('append');
  });
  it('requires unambiguous HR columns for runs',()=>{
    expect(planStravaActivityAppend([headers.filter(h=>h!=='HR avg')],prepare().record).action).toBe('contract-error');
    expect(planStravaActivityAppend([[...headers,'HR_avg']],prepare().record).action).toBe('contract-error');
  });
});
