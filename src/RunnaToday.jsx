import React, { useState } from 'react';
import { RunnaHub } from './RunnaHub.jsx';
import { latestFeedRow } from './feedSelection.js';
import { loadRunnaReference, RUNNA_TYPES } from './runnaReference.js';
import { plannerDay } from './jointPlanner.js';
import { runnaDayState } from './runnaPolicy.js';
import { boxingToday } from './boxingSchedule.js';
import { DailyCheckin } from './DailyCheckin.jsx';
import { DailyRulePanel } from './DailyRulePanel.jsx';
import { GlassCard, GlassHeader, GlassWeekStrip, glassRead, glassNumber } from './glassUi.jsx';

export function RunnaToday({ feed, log = [], raw, now, freshnessState, onShowLog, onShowPlan, onCheckinSubmit, validation, integrity, activitySummary, quickClose }) {
  const [local, setLocal] = useState(() => { try { return loadRunnaReference(localStorage); } catch { return { reference: null }; } });
  const { state, session } = runnaDayState(local.reference, plannerDay(now));
  const boxing = boxingToday(now), row = latestFeedRow(feed) || {};
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const next = boxing && time <= boxing.start;
  return <div className="glass-page">
    <GlassHeader title="Dziś" now={now} />
    {integrity}
    <DailyRulePanel rows={raw} now={now} />
    <GlassCard className="glass-day-plan">
      <div className="glass-section-title"><h2>Plan dnia</h2><span className="glass-pill">RUNNA + BOKS</span></div>
      <h3>{state === 'missing' ? 'Sprawdź Runnę' : session ? RUNNA_TYPES[session.type] : 'Bez biegu w kopii'}</h3>
      <p>{session ? `${glassNumber(session.km, 2)} km · tempo, odcinki i przerwy według Runny.` : state === 'missing' ? 'Brak kopii planu obejmującej dzisiejszy dzień.' : 'To informacja z planu, nie ocena gotowości.'}</p>
      {boxing && <p className="glass-boxing"><b>DZIŚ BOKS · {boxing.start}–{boxing.end}</b><span>Stały termin klubowy, nie potwierdzenie wykonania.</span></p>}
      <ol className="glass-timeline">
        <li><span>—</span><div><b>Posiłek i suplementy</b><small>Nie ustawiono. Nie przypisujemy godzin ani dawek.</small></div></li>
        <li className={next ? 'is-next' : ''}><span>{boxing?.start || '—'}</span><div><b>{boxing ? 'Boks w klubie' : session ? RUNNA_TYPES[session.type] : 'Trening'}</b><small>{boxing ? `Do ${boxing.end}` : 'Termin i szczegóły sprawdź w Runna'}</small></div></li>
        <li><span>PO</span><div><b>Zamknij trening</b><small>Import wykonania, RPE, ból i zmęczenie nóg.</small></div></li>
        <li><span>—</span><div><b>Sen</b><small>Godzina snu nie została ustawiona.</small></div></li>
      </ol>
      {quickClose || <button className="glass-primary" type="button" onClick={onShowLog}>Zamknij trening ↗</button>}
      <button className="glass-text-button" type="button" onClick={onShowPlan}>Otwórz tydzień i szczegóły Runny →</button>
    </GlassCard>
    <DailyCheckin rows={raw} onSubmit={onCheckinSubmit} />
    <GlassWeekStrip reference={local.reference} rows={log} now={now} onOpenPlan={onShowPlan} />
    <details className="glass-card glass-source-details"><summary>Dane Garmina i kontrola spójności</summary>
      {freshnessState !== 'fresh' || !validation.ok ? <div className="data-quality-banner" role="alert"><strong>Nie potwierdzono kompletnych, aktualnych danych regeneracji.</strong><span>Data źródła: {glassRead(row, 'date') || 'brak danych'}. Dzisiejszy check-in i dane Garmina to oddzielne źródła.</span>{validation.missing?.length ? <span>Brak: {validation.missing.join(', ')}</span> : null}</div> : null}
      <div className="glass-metric-grid">{[['readiness','Gotowość Garmina','/100'],['hrv','HRV nocne','ms'],['rhr','Tętno spoczynkowe','bpm']].map(([field,label,unit]) => <div key={field}><span>{label}</span><strong>{glassNumber(glassRead(row,field),0)}</strong><small>{unit} · {glassRead(row,'date') || 'brak daty'}</small></div>)}</div>
      {activitySummary}
    </details>
    <details className="glass-card glass-source-details"><summary>Kopia Runny · import i ustawienia</summary><RunnaHub now={now} onShowLog={onShowLog} onReferenceChange={reference => setLocal({ reference })} /></details>
  </div>;
}
