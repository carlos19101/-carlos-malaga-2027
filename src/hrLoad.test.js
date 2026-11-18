import { describe, it, expect } from 'vitest';
import { hrEvidence, validHrEvidence, banisterTrimp, resolveHrRest, loadFromEvidence, sessionHrLoad, summarizeHrLoad, hrLoadZone } from './hrLoad.js';
import { parseTcxHrTimeline } from './tcx.js';
import { createTcxImport, validateTcxImportEnvelope } from './tcxImport.js';
import { attachHrLoad } from './hrLoadImport.js';

const point = (seconds, heartRate = 130) => ({ timeMs: seconds * 1000, heartRate });
const row = (date, extra = {}) => ({ Date: date, Type: 'Bieg', Session_ID: `run-${date}`, Duration_min: 60, HR_avg: 130, RPE: 3, ...extra });
const rest = { value: 50, source: 'fallback-50', date: '2026-11-18' };
const evidence = () => hrEvidence([point(0), point(30), point(60)]);

describe('HR load formula and evidence', () => {
  it('known 60 seconds at HR reserve .5 = .32 × exp(.96), no 1-second assumption', () => {
    const result = loadFromEvidence(evidence(), rest);
    expect(result.value).toBeCloseTo(0.8357428715, 8);
    expect(result.seconds).toBe(60);
    expect(banisterTrimp(130, 1, 50)).toBeCloseTo(result.value, 12);
  });
  it('uses previous point, keeps 30s, drops >30s and nonpositive intervals; last has no time', () => {
    const e = hrEvidence([point(0,50),point(30,210),point(61,130),point(61,130),point(71,210)]);
    expect(e.bins).toEqual([[50,30],[130,10]]);
    expect(e.excludedSeconds).toBe(31); expect(e.nonPositiveIntervals).toBe(1);
    expect(loadFromEvidence(e,rest).value).toBeCloseTo(0.8357428715/6,8);
  });
  it('missing HR is not bridged, invalid clock does not create a long interpolation', () => {
    const e=hrEvidence([point(0),point(5,null),point(10),point(15)]);
    expect(e.bins).toEqual([[130,10]]); expect(e.excludedSeconds).toBe(5);
    expect(hrEvidence([point(0),{timeMs:NaN,heartRate:130},point(5)]).bins).toEqual([]);
  });
  it('zero is valid below rest, empty evidence is missing', () => {
    expect(loadFromEvidence(hrEvidence([point(0,40),point(10,40)]),rest).value).toBe(0);
    expect(loadFromEvidence(hrEvidence([]),rest)).toBeNull();
    expect(banisterTrimp(null,60,50)).toBeNull(); expect(banisterTrimp(130,0,50)).toBeNull();
  });
  it('does not cap HR above maximum; flags for review', () => {
    expect(loadFromEvidence(hrEvidence([point(0,220),point(10,220)]),rest).aboveMax).toBe(true);
    expect(banisterTrimp(260,60,50)).toBeNull();
  });
  it('validates bounded sorted unique histogram and finite times', () => {
    expect(validHrEvidence(evidence())).toBe(true);
    for(const bins of [[[130,NaN]],[[130,-1]],[[130,1],[130,2]],[[130,604801]],[[300,10]]]) expect(validHrEvidence({...evidence(),bins})).toBe(false);
  });
  it('parser retains missing-HR point and rejects absent timestamp without bridging', () => {
    const points=parseTcxHrTimeline('<Trackpoint><Time>2026-11-18T10:00:00Z</Time><HeartRateBpm><Value>130</Value></HeartRateBpm></Trackpoint><Trackpoint><Time>2026-11-18T10:00:05Z</Time></Trackpoint>');
    expect(points[1].heartRate).toBeNull();expect(hrEvidence(points).bins).toEqual([[130,5]]);
  });
});

describe('HRrest and source priority', () => {
  it('same-day lying → same-day RHR → 50, never previous date', () => {
    const raw=[{Date:'2026-11-18',HR_lying_bpm:58,RHR_bpm:43},{Date:'2026-11-17',HR_lying_bpm:60}];
    expect(resolveHrRest(raw,'2026-11-18')).toMatchObject({value:58,source:'HR_lying_bpm'});
    expect(resolveHrRest([{Date:'2026-11-18',RHR_bpm:43}],'2026-11-18').value).toBe(43);
    expect(resolveHrRest(raw,'2026-11-19').value).toBe(50);
  });
  it('duplicate conflicting rows use explicit fallback, independent of row order', () => {
    const raw=[{Date:'2026-11-18',HR_lying_bpm:50},{Date:'2026-11-18',HR_lying_bpm:60}];
    expect(resolveHrRest(raw,'2026-11-18')).toEqual(resolveHrRest([...raw].reverse(),'2026-11-18'));
    expect(resolveHrRest(raw,'2026-11-18').source).toBe('fallback-conflict');
  });
  it('prefers valid persisted atomic evidence and freezes used rest; never trusts Coach_Load_AU', () => {
    const atomic=loadFromEvidence(evidence(),rest);
    const result=sessionHrLoad(row('2026-11-18',{Coach_Load_AU:999,Coach_Load_Notes:JSON.stringify(atomic)}),[{Date:'2026-11-18',HR_lying_bpm:70}]);
    expect(result.kind).toBe('atomic');expect(result.rest.value).toBe(50);expect(result.trimp).toBeCloseTo(atomic.value);
  });
  it('average estimate uses formula, not HR times minutes; strength is separate even with HR', () => {
    expect(sessionHrLoad(row('2026-11-18')).trimp).toBeCloseTo(60*0.8357428715,6);
    expect(sessionHrLoad(row('2026-11-18')).kind).toBe('estimate');
    for(const Type of ['Siła','Siłowy','Strength','WeightTraining']) expect(sessionHrLoad(row('2026-11-18',{Type}))).toMatchObject({kind:'srpe',srpe:180,trimp:null});
  });
  it('no HR uses sRPE, no RPE is missing, RPE0 is not missing', () => {
    expect(sessionHrLoad(row('2026-11-18',{HR_avg:'',RPE:0}))).toMatchObject({kind:'srpe',srpe:0,trimp:null});
    expect(sessionHrLoad(row('2026-11-18',{HR_avg:'',RPE:''}))).toMatchObject({kind:'missing',srpe:null,trimp:null});
  });
});

describe('rolling HR ratio', () => {
  it.each([[.799,'Niskie'],[.8,'Optymalne'],[1.3,'Optymalne'],[1.3001,'Uwaga'],[1.5,'Uwaga'],[1.5001,'Wysokie'],[null,null]])('boundary %s', (ratio, zone)=>expect(hrLoadZone(ratio)).toBe(zone));
  it('calendar span not training-day count; 20 calibrates, 21 unlocks and 28 caps', () => {
    expect(summarizeHrLoad([row('2026-10-30'),row('2026-11-18')],[],'2026-11-18').status).toBe('calibration');
    const ready=summarizeHrLoad([row('2026-10-29'),row('2026-11-18')],[],'2026-11-18');
    expect(ready.historyDays).toBe(21);expect(ready.ratio).toBeCloseTo(2);
    expect(summarizeHrLoad([row('2026-08-01')],[],'2026-11-18').historyDays).toBe(28);
  });
  it('inclusive 7/28 windows, future excluded, no TRIMP+sRPE arithmetic', () => {
    const result=summarizeHrLoad([row('2026-10-21'),row('2026-10-22'),row('2026-11-11'),row('2026-11-12'),row('2026-11-18'),row('2026-11-19'),row('2026-11-18',{Type:'Siła'})],[],'2026-11-18');
    expect(result.estimateCount).toBe(4); expect(result.ratio).toBeCloseTo(2);
    expect(result.total28).toBeCloseTo(4*60*0.8357428715,6);expect(result.srpe7).toBe(180);expect(result.hrCoverage).toBe(80);
  });
  it('no HR or denominator zero yields no ratio; missing endurance HR blocks partial ratio', () => {
    expect(summarizeHrLoad([],[],'2026-11-18')).toMatchObject({ratio:null,acute:null,total28:null,hrCoverage:null});
    expect(summarizeHrLoad([row('2026-10-22',{HR_avg:40})],[],'2026-11-18').ratio).toBeNull();
    expect(summarizeHrLoad([row('2026-10-22'),row('2026-11-18',{HR_avg:''})],[],'2026-11-18')).toMatchObject({ratio:null,status:'partial',srpe7:180});
  });
  it('mixed atomic + estimate, missing RPE does not suppress valid HR', () => {
    const result=summarizeHrLoad([row('2026-10-22'),row('2026-11-18',{RPE:'',Coach_Load_Notes:JSON.stringify(loadFromEvidence(evidence(),rest))})],[],'2026-11-18');
    expect(result.atomicCount).toBe(1);expect(result.estimateCount).toBe(1);expect(result.ratio).not.toBeNull();
  });
});

describe('TCX load persistence', () => {
  const table = {headers:['Date','Coach_Load_AU','Coach_Load_Method','Coach_Load_Notes'], rows:[{rowNumber:2,values:['2026-11-18','','','']}]};
  const rec={action:'noop',rowNumber:2,sessionId:'test-run',updates:[]};
  it('fills only existing coach-load columns, stores server-resolved rest and is idempotent', () => {
    const result=attachHrLoad(rec,table,evidence(),[{Date:'2026-11-18',HR_lying_bpm:58}]);
    expect(result.action).toBe('update');expect(result.updates.map(u=>u.range)).toEqual(['B2','C2','D2']);
    const stored=JSON.parse(result.updates[2].values[0]);expect(stored.rest).toMatchObject({value:58,source:'HR_lying_bpm'});
    const filled={...table, rows:[{rowNumber:2,values:['2026-11-18',...result.updates.map(u=>u.values[0])]}]};
    expect(attachHrLoad(rec,filled,evidence(),[]).action).toBe('noop');
    expect(attachHrLoad(rec,{...table,rows:[{rowNumber:2,values:['2026-11-18',123,'old','note']}]},evidence()).action).toBe('conflict');
  });
  it('does not add schema columns, zero evidence does not invent load, conflicts never write', () => {
    expect(attachHrLoad(rec,{...table,headers:['Date']},evidence()).action).toBe('contract-error');
    expect(attachHrLoad(rec,table,hrEvidence([])).action).toBe('noop');
    expect(attachHrLoad({action:'conflict'},table,evidence())).toEqual({action:'conflict'});
    expect(attachHrLoad(rec,table,evidence(),[],'2026-11-17').action).toBe('conflict');
  });
  it('rejects tampered load evidence in import envelope', () => {
    const xml='<Trackpoint><Time>2026-08-23T10:00:00Z</Time><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint><Trackpoint><Time>2026-08-23T10:00:02Z</Time><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>';
    const envelope=createTcxImport(xml,{sessionId:'test-run',targetMin:145,targetMax:160,includeHrLoad:true});
    expect(validateTcxImportEnvelope(envelope).action).toBe('valid');
    expect(validateTcxImportEnvelope({...envelope,hrLoadEvidence:{...envelope.hrLoadEvidence,maxGapSeconds:60}}).action).toBe('contract-error');
    expect(validateTcxImportEnvelope({...envelope,timing:undefined}).action).toBe('contract-error');
    expect(validateTcxImportEnvelope({...envelope,timing:{...envelope.timing,localDate:'2026-08-24'}}).action).toBe('contract-error');
  });
});
