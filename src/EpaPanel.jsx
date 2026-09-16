import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { buildEpaAnalysis } from './epa';
import { epaExecutionFor, latestEpaRun, selectEpaActivity } from './epaData';
import { executionIssueMessage } from './sessionExecution';
import { ExecutionStages, stageTargetLabel } from './ExecutionStages';
import { latestFeedRow } from './feedSelection';
import { exactValue, formatMetricNumber, normalize, parseDate, parseMetric, resolveLogSession } from './parse';
import { A } from './schema';
import { connectStrava, stravaActivities, stravaStatus } from './stravaApi';
import { reconcileStravaActivities } from './stravaReconcile';
import { parseSessionMinutes } from './loadMap';
import { buildProgressReport, formatProgressTime, formatProgressPace, progressDay } from './progressReport';

const ZONES = [
  { key: 'z1', id: 'Z1', name: 'Regeneracja', note: 'bardzo lekko', color: '#58c5e8' },
  { key: 'z2', id: 'Z2', name: 'Tlen', note: 'baza tlenowa', color: '#64d8a2' },
  { key: 'z3', id: 'Z3', name: 'Tempo', note: 'kontrolowana praca', color: '#f3c846' },
  { key: 'z4', id: 'Z4', name: 'Próg', note: 'praca progowa', color: '#f07822' },
  { key: 'z5', id: 'Z5', name: 'Szczyt', note: 'wysoka intensywność', color: '#ef4867' },
];

function value(row, field, fallback = '') {
  return exactValue(row || {}, A[field] || [], fallback);
}

function dateKey(input) {
  const date = input instanceof Date ? input : parseDate(input);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rowDate(row) {
  return parseDate(value(row, 'date', ''));
}

function newest(rows = []) {
  return rows.map((row, index) => ({ row, index, time: rowDate(row)?.getTime() ?? -Infinity }))
    .sort((a, b) => b.time - a.time || a.index - b.index)[0]?.row || null;
}

function isRun(row) {
  return ['bieg', 'run', 'running'].includes(normalize(resolveLogSession(row || {}, A.logType)));
}

function sessionFacts(row) {
  if (!row) return null;
  return {
    id: value(row, 'logSessionId', ''),
    date: dateKey(rowDate(row)),
    name: value(row, 'logName', resolveLogSession(row, A.logType) || 'Sesja'),
    type: resolveLogSession(row, A.logType),
    distanceKm: parseMetric(value(row, 'logDistance', '')),
    duration: value(row, 'logDuration', ''),
    hrAvg: parseMetric(value(row, 'logHrAvg', '')),
    hrMax: parseMetric(value(row, 'logHrMax', '')),
    rpe: parseMetric(value(row, 'logRpe', '')),
    pain: parseMetric(value(row, 'logPain', '')),
    legFatigue: parseMetric(value(row, 'logLegFatigue', '')),
  };
}

function duration(seconds) {
  const parsed = parseMetric(seconds);
  if (parsed === null || parsed < 0) return '—';
  const rounded = Math.round(parsed);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

const raceTime = formatProgressTime;

function pct(valueToFormat) {
  return parseMetric(valueToFormat) === null
    ? '—'
    : `${formatMetricNumber(valueToFormat, { maximumFractionDigits: 1 })}%`;
}

function metric(valueToFormat, options = {}) {
  return formatMetricNumber(valueToFormat, { fallback: '—', ...options });
}

function ProgressCharts({ report }) {
  const weeks = report.weekly.values;
  const trend = report.easyTrend;
  const titles = { 'potential-improvement': 'SYGNAŁ POPRAWY', 'potential-regression': 'SYGNAŁ POGORSZENIA', mixed: 'TREND NIEJEDNOZNACZNY', missing: 'BRAK PORÓWNYWALNEJ PRÓBY' };
  return <section className="epa-surface epa-charts">
    <div className="section-heading"><div><span className="eyebrow">HISTORIA I PORÓWNANIE</span><h2>Czy coś się poprawia?</h2></div><span className="section-aside">Stan na {report.asOf}</span></div>
    <div className="epa-chart-grid">
      <article className="epa-weekly-chart">
        <span className="eyebrow">ZAREJESTROWANE KILOMETRY · 8 TYGODNI</span>
        <div className="epa-bars" aria-label="Kilometraż tygodniowy">
          {weeks.length ? weeks.map((week) => <div key={week.week} className={week.noEntries ? 'epa-week-empty' : ''}>
            <i style={{ height: `${report.weekly.maximumKm ? week.km / report.weekly.maximumKm * 100 : 0}%` }} aria-hidden="true" />
            <strong>{week.missingKm ? '≥' : ''}{metric(week.km, { maximumFractionDigits: 1 })}</strong>
            <small>{week.week.slice(5)}</small>
          </div>) : <p>Brak biegów z czytelną datą.</p>}
        </div>
        <p>Puste tygodnie oznaczają brak wpisów w dzienniku. Bieżący tydzień jest niepełny.</p>
        <details className="epa-evidence"><summary>Daty i kompletność tygodni</summary>
          {weeks.map((week) => <p key={week.week}><b>{week.week} — {week.to}</b><br />{week.sessions} biegów · {week.missingKm ? 'co najmniej ' : ''}{metric(week.km)} km{week.noEntries ? ' · brak wpisów' : ''}{week.partial ? ' · niepełny okres' : ''}{week.missingKm ? ` · brak dystansu: ${week.missingKm}` : ''}</p>)}
        </details>
      </article>
      <article className={`epa-easy-trend epa-easy-${trend.state}`}>
        <span className="eyebrow">EASY · TEMPO WZGLĘDEM HR</span><strong>{titles[trend.state]}</strong>
        {trend.state === 'missing' ? <p>Porównywalne biegi: {trend.sample}. Potrzeba dwóch oddzielnych grup po 3 spokojne biegi z czasem, dystansem i HR.</p>
          : <><p>Pierwsze 3: {formatProgressPace(trend.first.paceSeconds)} przy HR {metric(trend.first.hr)}.<br />Ostatnie 3: {formatProgressPace(trend.recent.paceSeconds)} przy HR {metric(trend.recent.hr)}.</p>
            <small>{trend.paceDeltaSeconds === 0 ? 'Tempo bez zmiany' : `${Math.abs(trend.paceDeltaSeconds)} s/km ${trend.paceDeltaSeconds < 0 ? 'szybciej' : 'wolniej'}`} · HR {trend.hrDelta >= 0 ? '+' : ''}{metric(trend.hrDelta)} bpm.</small></>}
        <details className="epa-evidence"><summary>Jak porównujemy i które biegi?</summary>
          <p>Dystans ±20% i HR ±3 bpm względem mediany ostatnich 3 easy. Biegi z przebieżkami, interwałami i progresją są pomijane. Trasa, pogoda i jakość pomiaru mogą zmienić wynik.</p>
          {trend.first ? [trend.first, trend.recent].map((group, i) => <div key={i}><b>{i ? 'Ostatnie 3' : 'Pierwsze 3'}</b>{group.sessions.map((run, j) => <p key={run.id || `${run.date}-${j}`}>{run.date} · {metric(run.km)} km · {formatProgressPace(run.paceSeconds)} · HR {metric(run.hrAvg)}</p>)}</div>) : null}
        </details>
      </article>
    </div>
  </section>;
}

function executionTargetLabel(execution) {
  if (execution.targetMode === 'staged') return stageTargetLabel(execution.targetStages);
  return execution.targetLo === null ? '—' : `${execution.targetLo}–${execution.targetHi} bpm`;
}

function SourceField({ label, children, missing = false }) {
  return <div className={`epa-source-field ${missing ? 'epa-source-missing' : ''}`}><span>{label}</span><strong>{children}</strong></div>;
}

function PersonDetail({ person }) {
  return (
    <article className="epa-surface epa-person-detail" aria-live="polite">
      <div>
        <div className="epa-person-name"><span className="epa-avatar">{person.initials}</span><div><strong>{person.name}</strong><span className={`epa-person-state epa-person-${person.tone}`}>{person.state}</span></div></div>
        <p className="epa-person-copy">{person.principle}</p>
        <div className="epa-data-lines">
          <div className="epa-data-line"><span>MA DANE</span><strong>{person.available.length ? person.available.join(' · ') : 'brak'}</strong></div>
          <div className="epa-data-line"><span>BRAKUJE</span><strong>{person.missing.join(' · ')}</strong></div>
        </div>
      </div>
      <div className="epa-verdict"><span>STATUS PERSPEKTYWY</span><strong>{person.state}</strong><p>{person.verdict}</p></div>
    </article>
  );
}

function ZonesDisclosure({ feed, loading }) {
  const row = newest(feed) || {};
  const anchors = [
    ['HRmax', metric(value(row, 'hrmax', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['LT1', metric(value(row, 'lt1', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['LT2 / LTHR', metric(value(row, 'lt2', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['Moc progowa', metric(value(row, 'thresholdPower', ''), { maximumFractionDigits: 0 }), 'W'],
  ];
  return (
    <details className="epa-zones">
      <summary><span><strong>Kotwice i strefy CARLOS</strong><small>Zachowane do audytu Execution</small></span><b>Rozwiń</b></summary>
      <div className="epa-anchor-grid">
        {anchors.map(([label, anchorValue, unit]) => <article className="epa-anchor" key={label}><span>{label}</span><strong>{anchorValue} {anchorValue === '—' ? '' : unit}</strong></article>)}
      </div>
      <div className="epa-zone-list">
        {loading && !feed.length ? <p className="muted-copy">Wczytuję strefy…</p> : ZONES.map((zone) => (
          <article className="epa-zone" key={zone.id}>
            <span className="epa-zone-badge" style={{ background: zone.color }}>{zone.id}</span>
            <div><strong>{zone.name}</strong><small>{zone.note}</small></div>
            <b>{value(row, zone.key, '—')}</b>
          </article>
        ))}
      </div>
      <p className="epa-zone-note">Kotwice robocze CARLOS pozostają źródłem obliczeń. EPA ich nie zmienia.</p>
    </details>
  );
}

export function EpaPanel({ feed = [], log = [], plan = [], loading = false, access = {}, now = new Date(), onShowDecision }) {
  const reportDate = dateKey(now);
  const [group, setGroup] = useState('coaches');
  const [selectedId, setSelectedId] = useState('canova');
  const [strava, setStrava] = useState({ checked: false, busy: false, configured: false, connected: false, activities: [], message: '' });

  const loadStrava = useCallback(async () => {
    setStrava((current) => ({ ...current, busy: true, message: '' }));
    const result = await stravaActivities(30);
    setStrava((current) => ({
      ...current,
      busy: false,
      activities: result.ok ? result.activities || [] : [],
      message: result.ok ? `Odczytano ${result.activities?.length || 0} aktywności. EPA niczego nie zapisuje.` : 'Nie udało się odczytać aktywności ze Stravy.',
    }));
  }, []);

  useEffect(() => {
    if (!access.authenticated) return undefined;
    let active = true;
    (async () => {
      const status = await stravaStatus();
      if (!active) return;
      const next = {
        checked: true,
        busy: false,
        configured: Boolean(status.ok && status.configured),
        connected: Boolean(status.ok && status.connected),
        activities: [],
        message: status.ok ? '' : 'Nie udało się sprawdzić połączenia ze Stravą.',
      };
      setStrava(next);
      if (!next.connected) return;
      setStrava((current) => ({ ...current, busy: true }));
      const result = await stravaActivities(30);
      if (!active) return;
      setStrava((current) => ({
        ...current,
        busy: false,
        activities: result.ok ? result.activities || [] : [],
        message: result.ok ? '' : 'Strava jest połączona, ale nie zwróciła teraz aktywności.',
      }));
    })();
    return () => { active = false; };
  }, [access.authenticated]);

  const runRows = useMemo(() => log.filter(isRun), [log]);
  const latest = useMemo(() => latestEpaRun(runRows, reportDate), [runRows, reportDate]);
  const latestRunRow = latest.row;
  const session = useMemo(() => sessionFacts(latestRunRow), [latestRunRow]);
  const execution = useMemo(() => epaExecutionFor(latestRunRow, plan), [plan, latestRunRow]);
  const reconciliationSessions = useMemo(() => runRows.map((row) => ({
    id: value(row, 'logSessionId', ''),
    name: value(row, 'logName', resolveLogSession(row, A.logType) || 'Sesja'),
    type: resolveLogSession(row, A.logType),
    date: dateKey(rowDate(row)),
    distanceMeters: parseMetric(value(row, 'logDistance', '')) === null ? null : parseMetric(value(row, 'logDistance', '')) * 1000,
    durationSeconds: parseSessionMinutes(value(row, 'logDuration', '')) === null ? null : parseSessionMinutes(value(row, 'logDuration', '')) * 60,
  })), [runRows]);
  const reconciliation = useMemo(() => reconcileStravaActivities(strava.activities, reconciliationSessions, {
    coverageStartDate: reconciliationSessions.map(({ date }) => date).filter(Boolean).sort()[0] || '',
  }), [reconciliationSessions, strava.activities]);
  const match = useMemo(() => selectEpaActivity(reconciliation.entries, session), [reconciliation.entries, session]);
  const activity = match.activity;
  const progressReport = useMemo(() => buildProgressReport({
    now: reportDate, goalId: '1h30',
    sessions: runRows.map((row) => ({
      id: value(row, 'logSessionId'), date: dateKey(rowDate(row)), time: value(row, 'logTime'),
      status: value(row, 'logStatus'),
      name: value(row, 'logName', resolveLogSession(row, A.logType) || 'Sesja'),
      type: resolveLogSession(row, A.logType),
      distanceKm: value(row, 'logDistance'), durationMinutes: parseSessionMinutes(value(row, 'logDuration')),
      rpe: value(row, 'logRpe'), pain: value(row, 'logPain'), legFatigue: value(row, 'logLegFatigue'),
      hrAvg: value(row, 'logHrAvg'), execution: epaExecutionFor(row, plan),
    })),
  }), [plan, runRows, reportDate]);
  const comparableSessions = progressReport.execution.analyzed;
  const feedRow = useMemo(() => latestFeedRow(feed), [feed]);
  const nextDayAvailable = Boolean(session?.date && rowDate(feedRow)
    && progressDay(rowDate(feedRow)) === progressDay(session.date) + 1
    && (parseMetric(value(feedRow, 'hrv')) !== null || parseMetric(value(feedRow, 'rhr')) !== null));
  const analysis = useMemo(() => buildEpaAnalysis({
    activity,
    session,
    execution,
    phase: value(feedRow, 'phase', ''),
    nextDayAvailable,
    comparableSessions,
  }), [activity, comparableSessions, execution, feedRow, nextDayAvailable, session]);
  const people = group === 'coaches' ? analysis.coaches : analysis.athletes;
  const selected = people.find(({ id }) => id === selectedId) || people[0];
  const switchGroup = (next) => {
    setGroup(next);
    setSelectedId(next === 'coaches' ? analysis.coaches[0].id : analysis.athletes[0].id);
  };
  const stravaText = !strava.checked ? 'sprawdzam połączenie…'
    : !strava.configured ? 'integracja nieskonfigurowana'
      : !strava.connected ? 'konto niepołączone'
        : activity ? `${metric(activity.distanceMeters / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km · ${duration(activity.movingSeconds)} · HR ${metric(activity.averageHeartRate, { maximumFractionDigits: 0 })}/${metric(activity.maxHeartRate, { maximumFractionDigits: 0 })}`
          : match.state === 'review' ? 'Ostatnia sesja: rozbieżność danych — sprawdź w Logu'
            : match.state === 'ambiguous' ? 'Ostatnia sesja: więcej niż jedna możliwa para'
              : `${strava.activities.length} aktywności · brak pewnej pary z ostatnią sesją`;
  const executionReady = analysis.sources.executionReady;
  const executionIssue = executionIssueMessage(execution);

  return (
    <>
      <section className="epa-hero">
        <div><span className="eyebrow">ELITE PERFORMANCE ACADEMY</span><h1>EPA</h1></div>
        <p>Praktyka elity przechodzi przez dane CARLOS i kontrolę podstaw. Nazwisko bez źródła nie tworzy porady.</p>
        <div className="epa-status-row"><span>FAZA · <strong>{analysis.phase}</strong></span><span>EXECUTION · <strong>{comparableSessions} SESJI</strong></span><span>STRAVA · <strong>{!strava.checked ? 'SPRAWDZAM' : strava.connected ? 'POŁĄCZONA' : 'BRAK POŁĄCZENIA'}</strong></span></div>
      </section>

      <section className="epa-surface epa-progress">
        <div className="epa-progress-head"><div><span className="eyebrow">DROGA DO MÁLAGI</span><h2>Cel: {progressReport.target.label}</h2><p>Tempo celu: <strong>{progressReport.target.pace}</strong>. Cel nie jest blokadą; silnik oddziela go od prognozy formy.</p><div className="epa-goal-ladder" aria-label="Drabinka celów półmaratonu">{progressReport.goalOptions.map((goal) => <span className={goal.id === progressReport.target.id ? 'active' : ''} key={goal.id}><strong>{goal.label}</strong> · {goal.pace}</span>)}</div></div><div className={`epa-progress-state epa-progress-${progressReport.history.state}`}>{progressReport.history.state === 'ready' ? '28 DNI HISTORII' : progressReport.history.state === 'missing' ? 'BRAK BIEGÓW' : progressReport.history.state === 'partial' ? 'NIEPEŁNE DANE' : 'ZBIERANIE HISTORII'}</div></div>
        <div className="epa-progress-grid">
          <article><span>OD POCZĄTKU</span><strong>{progressReport.history.missingKm ? '≥' : ''}{metric(progressReport.history.km, { maximumFractionDigits: 1 })} km</strong><small>{progressReport.history.sessions} biegów · najdłuższy {metric(progressReport.history.longestKm, { maximumFractionDigits: 1 })} km</small></article>
          <article><span>OSTATNIE 14 DNI</span><strong>{progressReport.history.recentMissingKm ? '≥' : ''}{metric(progressReport.history.recentKm, { maximumFractionDigits: 1 })} km</strong><small>{progressReport.history.recentFrom} — {progressReport.asOf}<br />{progressReport.history.recentSessions} zarejestrowanych biegów</small><small>{progressReport.history.completeWindows ? `Poprzedni okres: ${metric(progressReport.history.previousKm)} km` : 'Porównanie okresów: niepełna historia lub dane'}</small></article>
          <article><span>PROGNOZA 1/2 M · WSTĘPNA</span>
            <strong>{progressReport.estimate.state === 'provisional' ? raceTime(progressReport.estimate.predictedSeconds) : 'BRAK TESTU'}</strong>
            <small>{progressReport.estimate.source ? `Wiek wyniku: ${progressReport.estimate.sourceAgeDays} ${progressReport.estimate.sourceAgeDays === 1 ? 'dzień' : 'dni'} · ${progressReport.estimate.source.date}` : 'Zwykłe biegi easy nie są podstawą prognozy.'}</small>
            {progressReport.estimate.source ? <details className="epa-evidence"><summary>Wynik źródłowy i różnica do celu</summary>
              <p>{progressReport.estimate.source.name}: {metric(progressReport.estimate.source.km)} km w {raceTime(progressReport.estimate.source.durationSeconds)}.</p>
              <p>Różnica do celu {progressReport.target.label}: {progressReport.estimate.targetGapSeconds >= 0 ? '+' : '−'}{raceTime(Math.abs(progressReport.estimate.targetGapSeconds))}.</p>
              <p>Przeliczenie Riegla (1,06) z jednej próby. Nazwa testu nie potwierdza maksymalnego wysiłku. Wynik opisuje tę próbę; nie potwierdza dzisiejszej formy.</p>
            </details> : null}
          </article>
        </div>
        <div className="epa-priority-list"><span className="eyebrow">PRIORYTETY NA TERAZ</span>{progressReport.priorities.slice(0, 3).map((item, index) => <article key={`${item.state}-${item.title}`}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{item.title}</strong><p>{item.detail}</p></div><small>{item.state}</small></article>)}</div>
      </section>

      <details className="epa-surface epa-evidence epa-audit"><summary>Kompletność raportu i pozostałe obserwacje</summary>
        <p>{progressReport.execution.analyzed}/{progressReport.execution.total} biegów z analizą HR · błędne analizy: {progressReport.execution.invalid} · brak dystansu: {progressReport.history.missingKm}.</p>
        <p>Porównywane okresy: {progressReport.history.previousFrom} — {progressReport.history.previousTo} oraz {progressReport.history.recentFrom} — {progressReport.asOf}.</p>
        <p>Trzy ostatnie easy: {progressReport.execution.easyPattern.sample} z analizą. {progressReport.execution.easyPattern.active ? 'Próg przekroczenia wystąpił w całej trójce.' : 'Brak potwierdzonego ciągu trzech przekroczeń.'}</p>
        {progressReport.priorities.slice(3).map((item) => <p key={item.title}><b>{item.title}</b><br />{item.detail}</p>)}
        {progressReport.issues.length ? <p>Pominięte wpisy: {progressReport.issues.length}. Powody: {[...new Set(progressReport.issues.map(({ reason }) => ({ 'invalid-date': 'błędna data', 'invalid-row': 'błędny wiersz', 'future': 'przyszła data', 'not-completed': 'status niewykonany', 'not-run': 'inny sport', 'duplicate': 'powtórzony wpis', 'conflicting-id': 'sprzeczne Session_ID' }[reason])))].join(', ')}.</p> : null}
        <p>Historia od {progressReport.history.firstDate || 'braku wpisów'}; ostatni zapis {progressReport.history.lastDate || '—'}. Brak wpisu nie potwierdza dnia OFF. Wiek historii nie potwierdza kalibracji HRV.</p>
      </details>
      <ProgressCharts report={progressReport} />

      <section className="epa-main-grid">

        <article className={`epa-surface epa-brief epa-brief-${analysis.brief.tone}`}>
          <span className="eyebrow">EPA BRIEF · FAKTY</span>
          <h2>{analysis.brief.title}</h2>
          <p>{latest.ambiguous ? 'Kilka biegów tego samego dnia bez jednoznacznej godziny. Uzupełnij godzinę w dzienniku, aby wskazać ostatni.' : analysis.brief.copy}</p>
          <div className="epa-brief-footer"><span>TRANSFEROWALNOŚĆ</span><strong>{analysis.sources.state === 'partial' ? 'OGRANICZONA' : 'BRAK PODSTAW'}</strong></div>
        </article>
        <article className="epa-surface epa-run">
          <div className="epa-run-head"><div><span className="eyebrow">OSTATNI BIEG</span><h2>{metric(analysis.brief.distanceKm, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>km</small></h2></div><div><strong>{pct(execution.hrTargetPct)}</strong><span>czasu w celu HR</span></div></div>
          {executionReady ? <><div className="epa-execution-track" aria-label={`${pct(execution.belowTargetPct)} poniżej, ${pct(execution.hrTargetPct)} w celu, ${pct(execution.aboveTargetPct)} powyżej`}><i style={{ width: `${execution.belowTargetPct}%` }} /><i style={{ width: `${execution.hrTargetPct}%` }} /><i style={{ width: `${execution.aboveTargetPct}%` }} /></div><div className="epa-track-legend"><span>poniżej {pct(execution.belowTargetPct)}</span><span>w celu {pct(execution.hrTargetPct)}</span><span>powyżej {pct(execution.aboveTargetPct)}</span></div></> : <p className="epa-no-chart">{execution.status === 'data-error' ? `BŁĄD ANALIZY HR — ${executionIssue}` : session ? 'BIEG ZAPISANY · analiza celu HR do uzupełnienia.' : 'Brak jednoznacznie wskazanego ostatniego biegu.'}</p>}
          <div className="epa-facts"><div><span>CEL HR</span><strong>{executionTargetLabel(execution)}</strong></div><div><span>RPE</span><strong>{metric(session?.rpe, { maximumFractionDigits: 1 })}/10</strong></div><div><span>NOGI</span><strong>{metric(session?.legFatigue, { maximumFractionDigits: 1 })}/10</strong></div></div>
          <ExecutionStages stages={execution.targetStages} analysis={execution.stageAnalysis} analyzedDuration={execution.analyzedDuration} />
        </article>
      </section>

      <section className="epa-surface epa-source-audit">
        <div><span className="eyebrow">DANE DO ANALIZY</span><h2>Strava + Training Log + TCX</h2><p>Najpierw sprawdzamy fakty. Brak pola kończy perspektywę jako „brak podstaw”.</p></div>
        <div className="epa-source-fields">
          <SourceField label="STRAVA" missing={!activity}>{stravaText}</SourceField>
          <SourceField label="TCX / EXECUTION" missing={!executionReady}>{executionReady ? `${pct(execution.hrTargetPct)} w celu · ${executionTargetLabel(execution)}` : execution.status === 'data-error' ? executionIssue : 'brak kompletnej analizy atomowej'}</SourceField>
          <SourceField label="OCENA ZAWODNIKA" missing={session?.rpe === null || session?.pain === null || session?.legFatigue === null}>RPE {metric(session?.rpe)} · nogi {metric(session?.legFatigue)} · ból {metric(session?.pain)}</SourceField>
          <SourceField label="BRAKUJE" missing>{analysis.sources.missing.join(' · ')}</SourceField>
        </div>
        <div className="epa-strava-actions">
          {!strava.checked ? null : !strava.configured ? <span>Skonfiguruj integrację Stravy w środowisku produkcyjnym.</span> : !strava.connected ? <button type="button" onClick={connectStrava}>Połącz Stravę</button> : <button type="button" onClick={loadStrava} disabled={strava.busy}>{strava.busy ? 'Odczytuję…' : 'Odśwież Stravę'}</button>}
          {strava.message ? <small role="status">{strava.message}</small> : null}
        </div>
      </section>

      <details className="epa-methods">
        <summary><span><strong>Metodyka EPA i case studies</strong><small>10 trenerów + 8 studiów przypadku — nie są automatycznymi opiniami o Twoim treningu.</small></span><b>Rozwiń</b></summary>
      <section className="epa-academy">
        <div className="section-heading"><div><span className="eyebrow">METODYKA EPA</span><h2>Perspektywy do weryfikacji</h2></div><span className="section-aside">podstawa albo jawny jej brak</span></div>
        <div className="epa-tabs" role="group" aria-label="Część Akademii"><button type="button" aria-pressed={group === 'coaches'} onClick={() => switchGroup('coaches')}>Elite Coaches · 10</button><button type="button" aria-pressed={group === 'athletes'} onClick={() => switchGroup('athletes')}>Elite Athletes · 8</button></div>
        <div className="epa-person-grid" role="group" aria-label={group === 'coaches' ? 'Trenerzy EPA' : 'Zawodnicy EPA'}>
          {people.map((person) => <button type="button" key={person.id} aria-pressed={person.id === selected?.id} onClick={() => setSelectedId(person.id)}><span className={`epa-person-${person.tone}`}>{person.state}</span><strong>{person.name}</strong></button>)}
        </div>
        {selected ? <PersonDetail person={selected} /> : null}
      </section>

      </details>

      <section className="epa-synthesis">
        <div className="section-heading"><div><span className="eyebrow">SYNTEZA</span><h2>Główny Trener × Sztab × EPA</h2></div><span className="section-aside">bez fikcyjnego głosowania</span></div>
        <div className="epa-compare">
          <article><span>GŁÓWNY TRENER</span><strong>Decyzja dnia w zakładce Dziś</strong><p>Znajdziesz tam werdykt po sprawdzeniu zgodności źródeł, świeżości danych i regeneracji.</p><button type="button" onClick={onShowDecision}>Pokaż aktualną decyzję</button></article>
          <article><span>SZTAB</span><strong>Pełna ocena w zakładce Dziś</strong><p>EPA nie przelicza ani nie duplikuje głosów ról CORE.</p></article>
          <article><span>EPA</span><strong>{analysis.synthesis.state}</strong><p>{analysis.synthesis.conclusion}</p></article>
        </div>
      </section>

      <ZonesDisclosure feed={feed} loading={loading} />
    </>
  );
}
