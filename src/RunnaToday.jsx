import React, { useState } from 'react';
import { RunnaHub } from './RunnaHub.jsx';
import { DashboardSignal } from './dashboardUi.jsx';
import { exactValue, formatMetricNumber } from './parse.js';
import { A } from './schema.js';
import { latestFeedRow } from './feedSelection.js';
import { loadRunnaReference, RUNNA_TYPES } from './runnaReference.js';
import { plannerDay } from './jointPlanner.js';
import { runnaDayState } from './runnaPolicy.js';
import { boxingToday } from './boxingSchedule.js';

export function RunnaToday({ feed, now, freshnessState, onShowLog, onShowPlan, validation, integrity, activitySummary }) {
  const [local, setLocal] = useState(() => { try { return loadRunnaReference(localStorage); } catch { return { reference: null }; } });
  const { state, session } = runnaDayState(local.reference, plannerDay(now));
  const boxing = boxingToday(now);
  const row = latestFeedRow(feed) || {};
  const read = field => exactValue(row, A[field] || [], '');
  return <>
    <section className="dashboard-compact-hero">
      <div className="dashboard-race-meta"><span>CARLOS · TRYB RUNNA</span><b>OD 24.09.2026</b></div>
      <span className="dashboard-hero-label">PLAN BIEGOWY USTALA RUNNA</span>
      <h1>{state === 'missing' ? 'SPRAWDŹ RUNNĘ' : session ? RUNNA_TYPES[session.type] : 'BEZ BIEGU W KOPII'}</h1>
      <strong>{session ? `${formatMetricNumber(session.km, { maximumFractionDigits: 2 })} km · według zapisanej kopii` : state === 'missing' ? 'Brak kopii obejmującej dzisiejszy dzień' : 'To informacja z planu, nie ocena gotowości'}</strong>
      {boxing ? <div className="runna-boxing-today"><b>DZIŚ BOKS · {boxing.start}–{boxing.end}</b><span>Stały termin klubowy · wykonanie potwierdzimy aktywnością</span></div> : null}
      <button className="dashboard-status-pill" type="button" onClick={onShowPlan}>Pokaż plan Runna <span aria-hidden="true">›</span></button>
      <p>Pełne tempo, odcinki i przerwy sprawdź w Runna. CARLOS nie zmienia jednostki ani nie dodaje własnego GO / MODIFY / STOP.</p>
    </section>
    <div className="dashboard-alerts">
      {integrity}
      <p className="muted-copy">Plan nie jest potwierdzeniem gotowości. Regeneracja i jakość danych pozostają widoczne. Boks i feedback zapisujemy osobno; nie wyznacza ich Runna.</p>
      {freshnessState !== 'fresh' || !validation.ok ? <div className="data-quality-banner" role="alert"><strong>Nie potwierdzono kompletnych, aktualnych danych regeneracji.</strong><span>Data źródła: {read('date') || 'brak danych'}. Brak check-inu nie oznacza automatycznie odpoczynku ani zgody na trening.</span>{validation.missing?.length ? <span>Brak: {validation.missing.join(', ')}</span> : null}{validation.suspicious?.map((issue, i) => <span key={i}>{issue}</span>)}</div> : null}
    </div>
    <section className="section-block dashboard-signals-section"><div className="compact-section-heading"><span>DANE REGENERACJI · NIE NOWY PLAN</span></div><div className="dashboard-contributors">
      {[['readiness','GOTOWOŚĆ TRENINGOWA GARMINA','/100'],['sleep','SEN','/100'],['bodyBattery','BODY BATTERY','/100'],['hrv','HRV','ms'],['rhr','RHR','bpm']].map(([field,label,unit]) => <DashboardSignal key={field} label={label} value={formatMetricNumber(read(field), { maximumFractionDigits: 0, fallback: '—' })} unit={unit} tone="" note={`Odczyt z ${read('date') || 'nieznanej daty'}. Brak wartości nie jest zerem. To dane pomocnicze, nie polecenie zmiany Runny.`} />)}
    </div></section>
    {activitySummary}
    <RunnaHub now={now} onShowLog={onShowLog} onReferenceChange={reference => setLocal({ reference })} />
  </>;
}
