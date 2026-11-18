import React, { useState } from 'react';
import { parseNumber } from './parse.js';
import { parseSessionMinutes } from './loadMap.js';
import { summarizeHrLoad, HR_LOAD_CONFIG } from './hrLoad.js';
import { latestFeedRow } from './feedSelection.js';
import { plannerDay, plannerWeek } from './jointPlanner.js';
import { progressDomain } from './progressChart.js';
import { GlassCard, GlassHeader, GlassRing, completedRows, runningRow, glassRead as read, glassDay, glassNumber as num, dayDistance, shortDay } from './glassUi.jsx';

function timeLabel(minutes) {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function GlassProgress({ log = [], raw = [], feed = [], now = new Date(), onArchive }) {
  const today = plannerDay(now), [mode, setMode] = useState('10k'), [selected, setSelected] = useState(null);
  const done = completedRows(log, today), runs = done.filter(runningRow);
  const ten = runs.flatMap(row => {
    const km = parseNumber(read(row, 'logDistance')), minutes = parseSessionMinutes(read(row, 'logDuration'));
    return km != null && Math.abs(km - 10) <= 0.05 && minutes > 0 ? [{ date: glassDay(row), value: minutes, km, name: read(row, 'logName') }] : [];
  });
  const weeks = new Map();
  runs.forEach(row => {
    const km = parseNumber(read(row, 'logDistance')), week = plannerWeek(glassDay(row))[0];
    if (km > 0 && (!weeks.has(week) || km > weeks.get(week).value)) weeks.set(week, { date: glassDay(row), value: km, km, name: read(row, 'logName') });
  });
  const points = mode === '10k' ? ten : [...weeks.values()].sort((a,b) => a.date.localeCompare(b.date));
  const goal = mode === '10k' ? 47.5 : 18, unit = mode === '10k' ? 'min' : 'km';
  const domain = progressDomain(points.map(p => p.value), goal);
  const y = value => 145 - (value - domain.min) / (domain.max - domain.min) * 110;
  const start = points[0]?.date || today, end = points.at(-1)?.date || today;
  const xy = p => [44 + (dayDistance(start, end) ? dayDistance(start, p.date) / dayDistance(start, end) * 236 : 118), y(p.value)];
  const path = points.map((p,i) => `${i ? 'L' : 'M'} ${xy(p).join(' ')}`).join(' ');
  const focus = points[selected] || points.at(-1), format = p => mode === '10k' ? timeLabel(p.value) : `${num(p.value, 2)} km`;
  const load = summarizeHrLoad(done, raw, now), ratio = load.ratio;
  const left = Math.max(0, dayDistance(today, '2027-03-07')), countdownWeek = left <= 112 && left > 0 ? Math.min(16, Math.floor((112 - left) / 7) + 1) : null;
  const rawRow = raw.filter(r => glassDay(r) && glassDay(r) <= today).sort((a,b) => glassDay(a).localeCompare(glassDay(b))).at(-1);
  const feedRow = latestFeedRow(feed.filter(r => glassDay(r) && glassDay(r) <= today));
  return <div className="glass-page">
    <GlassHeader title="Postęp" now={now} progress />
    <GlassCard className="glass-race-card"><GlassRing value={left} label="dni do startu" fraction={Math.max(0, (112-left)/112)} /><div><span className="glass-eyebrow">7 MARCA 2027 · PÓŁMARATON</span><h2>Krok po kroku<br />do Málagi.</h2><p>{countdownWeek ? `Tydzień ${countdownWeek} z 16` : left === 0 ? 'Dzień startu lub po starcie' : 'Przed 16-tygodniowym odliczaniem'}</p><div className="glass-targets"><div><strong>1:45</strong><small>cel, nie prognoza</small></div><div><strong>4:58/km</strong><small>tempo celu</small></div></div></div><details className="glass-method"><summary>Punkt kontrolny · 3 lutego</summary><p>Zaplanowany przegląd celu po teście. Makieta zakłada test 30 min przy 4:45/km; aplikacja nie potwierdza osiągnięcia celu bez zapisanego wyniku ani nie zastępuje planu Runny.</p></details></GlassCard>
    <GlassCard className="glass-progress-chart"><div className="glass-section-title"><h2>Twoje biegi</h2><span className="glass-eyebrow">TRAINING LOG</span></div><div className="glass-segmented" role="group" aria-label="Rodzaj wykresu">{[['10k','Czas na 10 km'],['long','Długi bieg']].map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setSelected(null); }}>{label}</button>)}</div>
      {points.length ? <><div className="glass-chart-readout" aria-live="polite"><strong>{format(focus)}</strong><span>{shortDay(focus.date)} · {focus.name || 'Zapisany bieg'} · {num(focus.km,2)} km</span></div><svg className="glass-chart" viewBox="0 0 300 180" role="img" aria-label={`${mode === '10k' ? 'Czasy zapisanych biegów około 10 km' : 'Najdłuższe biegi tygodnia'}, ${points.length} pomiarów. Szczegóły dostępne pod wykresem.`}>
        {domain.ticks.map(value => <g key={value}><line x1="44" x2="280" y1={y(value)} y2={y(value)} className="chart-grid"/><text className="chart-y-label" x="36" y={y(value)+4} textAnchor="end">{mode === '10k' ? timeLabel(value) : num(value,1)}</text></g>)}
        <text x="4" y="15">{unit}</text><line x1="44" x2="280" y1={y(goal)} y2={y(goal)} className="chart-goal"/><text className="chart-goal-label" x="280" y={y(goal)-9} textAnchor="end">cel {mode === '10k' ? '47:30' : '18 km'}</text>
        <path key={mode} d={path} className="chart-line" pathLength="1"/>{points.map((p,i) => <circle key={`${mode}-${i}`} cx={xy(p)[0]} cy={xy(p)[1]} r={selected === i ? 6 : 4} className="chart-point"><title>{shortDay(p.date)}: {format(p)}</title></circle>)}<text x="44" y="173">{shortDay(start)}</text><text x="280" y="173" textAnchor="end">{shortDay(end)}</text>
      </svg><div className="glass-chart-picker" aria-label="Wybierz bieg">{points.map((p,i) => <button key={i} type="button" aria-pressed={selected === i} onClick={() => setSelected(i)}>{shortDay(p.date)}<b>{format(p)}</b></button>)}</div></> : <div className="glass-empty"><span aria-hidden="true">↗</span><h3>Jeszcze bez wykresu</h3><p>{mode === '10k' ? 'Brak zapisanych biegów 9,95–10,05 km z czasem. Nie przeliczamy krótszych treningów na wynik 10 km.' : 'Brak zapisanych biegów z dystansem.'}</p><small>Cel {mode === '10k' ? '47:30' : '18 km'} pozostaje celem, nie pomiarem.</small></div>}
      <p className="glass-caption">{mode === '10k' ? 'Przerywana linia: cel 47:30 na 10 km.' : 'Przerywana linia: cel 18 km w lutym'}</p>
      <details className="glass-method"><summary>Co pokazuje wykres · {points.length} pomiarów</summary><p>{mode === '10k' ? 'Rzeczywisty czas biegu, tolerancja dystansu ±50 m. Różne trasy i intensywność ograniczają porównanie; to nie prognoza startowa.' : 'Najdłuższy zapisany bieg każdego tygodnia. Data punktu to dzień wykonania biegu, nie początek tygodnia. Nie każda taka sesja jest treningiem typu long.'} Cel nie jest pomiarem ani przewidywaną poprawą.</p></details>
    </GlassCard>
    <GlassCard><span className="glass-eyebrow">STABILNOŚĆ WYSIŁKU</span><h2>Tempo przy stałym tętnie</h2><div className="glass-empty compact"><strong>—</strong><p>Brak porównywalnej analizy odcinków TCX.</p></div><p className="glass-caption">Zapisane średnie HR i tempo nie wystarczą do wiarygodnego wyliczenia dryfu. Nie rysujemy pozornych pasków postępu.</p></GlassCard>
    <GlassCard className="glass-load">
      <div className="glass-section-title"><h2>Obciążenie</h2><span className="glass-pill">HR · TRIMP</span></div>
      <div className="glass-gauge"><svg viewBox="0 0 240 140" aria-hidden="true">
        <path d="M20 120 A100 100 0 0 1 220 120" className="gauge-track" pathLength="1"/>
        {ratio !== null && <>
          {[[0,.4,'blue'],[.4,.25,'green'],[.65,.1,'yellow'],[.75,.25,'red']].map(([start,length,tone]) => <path key={start} d="M20 120 A100 100 0 0 1 220 120" className="gauge-zone" pathLength="1" stroke={`var(--glass-${tone})`} strokeDasharray={`${length} ${1-length}`} strokeDashoffset={-start} />)}
          <path d="M120 91 L120 35" className="gauge-needle" transform={`rotate(${-90 + Math.min(2,ratio)*90} 120 120)`}/>
        </>}
        <text x="81" y="13">0,8</text><text x="162" y="20">1,3</text><text x="198" y="47">1,5</text>
      </svg><strong>{ratio === null ? '—' : num(ratio,2)}</strong></div>
      <p className="hr-load-status">{load.status === 'calibration' ? `Kalibracja ${load.historyDays} z 28 dni` : load.status === 'partial' ? 'Niepełne dane HR — wskaźnik wstrzymany' : ratio === null ? 'Brak danych do wskaźnika' : `${load.zone} · zakres wskaźnika`}</p>
      <p className="glass-caption">7 dni: {num(load.acute,1)} · 28 dni: {num(load.total28,1)} TRIMP · sesje z HR: {num(load.hrCoverage,0)}%</p>
      <p className="glass-caption">TCX: {load.atomicCount} · szacunek ze średniego HR: {load.estimateCount}{load.historyDays >= 21 && load.historyDays < 28 ? ' · historia częściowa' : ''}</p>
      <details className="glass-method"><summary>sRPE osobno · siła i sesje bez HR</summary><p>7 dni: {num(load.srpe7,0)} AU · 28 dni: {num(load.srpe28,0)} AU. Brak RPE/czasu: {load.srpeMissing} sesji. Nie dodajemy AU do TRIMP.</p></details>
      <details className="glass-method"><summary>Źródło i ograniczenia</summary>
        <p>Banister TRIMP (mężczyźni). HRmax: {HR_LOAD_CONFIG.hrMax} bpm. Próbka HR jest właścicielem czasu do następnej próbki; ostatnia nie dostaje czasu. Pomijamy luki ponad 30 s i brak HR, uwzględniamy postoje z pomiarem. HR poniżej HRrest daje 0 TRIMP. Odczyty ponad HRmax nie są obcinane.</p>
        <p>HRrest: pomiar leżąc z dnia sesji → RHR z tego dnia → 50 bpm. Nowy TCX zachowuje użyty HRrest i źródło w zapisie importu. Szacunki używają dostępnych obecnie danych tego dnia. Średnie HR nie odtwarza zmienności treningu.</p>
        <p>7 dni / (28 dni ÷ 4). Od 21 dni historii wskaźnik może się pojawić; do 28 dni jest wstępny. Liczymy dni kalendarzowe od pierwszej zapisanej sesji, nie dni treningowe. Dni bez wpisów traktujemy jako bez sesji — to nie dowód kompletnego importu. Sesje z HR: odsetek wszystkich zapisanych sesji w 28 dniach, włącznie z siłą.</p>
        <p>„Optymalne” to tylko nazwa umownego zakresu 0,8–1,3, nie gwarancja bezpieczeństwa ani decyzja treningowa. Upał, odwodnienie i stres podczas boksu mogą podnosić HR bez zmiany wykonanej pracy. TRIMP nie mierzy uderzeń ani obciążenia mięśni; sRPE uzupełnia ocenę.</p>
        {load.sessions.map((session, index) => <p key={`${session.sessionId}-${index}`}>{shortDay(session.date)} · {session.name || 'Sesja'}: {session.trimp === null ? (session.srpe === null ? 'brak danych' : `sRPE ${num(session.srpe,0)} AU`) : `${num(session.trimp,1)} TRIMP · ${session.kind === 'atomic' ? 'próbki TCX' : 'szacunek'} · HRrest ${session.rest.value} (${session.rest.source})`}{session.coverage !== undefined ? ` · przeanalizowano ${num(session.coverage*100,1)}% czasu odstępów` : ''}{session.aboveMax ? ' · HR ponad 210: sprawdź pomiar/HRmax' : ''}</p>)}
      </details>
    </GlassCard>
    <GlassCard><h2>Regeneracja · odczyty</h2><div className="glass-metric-grid">{[['Tętno spoczynkowe',read(rawRow,'rawRhr'),'bpm',glassDay(rawRow)],['HRV nocne · 7 dni',read(feedRow,'hrv7d'),'ms',glassDay(feedRow)],['Jakość snu',read(rawRow,'rawSleepScore'),'/100',glassDay(rawRow)]].map(([label,value,unit,date]) => <div key={label}><span>{label}</span><strong>{num(value,0)}</strong><small>{unit} · {date ? shortDay(date) : 'brak daty'}</small></div>)}</div><p className="glass-caption">Ostatnie zapisane odczyty, nie automatyczna ocena zdrowia. Nocnego HRV nie łączymy z porannym rMSSD.</p></GlassCard>
    <button className="glass-text-button" type="button" onClick={onArchive}>EPA · analizy historyczne →</button>
  </div>;
}
