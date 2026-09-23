import React, { useMemo, useState } from 'react';
import { formatMetricNumber } from './parse';
import { buildJointWeek, jointHistory, plannerDay, previewJointMove, shiftPlannerDay, suggestJointMove } from './jointPlanner.js';
import './jointPlanner.css';

const SPORTS = { running: 'Bieg', boxing: 'Boks', strength: 'Siła', aerobic: 'Wydolność', recovery: 'Odpoczynek', mixed: 'Wpis łączony', unknown: 'Typ do ustalenia' };
const STATUS = { done: 'Wykonane w Planie', skipped: 'Pominięte w Planie', planned: 'Zaplanowane', unconfirmed: 'Status wykonania nieprzypisany' };
const shortDay = (day) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

export function JointPlanner({ planRows = [], logRows = [], now = new Date(), dataReady = false }) {
  // Never retain a proposal against changed source data, a new day, or a lost connection.
  const revision = JSON.stringify([planRows, logRows, plannerDay(now), dataReady]);
  return <PlannerView key={revision} planRows={planRows} logRows={logRows} now={now} dataReady={dataReady} />;
}

function PlannerView({ planRows, logRows, now, dataReady }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [boxing, setBoxing] = useState(true);
  const [proposal, setProposal] = useState(null);
  const [message, setMessage] = useState('');
  const week = useMemo(() => buildJointWeek({
    planRows, logRows, now, weekOf: shiftPlannerDay(plannerDay(now), weekOffset * 7), boxing, dataReady,
  }), [planRows, logRows, now, weekOffset, boxing, dataReady]);
  const history = useMemo(() => jointHistory(logRows, now), [logRows, now]);
  const displaySessions = proposal?.ok ? week.sessions.map((s) => s.id === proposal.sourceId ? proposal.session : s) : week.sessions;
  const warnings = proposal?.ok ? proposal.warnings : week.warnings;
  const resetProposal = () => { setProposal(null); setMessage(''); };
  const moveWeek = (offset) => { setWeekOffset(offset); resetProposal(); };
  const suggest = (id) => {
    const result = suggestJointMove(week, id);
    setProposal(result);
    setMessage(result ? 'Pokazano alternatywę w podglądzie. Plan w arkuszu pozostał bez zmian.' : 'Brak wolnego dnia spełniającego zasady tej propozycji. Nie upychamy zaległych treningów.');
  };
  const chooseDay = (id, day) => {
    const result = previewJointMove(week, id, day);
    if (result.ok) { setProposal(result); setMessage('Zmieniono tylko podgląd tygodnia.'); }
    else setMessage(result.reason);
  };

  return <section className="joint-planner" aria-labelledby="joint-planner-title">
    <header className="joint-heading">
      <div><span className="eyebrow">PÓŁMARATON + BOKS</span><h2 id="joint-planner-title">Jeden wspólny tydzień</h2></div>
      <span className="joint-preview-label">Podgląd · bez zapisu</span>
    </header>
    <p className="joint-description">Málaga · 7 marca 2027. Biegi z Planu i stałe terminy klubu w jednym kalendarzu. Na tym etapie dobieramy układ, nie nowe dawki treningu.</p>
    <details className="joint-settings">
      <summary>Założenia i granice planowania</summary>
      <label><input type="checkbox" checked={boxing} onChange={(event) => { setBoxing(event.target.checked); resetProposal(); }} />Uwzględnij stałe terminy boksu: wtorek i czwartek 20:00–22:00</label>
      <p>Terminy klubu nie potwierdzają obecności, czasu wykonania ani intensywności. Wpis boksu w Planie ma pierwszeństwo przed terminem stałym. Nie dokładamy automatycznie dwóch siłowni i roweru z FOUNDATION 01 do biegów.</p>
      <p>Propozycja przesuwa tylko istniejący bieg, zachowując jego cele. Nie jest oceną gotowości ani zatwierdzonym treningiem. Znika po zmianie danych, odświeżeniu strony lub opuszczeniu zakładki.</p>
    </details>

    <nav className="joint-week-nav" aria-label="Wybór tygodnia">
      <button type="button" disabled={weekOffset === 0} onClick={() => moveWeek(weekOffset - 1)} aria-label="Poprzedni tydzień">←</button>
      <strong>{week.days.length ? `${shortDay(week.days[0])} — ${shortDay(week.days[6])}` : 'Nieprawidłowa data'}</strong>
      <button type="button" disabled={weekOffset >= 8} onClick={() => moveWeek(weekOffset + 1)} aria-label="Następny tydzień">→</button>
      {weekOffset > 0 ? <button type="button" onClick={() => moveWeek(0)}>Ten tydzień</button> : null}
    </nav>

    {week.issues.length ? <div className="joint-notice" role="status"><strong>Do wyjaśnienia przed propozycją zmian</strong><ul>{week.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div> : null}
    {!week.planSessionCount ? <p className="joint-notice">Brak datowanych jednostek z Planu na ten tydzień. Terminy klubu nie zastępują planu biegowego. Nie generujemy kilometrażu z pustej listy.</p> : null}
    {warnings.length ? <details className="joint-notice" open><summary>Układ do sprawdzenia · {warnings.length}</summary><ul>{warnings.map((warning, i) => <li key={i}>{warning.message}</li>)}</ul></details> : null}
    <p className="joint-live" role="status" aria-live="polite">{message}</p>
    {proposal?.ok ? <aside className="joint-proposal" aria-label="Propozycja zmiany terminu">
      <strong>Propozycja: {proposal.session.title}</strong>
      <p>{shortDay(proposal.from)} → {shortDay(proposal.to)}</p>
      <p>{proposal.reason}</p>
      <label>Porównaj inny dzień<select aria-label="Dzień propozycji" value={proposal.to} onChange={(event) => chooseDay(proposal.sourceId, event.target.value)}>
        {week.days.map((day) => <option key={day} value={day} disabled={!previewJointMove(week, proposal.sourceId, day).ok}>{shortDay(day)}</option>)}
      </select></label>
      <button type="button" onClick={resetProposal}>Przywróć widok źródłowy</button>
      <small>Nie zapisano do Planu. Zapis zatwierdzonej propozycji jest osobnym, jeszcze niewdrożonym etapem.</small>
    </aside> : null}

    <div className="joint-days">
      {week.days.map((day) => <article className={`joint-day ${day === week.today ? 'joint-today' : ''}`} key={day} aria-label={day}>
        <header><h3>{shortDay(day)}</h3>{day === week.today ? <span>Dzisiaj</span> : null}</header>
        {displaySessions.filter((s) => s.day === day).map((session) => <details className={`joint-session joint-${session.sport}`} key={session.id}>
          <summary><span className="joint-session-type">{SPORTS[session.sport]}{session.key ? ' · kluczowy termin / cel' : ''}</span><strong>{session.title}</strong>
            <small>{session.source === 'appointment' ? `${session.start}–${session.end} · stały termin, nie wpis w Planie` : STATUS[session.status]}</small>
            {session.originalDay !== session.day ? <span className="joint-moved">Zmieniono tylko podgląd</span> : null}
          </summary>
          <div className="joint-session-body">
            {session.source === 'plan' ? <p>Źródło: Plan, wiersz {session.sourceRow}, {session.slot === 'later' ? 'Później' : 'Rano / Trening'}. Oryginalna data: {session.originalDay}.</p> : null}
            {session.targetHr ? <p><b>Cel HR:</b> {session.targetHr}</p> : null}
            {session.targetRpe ? <p><b>Cel RPE:</b> {session.targetRpe}</p> : null}
            {session.notes ? <p>{session.notes}</p> : null}
            {session.source === 'plan' && session.sport === 'running' && session.status === 'planned' && session.originalDay >= week.today ? <button type="button" disabled={!week.canSuggest} onClick={() => suggest(session.id)}>Zaproponuj inny dzień</button> : null}
          </div>
        </details>)}
        {!displaySessions.some((s) => s.day === day) ? <p className="joint-empty">Brak wpisu — nie oznacza zaplanowanego odpoczynku.</p> : null}
      </article>)}
    </div>

    <details className="joint-history">
      <summary>Na czym oprzemy dalszą adaptację?</summary>
      <p>Training Log · ostatnie 28 dni: {history.runs} zapisów biegowych i {history.boxing} zapisów boksu. To historia zarejestrowana, nie potwierdzenie kompletności treningów.</p>
      <p>Dystans znanych zapisów: <b>{formatMetricNumber(history.km)}{history.km !== null ? ' km' : ''}</b> · pokrycie dystansu {history.distanceCoverage} biegów.</p>
      {history.invalidDates || history.duplicateIds ? <p>Problemy historii: {history.invalidDates} nieczytelnych dat, {history.duplicateIds || 0} powtórzonych identyfikatorów. Nie używamy takiego zestawu do progresji.</p> : null}
      <p>Kolejny etap wymaga potwierdzonej dostępności, aktualnego poziomu biegowego i informacji o tolerancji boksu. Nie przeliczamy boksu na kilometry ani nie uznajemy braku feedbacku za dobrą regenerację.</p>
    </details>
  </section>;
}
