import React, { useRef, useState } from 'react';
import { DashboardDrawer } from './dashboardUi.jsx';
import { formatMetricNumber } from './parse.js';
import { plannerDay } from './jointPlanner.js';
import { loadRunnaReference, MAX_REFERENCE_BYTES, parseRunnaReference, referenceDays, referencePlanContext, referenceWeekIndex, RUNNA_REFERENCE_KEY, RUNNA_TYPES, serializeRunnaReference } from './runnaReference.js';
import './runnaHub.css';
import { isRunnaDate } from './runnaPolicy.js';

const shortDate = (date, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('pl-PL', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const km = (n) => formatMetricNumber(n, { maximumFractionDigits: 2 });
const title = (session) => session.type === 'boxing' ? 'Boks klubowy' : RUNNA_TYPES[session.type];

function PlanContext({ session, planRows, dataReady }) {
  if (session?.source === 'reference' && isRunnaDate(session.date)) return <aside className="runna-plan-context" aria-label="Źródło planu Runna"><strong>Runna jest źródłem planu biegowego</strong><p>Od 24.09 stary Plan CARLOS nie zmienia tej jednostki. Kopia zawiera typ, datę i dystans — pełne tempo, odcinki i przerwy sprawdź w Runna.</p><p>Nie oceniamy wykonania względem dawnych celów HR lub dystansu z arkusza. Powiązanie pełnego celu Runny z importem wykonania jest jeszcze niedostępne.</p></aside>;
  const context = referencePlanContext(session, planRows, dataReady);
  if (!context) return null;
  const headings = { unavailable: 'Nie potwierdzono aktualnego Planu', ambiguous: `Plan do wyjaśnienia · ${context.entries.length} wpisy na ten dzień`, unlinked: 'Porównaj z aktualnym Planem', missing: 'Brak powiązanego celu w Planie', unknown: 'Nie można potwierdzić celu w Planie' };
  return <aside className="runna-plan-context" aria-label="Porównanie Runna z Planem">
    <strong>{headings[context.state]}</strong>
    <p>{shortDate(session.date)} · kopia Runny nie jest decyzją dnia. Plan w arkuszu może zawierać późniejsze korekty.</p>
    {context.entries.map((entry) => <div key={entry.row}><small>PLAN · WIERSZ {entry.row}{entry.status ? ` · ${entry.status}` : ''}</small>{entry.titles.length ? entry.titles.map((name, i) => <p key={i}>{name}</p>) : <p>Brak nazwy jednostki</p>}{entry.hr ? <small>Cel HR z Planu: {entry.hr}</small> : null}</div>)}
    <p>{context.state === 'unavailable' ? 'Odśwież źródło przed porównaniem.' : context.state === 'ambiguous' ? 'Nie wybieramy jednego wpisu ani nie zastępujemy go rozpiską Runny. Najpierw wyjaśnij, który cel obowiązuje.' : context.state === 'missing' ? 'Nie przeniesiono celu z Runny do arkusza. Nie oceniaj wykonania względem domyślnego celu.' : context.state === 'unknown' ? 'Część wierszy nie ma czytelnej daty. Nie oznacza to pustego planu.' : 'Wspólna data nie potwierdza zgodności. To porównanie, nie automatyczne powiązanie sesji.'}</p>
  </aside>;
}

export function RunnaHub({ now = new Date(), onShowLog, planRows = [], dataReady = false, onReferenceChange }) {
  const [initial] = useState(() => { try { return loadRunnaReference(window.localStorage); } catch { return { reference: null, error: 'Lokalna pamięć jest niedostępna w tej przeglądarce.' }; } });
  const [reference, setReference] = useState(initial.reference);
  const [error, setError] = useState(initial.error);
  const [message, setMessage] = useState('');
  const [selectedStart, setSelectedStart] = useState(null);
  const [selected, setSelected] = useState(null);
  const [boxing, setBoxing] = useState(true);
  const fileRef = useRef(null);
  const today = plannerDay(now);
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_REFERENCE_BYTES) throw new Error('Maksymalny rozmiar kopii planu: 100 kB.');
      const next = parseRunnaReference(await file.text());
      // Commit only after validation and successful persistence. Keep previous copy on failure.
      localStorage.setItem(RUNNA_REFERENCE_KEY, serializeRunnaReference(next));
      setReference(next); onReferenceChange?.(next); setSelectedStart(null); setSelected(null); setError('');
      setMessage('Wczytano kopię na tym urządzeniu. Arkusz i Runna pozostają bez zmian.');
    } catch (e) { setError(e.name === 'QuotaExceededError' || e.name === 'SecurityError' ? 'Przeglądarka nie pozwala zapisać kopii. Poprzedni plan pozostaje bez zmian.' : e.message); }
  };
  const remove = () => {
    try { localStorage.removeItem(RUNNA_REFERENCE_KEY); setReference(null); onReferenceChange?.(null); setSelected(null); setSelectedStart(null); setError(''); setMessage('Usunięto tylko lokalną kopię planu.'); }
    catch { setError('Nie udało się usunąć lokalnej kopii.'); }
  };
  const index = reference ? Math.max(0, selectedStart ? reference.weeks.findIndex((w) => w.start === selectedStart) : referenceWeekIndex(reference, now)) : 0;
  const week = reference?.weeks[index];
  const days = week ? referenceDays(week, boxing) : [];
  const next = reference?.weeks.flatMap((w) => w.sessions).find((s) => s.date >= today);
  const changeWeek = (offset) => setSelectedStart(reference.weeks[index + offset].start);
  const snapshotControls = <>
    <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Plik kopii planu Runna" className="runna-file" onChange={importFile} />
    <button type="button" className="runna-import" onClick={() => fileRef.current?.click()}>{reference ? 'Wczytaj nowszą kopię' : 'Wczytaj kopię planu'}</button>
  </>;

  return <section className="runna-hub" aria-labelledby="runna-hub-title">
    <header className="runna-heading"><div><span className="eyebrow">CARLOS / CENTRUM STEROWANIA</span><h1 id="runna-hub-title">Twój plan.<br /><span>Cały tydzień.</span></h1></div><span className="runna-goal">MÁLAGA 2027<small>7 marca · półmaraton</small></span></header>
    {error ? <p className="runna-message runna-error" role="alert">{error}</p> : null}
    <p className="runna-message" role="status" aria-live="polite">{message}</p>
    {!reference ? <div className="runna-empty"><span className="eyebrow">RUNNA + BOKS + WYKONANIE</span><h2>Twój plan biegowy<br />ma tutaj swoje miejsce.</h2><p>Wczytaj przygotowany plik JSON z rozpiską. Zobaczysz tygodnie, dystanse i terminy klubu — bez przepisywania treningów.</p>{snapshotControls}<small>Kopia lokalna, nie połączenie z kontem Runna. Nie przyjmujemy tu FIT ani TCX — to pliki wykonania.</small></div> : <>
      <div className="runna-source"><span className="runna-source-dot" />Kopia Runna · {shortDate(reference.capturedOn)}<span>Bez automatycznej synchronizacji</span></div>
      <PlanContext session={next} planRows={planRows} dataReady={dataReady} />
      <div className="runna-overview">
        <button type="button" className={`runna-next runna-kind-${next?.type || 'none'}`} onClick={() => { if (next) setSelected(next); }} disabled={!next}>
          <span className="eyebrow">{next?.date === today ? 'DZISIAJ W KOPII PLANU' : 'NAJBLIŻSZY BIEG W KOPII'}</span>
          <strong>{next ? title(next) : 'Koniec dostępnej rozpiski'}</strong>
          {next ? <><span className="runna-distance">{km(next.km)}<small>km</small></span><span className="runna-next-footer">{shortDate(next.date, { weekday: 'long', day: 'numeric', month: 'long' })}<b aria-hidden="true">↗</b></span></> : <span>Wczytaj aktualną kopię, aby zobaczyć kolejne sesje.</span>}
        </button>
        <div className="runna-week-total"><span className="eyebrow">WYBRANY TYDZIEŃ · PLAN, NIE WYKONANIE</span><strong>{km(week.totalKm)}<small> km</small></strong><p>{week.sessions.length} {week.sessions.length === 1 ? 'bieg' : 'sesji biegowych'}{boxing ? ' + 2 terminy boksu' : ''}</p><span>Kilometry biegowe i boks pozostają osobno. Ten układ nie jest oceną gotowości.</span></div>
      </div>
      <nav className="runna-week-nav" aria-label="Tygodnie kopii Runna"><button type="button" disabled={index === 0} onClick={() => changeWeek(-1)} aria-label="Poprzedni tydzień Runna">←</button><div><label htmlFor="runna-week">Tydzień</label><select id="runna-week" value={week.start} onChange={(e) => setSelectedStart(e.target.value)}>{reference.weeks.map((w) => <option key={w.start} value={w.start}>{w.number} · {shortDate(w.start)} — {shortDate(w.end)}</option>)}</select></div><button type="button" disabled={index === reference.weeks.length - 1} onClick={() => changeWeek(1)} aria-label="Następny tydzień Runna">→</button></nav>
      {!(week.start <= today && today <= week.end) ? <div className="runna-away"><span>{today > week.end ? 'Przeglądasz wcześniejszy tydzień.' : 'Przeglądasz przyszły tydzień.'}</span><button type="button" onClick={() => setSelectedStart(null)}>Wróć do bieżącej daty</button></div> : null}
      <div className="runna-calendar">{days.map((day) => <article key={day.date} className={`runna-day ${day.date === today ? 'is-today' : ''}`} aria-label={`Plan Runna ${day.date}`}>
        <header><span>{shortDate(day.date, { weekday: 'short' })}</span><strong>{shortDate(day.date, { day: 'numeric' })}</strong>{day.date === today ? <small>DZIŚ</small> : null}</header>
        <div>{day.sessions.map((session) => <button type="button" key={session.id} className={`runna-session runna-kind-${session.type}`} onClick={() => setSelected(session)}><span className="runna-session-source">{session.source === 'reference' ? 'RUNNA · KOPIA' : 'STAŁY TERMIN'}</span><strong>{title(session)}</strong><span>{session.type === 'boxing' ? `${session.start}–${session.end}` : `${km(session.km)} km`}</span><i aria-hidden="true">↗</i></button>)}{!day.sessions.length ? <p className="runna-no-session">Brak sesji w kopii</p> : null}</div>
      </article>)}</div>
      <details className="runna-roadmap"><summary>Droga do startu <span>{reference.weeks.length} dostępnych tygodni</span></summary><p>Planowane kilometry · kliknij słupek, aby wybrać tydzień. Brakujących tygodni nie zastępujemy zerem.</p><div className="runna-bars">{reference.weeks.map((w) => <button key={w.start} type="button" aria-label={`Tydzień ${w.number}, ${km(w.totalKm)} km`} aria-pressed={w.start === week.start} onClick={() => setSelectedStart(w.start)}><span className="runna-bar-track"><i style={{ height: `${w.totalKm / Math.max(...reference.weeks.map((x) => x.totalKm)) * 100}%` }} /></span><small>{w.number}</small></button>)}</div></details>
      <details className="runna-settings"><summary>Źródło i ustawienia kopii</summary><p>{reference.title} · {reference.sourceLabel} · data kopii {reference.capturedOn}. Zmiana planu w Runna nie zmieni tego widoku, dopóki nie wczytasz nowszej kopii.</p><label><input type="checkbox" checked={boxing} onChange={(e) => setBoxing(e.target.checked)} /> Pokaż terminy boksu we wtorki i czwartki 20:00–22:00</label><p>Stały termin nie potwierdza obecności. Wykonanie sprawdzaj w Logu. Nie łączymy automatycznie aktywności z treningiem tylko na podstawie daty.</p><p>Ta kopia jest przechowywana wyłącznie w przeglądarce. Wylogowanie usuwa ją z tego urządzenia. Zachowaj plik do ponownego wczytania.</p><div className="runna-settings-actions">{snapshotControls}<button type="button" onClick={remove}>Usuń lokalną kopię</button></div></details>
    </>}
    {onShowLog ? <button type="button" className="runna-log-link" onClick={onShowLog}><span>WYKONANIE I FEEDBACK<strong>Sprawdź zapisane treningi</strong></span><span aria-hidden="true">↗</span></button> : null}
    <DashboardDrawer open={!!selected} onClose={() => setSelected(null)} id="runna-session-title" eyebrow={selected?.source === 'appointment' ? 'TERMIN KLUBU · NIE POTWIERDZENIE OBECNOŚCI' : 'RUNNA · SZCZEGÓŁY KOPII'} title={selected ? title(selected) : ''} className="runna-detail">
      <PlanContext session={selected} planRows={planRows} dataReady={dataReady} />
      {selected ? <><p>{shortDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><div className="runna-detail-value">{selected.type === 'boxing' ? `${selected.start}–${selected.end}` : `${km(selected.km)} km`}</div>{selected.type === 'boxing' ? <p>Godziny planowane, nie zarejestrowany czas treningu. Aktywność z pasa i krótki feedback potwierdzą wykonanie; tętno nie określa rodzaju ćwiczeń ani sparingu.</p> : <><h3>Pełna instrukcja: w Runna</h3><p>W przesłanej rozpisce jest typ i dystans. Nie ma tempa, powtórzeń, przerw ani etapów HR. Nie wyznaczamy ich ze zrzutu tygodnia.</p><div className="runna-missing"><span>Tempo <b>Brak w kopii</b></span><span>Etapy i przerwy <b>Brak w kopii</b></span><span>Cel HR <b>Brak w kopii</b></span></div><p>Przed treningiem otwórz jego pełną instrukcję w Runna. {isRunnaDate(selected.date) ? 'Od 24.09 Runna jest źródłem celu. Nie używamy dawnych celów z arkusza do oceny tego biegu. Pełny cel Runny nie jest jeszcze powiązany z importem TCX.' : 'Ten podgląd nie zmienia historycznego celu używanego przez analizę TCX.'}</p></>}<p className="runna-detail-note">Status wykonania nie jest przypisany do tej kopii. Sam upływ daty nie oznacza ukończenia treningu.</p></> : null}
    </DashboardDrawer>
  </section>;
}
