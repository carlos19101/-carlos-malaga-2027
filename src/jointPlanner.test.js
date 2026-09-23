import { describe, expect, it } from 'vitest';
import { buildJointWeek, jointHistory, plannerDay, plannerSport, plannerWeek, previewJointMove, readJointPlan, shiftPlannerDay, suggestJointMove } from './jointPlanner';

const now = new Date('2026-09-21T12:00:00+02:00');
const row = (date = '2026-09-22', title = 'Easy 4–5 km', extra = {}) => ({ Data: date, Rano: title, Status: 'PLANNED', 'Cel HR': '145–158', ...extra });
const week = (planRows = [row()], extra = {}) => buildJointWeek({ planRows, now, ...extra });

describe('kalendarz wspólny — daty', () => {
  it.each(['2026-02-30', '2026-13-01', '25–30.08', '', null, '2026-09-21 śmieci'])('nie akceptuje niejednoznacznej daty %s', (input) => expect(plannerDay(input)).toBeNull());
  it('czyta daty kalendarzowe i nie modyfikuje Date', () => {
    const instant = new Date('2026-09-20T22:30:00Z');
    expect(plannerDay(instant)).toBe('2026-09-21');
    expect(instant.toISOString()).toBe('2026-09-20T22:30:00.000Z');
    expect(plannerDay('21.09.2026')).toBe('2026-09-21');
    expect(plannerDay('21/09/2026')).toBe('2026-09-21');
  });
  it('tydzień jest poniedziałek–niedziela także przez DST i granicę roku', () => {
    expect(plannerWeek('2026-10-25')).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
    expect(shiftPlannerDay('2026-10-24', 2)).toBe('2026-10-26');
    expect(plannerWeek('2027-01-01')[0]).toBe('2026-12-28');
    expect(plannerDay(new Date('bad'))).toBeNull();
    expect(shiftPlannerDay('bad', 1)).toBeNull();
  });
});

describe('adapter bez migracji arkusza', () => {
  it('rozdziela Rano i Później bez przypisywania celów biegu boksowi', () => {
    const result = readJointPlan([row(undefined, undefined, { Później: 'Boks 20–22', Status: 'DONE' })]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toMatchObject({ sport: 'running', status: 'done', targetHr: '145–158' });
    expect(result.sessions[1]).toMatchObject({ sport: 'boxing', targetHr: '', targetRpe: '', status: 'unconfirmed' });
  });
  it('nie podwaja Rano i równoważnego Trening, ale wykrywa różne opisy', () => {
    expect(readJointPlan([row(undefined, undefined, { Trening: 'Easy 4–5 km' })]).sessions).toHaveLength(1);
    expect(readJointPlan([row(undefined, undefined, { Trening: 'Interwały' })]).issues[0].code).toBe('title-conflict');
  });
  it('placeholder w Rano nie zasłania pola Trening', () => {
    expect(readJointPlan([row(undefined, '—', { Trening: 'Easy 5 km', Później: '#N/A' })]).sessions).toHaveLength(1);
  });
  it.each([
    ['OFF biegowy / ABSORB','recovery'], ['Easy + Boks','mixed'], ['Boks','boxing'],
    ['Siła','strength'], ['Rower','aerobic'], ['???','unknown'], ['Easy / long 5–6 km','running'],
  ])('rozpoznaje jedynie jawny opis: %s', (text, expected) => expect(plannerSport(text)).toBe(expected));
  it('nie przedstawia GREEN jako wykonania', () => expect(readJointPlan([row(undefined, undefined, { Status: 'GREEN' })]).sessions[0].status).toBe('planned'));
  it('wykrywa datę bez jednostki', () => expect(readJointPlan([row(undefined, '')]).issues[0].code).toBe('empty'));
});

describe('tydzień z bieganiem i boksem', () => {
  it('tworzy dwa jawne terminy, a nie dowody wykonania', () => {
    const result = week();
    expect(result.sessions.filter((s) => s.source === 'appointment').map((s) => [s.day,s.start,s.end,s.status])).toEqual([
      ['2026-09-22','20:00','22:00','planned'], ['2026-09-24','20:00','22:00','planned'],
    ]);
    expect(result.warnings.some((w) => w.code === 'boxing-same-day')).toBe(true);
  });
  it('boks w Później i boks odwołany nie dublują się z terminem', () => {
    const result = week([row(undefined, undefined, { Później: 'Boks' }), row('2026-09-24','Boks',{Status:'CANCELLED'})]);
    expect(result.sessions.filter((s) => s.source === 'appointment')).toHaveLength(0);
  });
  it('nie tworzy historii boksu przed dziś i po dacie zawodów', () => {
    expect(week([], {now:new Date('2026-09-25T12:00:00Z')}).sessions).toHaveLength(0);
    expect(week([], {weekOf:'2027-03-08'}).sessions).toHaveLength(0);
  });
  it('wyłączenie terminów nie usuwa boksu ze źródła', () => {
    expect(week([row('2026-09-22','Boks')], {boxing:false}).sessions).toHaveLength(1);
  });
  it('brak Planu nie generuje dystansów ani fikcyjnych sesji biegowych', () => {
    const result = week([]);
    expect(result.planSessionCount).toBe(0);
    expect(result.sessions.every((s) => s.sport === 'boxing')).toBe(true);
  });
  it('akcent obok boksu daje ostrzeżenie, nie automatyczny STOP', () => {
    const result = week([row('2026-09-23','Tempo 5 km')]);
    expect(result.warnings.some((w) => w.code === 'key-neighbour')).toBe(true);
    expect(result.sessions[0].status).toBe('planned');
    expect(result.sessions[0].title).toBe('Tempo 5 km');
  });
  it('widzi sąsiednią sesję spoza tygodnia', () => {
    const result = week([row('2026-09-27','Long 8 km'),row('2026-09-28','Boks')]);
    expect(result.warnings.some((w) => w.code === 'key-neighbour')).toBe(true);
  });
  it('nie uznaje jawnego OFF za wolny termin', () => {
    const result = week([row(), row('2026-09-23','OFF')]);
    expect(previewJointMove(result,result.sessions[0].id,'2026-09-23').ok).toBe(false);
  });
  it('blokuje propozycje przy wadliwym źródle i nieznanym typie', () => {
    for (const rows of [[row(),row()], [row('25–30.08')], [row(undefined,'nieznane')]]) expect(week(rows).canSuggest).toBe(false);
    expect(week(undefined,{dataReady:false}).canSuggest).toBe(false);
  });
});

describe('propozycja kalendarza nie jest zapisem lub receptą treningową', () => {
  it('wybiera alternatywę i zachowuje oryginalne dane oraz cele', () => {
    const rows = [row()]; const before = JSON.stringify(rows);
    const result = week(rows); const snapshot = JSON.stringify(result);
    const suggestion = suggestJointMove(result,result.sessions[0].id);
    expect(suggestion).toMatchObject({ok:true,from:'2026-09-22',to:'2026-09-21',writeEnabled:false,requiresConfirmation:true});
    expect(suggestion.session.targetHr).toBe('145–158');
    expect(suggestion.session.originalDay).toBe('2026-09-22');
    expect(JSON.stringify(rows)).toBe(before);
    expect(JSON.stringify(result)).toBe(snapshot);
  });
  it.each(['DONE','SKIPPED','CANCELLED'])('nie przenosi statusu %s', (status) => {
    const result = week([row(undefined,undefined,{Status:status})]);
    expect(suggestJointMove(result,result.sessions[0].id)).toBeNull();
  });
  it('nie przenosi dat minionych, terminu boksu ani sesji poza tydzień', () => {
    const result = week([row('2026-09-21')], {now:new Date('2026-09-23T12:00:00Z')});
    expect(suggestJointMove(result,result.sessions[0].id)).toBeNull();
    const current = week();
    expect(suggestJointMove(current,current.sessions.find((s)=>s.source==='appointment').id)).toBeNull();
    expect(previewJointMove(current,current.sessions[0].id,'2026-09-28').ok).toBe(false);
  });
  it('nie umieszcza biegu na dniu zawodów', () => {
    const result = week([row('2027-03-06')], {now:new Date('2027-03-01T12:00:00Z')});
    expect(previewJointMove(result,result.sessions[0].id,'2027-03-07').ok).toBe(false);
    const race = week([row('2027-03-07','Bieg — Málaga')], {now:new Date('2027-03-01T12:00:00Z')});
    expect(suggestJointMove(race,race.sessions[0].id)).toBeNull();
  });
  it('brak wolnego dnia zwraca brak propozycji, nie podwójną sesję', () => {
    const rows = plannerWeek('2026-09-21').map((day) => row(day));
    const result = week(rows);
    expect(suggestJointMove(result,result.sessions[0].id)).toBeNull();
  });
  it('zachowuje cele atomowe i etapowe bez przepisywania ich z tytułu', () => {
    const stages = '{"schema":"carlos.hr-target-stages.v3","stages":[]}';
    const result = week([row(undefined, undefined, { HR_Target_Stages_JSON:stages, Distance_Target_Max_km:'6' })]);
    expect(suggestJointMove(result,result.sessions[0].id).session.targets).toMatchObject({hrStages:stages,distanceMax:'6'});
  });
  it('wpis biegu w Training Log blokuje przesunięcie bez potwierdzonego powiązania', () => {
    const result = week(undefined,{logRows:[{Date:'2026-09-22',Type:'Bieg',Status:'DONE'}]});
    expect(result.canSuggest).toBe(false);
    expect(result.issues[0].code).toBe('execution-link');
  });
  it('nie przenosi sesji Później na podstawie statusu głównej jednostki', () => {
    const result = week([row('2026-09-22','Siła',{Później:'Easy 5 km'})]);
    expect(suggestJointMove(result,result.sessions.find((s)=>s.slot==='later').id)).toBeNull();
  });
  it('nie traktuje braku ostrzeżeń jako potwierdzonej gotowości', () => {
    const result = week();
    expect(suggestJointMove(result,result.sessions[0].id).reason).toContain('nie potwierdza');
  });
});

describe('historia — brak nie oznacza zero, boks nie oznacza km', () => {
  const log = (date,type,km,extra={}) => ({Date:date,Type:type,Distance_km:km,...extra});
  it('oddziela boks i brakujący dystans', () => {
    const result = jointHistory([log('2026-09-20','Bieg','5,2'),log('2026-09-19','Bieg',''),log('2026-09-18','Boks','15')],now);
    expect(result).toMatchObject({runs:2,boxing:1,km:5.2,distanceCoverage:'1/2',state:'partial'});
  });
  it('pusta historia nie daje zera kilometrów', () => expect(jointHistory([],now)).toMatchObject({km:null,state:'missing'}));
  it('nie zalicza przyszłych, pominiętych ani zbyt starych zapisów', () => {
    expect(jointHistory([log('2026-09-22','Bieg','4'),log('2026-08-24','Bieg','4'),log('2026-09-20','Bieg','4',{Status:'SKIPPED'})],now).runs).toBe(0);
  });
  it('28 dni oznacza okno, nie 28 dni treningów', () => expect(jointHistory([log('2026-08-25','Bieg','4')],now).runs).toBe(1));
  it('duplikaty identyfikatorów nie zawyżają sumy i blokują wiarygodną sumę', () => {
    const record = log('2026-09-20','Bieg','4',{Session_ID:'run-1'});
    expect(jointHistory([record,record],now)).toMatchObject({state:'data-error',duplicateIds:1,km:null,runs:1});
  });
  it('błędna data oraz tekst zamiast liczby pozostają jawne', () => {
    expect(jointHistory([log('bad','Bieg','5'),log('2026-09-20','Bieg','5–6 km')],now)).toMatchObject({invalidDates:1,km:null,state:'data-error'});
  });
});
