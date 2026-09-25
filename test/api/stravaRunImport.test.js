import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ append:vi.fn(), get:vi.fn(), auth:vi.fn(), origin:vi.fn() }));
vi.mock('../../api/_lib/googleSheets.js',()=>({appendStravaActivity:mocks.append}));
vi.mock('../../api/_lib/session.js',()=>({allowedRequestOrigin:mocks.origin,authenticated:mocks.auth,serviceConfiguration:()=>({configured:true})}));
vi.mock('../../api/_lib/strava.js',()=>({getStravaActivity:mocks.get,readStravaCredentials:()=>({test:true}),stravaConfiguration:()=>({configured:true}),stravaTokenCookie:()=>''}));
import handler from '../../api/strava/import.js';
const source={id:'123',sportType:'Run',startLocal:'2026-09-25T19:00:00Z',distanceMeters:8000,elapsedSeconds:3600,movingSeconds:3540,hasHeartRate:true,averageHeartRate:160,maxHeartRate:180};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockReturnValue(true);mocks.origin.mockReturnValue(true);mocks.get.mockResolvedValue({activity:source});mocks.append.mockResolvedValue({action:'append',sessionId:'strava-123',rowNumber:2});});
describe('running import endpoint',()=>{
  it('refetches source instead of trusting client metrics and preserves absent RPE',async()=>{
    const res=response();await handler({method:'POST',body:{activityId:'123',category:'Bieg',rpe:null,distanceMeters:999999,averageHeartRate:220}},res);
    expect(res.statusCode).toBe(201);
    expect(mocks.get.mock.calls[0][1]).toBe('123');
    expect(mocks.append.mock.calls[0][0].values).toMatchObject({distance:8,hrAvg:160,hrMax:180,rpe:'',srpe:''});
  });
  it('returns a distinct conflict for a possible existing TCX',async()=>{
    mocks.append.mockResolvedValue({action:'possible-duplicate',reason:'Sprawdź TCX',sessionId:'strava-123'});
    const res=response();await handler({method:'POST',body:{activityId:'123',category:'Bieg',rpe:null}},res);
    expect(res.statusCode).toBe(409);expect(res.body.reason).toBe('Sprawdź TCX');
  });
  it('rejects a different source sport before writing',async()=>{
    mocks.get.mockResolvedValue({activity:{...source,sportType:'Workout'}});
    const res=response();await handler({method:'POST',body:{activityId:'123',category:'Bieg'}},res);
    expect(res.statusCode).toBe(422);expect(mocks.append).not.toHaveBeenCalled();
  });
  it.each(['auth','origin'])('retains %s guard',async guard=>{
    mocks[guard].mockReturnValue(false);
    const res=response();await handler({method:'POST',body:{activityId:'123',category:'Bieg'}},res);
    expect(res.statusCode).toBe(guard==='auth'?401:403);expect(mocks.get).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();
  });
});
