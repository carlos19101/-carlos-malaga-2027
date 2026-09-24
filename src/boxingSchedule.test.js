import { describe, expect, it } from 'vitest';
import { boxingToday, boxingWeek } from './boxingSchedule.js';

describe('user-confirmed recurring boxing appointments', () => {
  it('exists without a Runna copy and contains no execution duration or load', () => {
    const slots = boxingWeek('2026-09-24');
    expect(slots.map(s => s.date)).toEqual(['2026-09-22','2026-09-24']);
    for (const slot of slots) {
      expect(slot).toMatchObject({start:'20:00',end:'22:00',status:'planned',source:'user-recurring',runningKnown:false});
      expect(slot).not.toHaveProperty('actualDuration');
      expect(slot).not.toHaveProperty('srpe');
    }
  });
  it('keeps both sports without moving or rewriting the Runna session', () => {
    const reference={weeks:[{start:'2026-09-21',end:'2026-09-27',sessions:[{date:'2026-09-24',type:'easy',km:5}]}]};
    const before=JSON.stringify(reference);
    const slots=boxingWeek('2026-09-24',reference);
    expect(slots[1].run).toEqual(reference.weeks[0].sessions[0]);
    expect(slots[0]).toMatchObject({runningKnown:true,run:null});
    expect(JSON.stringify(reference)).toBe(before);
  });
  it.each(['2026-10-26','2026-12-28','2027-03-29'])('preserves local hours across DST and year boundaries %s', day => {
    expect(boxingWeek(day).map(s=>[s.weekday,s.start,s.end])).toEqual([[2,'20:00','22:00'],[4,'20:00','22:00']]);
  });
  it('uses Warsaw day for the daily card and does not infer completion after 22:00', () => {
    expect(boxingToday(new Date('2026-09-23T22:05:00Z')).date).toBe('2026-09-24');
    expect(boxingToday(new Date('2026-09-24T21:05:00Z')).status).toBe('planned');
    expect(boxingToday(new Date('2026-09-24T22:05:00Z'))).toBeNull();
    expect(boxingWeek('bad')).toEqual([]);
  });
});
