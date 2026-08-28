import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { buildEpaAnalysis } from './epa';
import { computeExecution } from './metrics';
import { exactValue, formatMetricNumber, normalize, parseDate, parseMetric, resolveLogSession } from './parse';
import { A } from './schema';
import { connectStrava, stravaActivities, stravaStatus } from './stravaApi';
import { reconcileStravaActivities } from './stravaReconcile';
import { parseSessionMinutes } from './loadMap';

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

function sameDay(left, right) {
  return Boolean(left && right && dateKey(left) === dateKey(right));
}

function planForSession(plan, row) {
  const date = rowDate(row);
  return date ? (plan || []).find((entry) => sameDay(rowDate(entry), date)) || null : null;
}

function executionFor(row, planRow) {
  if (!row) return computeExecution();
  return computeExecution({
    targetLo: value(row, 'logHrTargetMin', ''),
    targetHi: value(row, 'logHrTargetMax', ''),
    timeInTarget: value(row, 'logTimeInTarget', ''),
    timeAboveTarget: value(row, 'logTimeAboveTarget', ''),
    timeBelowTarget: value(row, 'logTimeBelowTarget', ''),
    analyzedDuration: value(row, 'logHrAnalyzedDuration', ''),
    actualKm: value(row, 'logDistance', ''),
    distanceTargetMin: planRow ? value(planRow, 'planDistanceTargetMin', '') : '',
    distanceTargetMax: planRow ? value(planRow, 'planDistanceTargetMax', '') : '',
  });
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

function pct(valueToFormat) {
  return parseMetric(valueToFormat) === null
    ? '—'
    : `${formatMetricNumber(valueToFormat, { maximumFractionDigits: 1 })}%`;
}

function metric(valueToFormat, options = {}) {
  return formatMetricNumber(valueToFormat, { fallback: '—', ...options });
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

export function EpaPanel({ feed = [], log = [], plan = [], loading = false, access = {} }) {
  const [group, setGroup] = useState('coaches');
  const [selectedId, setSelectedId] = useState('canova');
  const [strava, setStrava] = useState({ checked: false, busy: false, configured: false, connected: false, activities: [], message: '' });

  const loadStrava = useCallback(async () => {
    setStrava((current) => ({ ...current, busy: true, message: '' }));
    const result = await stravaActivities(30);
    setStrava((current) => ({
      ...current,
      busy: false,
      activities: result.ok ? result.activities || [] : current.activities,
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
  const latestRunRow = useMemo(() => newest(runRows), [runRows]);
  const session = useMemo(() => sessionFacts(latestRunRow), [latestRunRow]);
  const latestPlan = useMemo(() => planForSession(plan, latestRunRow), [latestRunRow, plan]);
  const execution = useMemo(() => executionFor(latestRunRow, latestPlan), [latestPlan, latestRunRow]);
  const reconciliationSessions = useMemo(() => runRows.map((row) => ({
    id: value(row, 'logSessionId', ''),
    name: value(row, 'logName', resolveLogSession(row, A.logType) || 'Sesja'),
    type: resolveLogSession(row, A.logType),
    date: dateKey(rowDate(row)),
    distanceMeters: (parseMetric(value(row, 'logDistance', '')) || 0) * 1000,
    durationSeconds: (parseSessionMinutes(value(row, 'logDuration', '')) || 0) * 60,
  })), [runRows]);
  const reconciliation = useMemo(() => reconcileStravaActivities(strava.activities, reconciliationSessions, {
    coverageStartDate: reconciliationSessions.map(({ date }) => date).filter(Boolean).sort()[0] || '',
  }), [reconciliationSessions, strava.activities]);
  const matchedEntry = useMemo(() => {
    const id = session?.id;
    const direct = reconciliation.entries.find((entry) => entry.session?.id === id && ['matched', 'review'].includes(entry.state));
    return direct || reconciliation.entries.find((entry) => ['matched', 'review'].includes(entry.state)) || null;
  }, [reconciliation.entries, session?.id]);
  const activity = matchedEntry?.activity || null;
  const comparableSessions = useMemo(() => runRows.filter((row) => {
    const result = executionFor(row, planForSession(plan, row));
    return ['ok', 'over', 'under'].includes(result.status);
  }).length, [plan, runRows]);
  const feedRow = useMemo(() => newest(feed), [feed]);
  const nextDayAvailable = Boolean(session?.date && rowDate(feedRow) && dateKey(rowDate(feedRow)) > session.date);
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
          : `${strava.activities.length} aktywności · brak pewnej pary z ostatnią sesją`;
  const executionReady = analysis.sources.executionReady;
  const decision = value(feedRow, 'decision', value(feedRow, 'status', 'Brak werdyktu'));

  return (
    <>
      <section className="epa-hero">
        <div><span className="eyebrow">ELITE PERFORMANCE ACADEMY</span><h1>EPA</h1></div>
        <p>Praktyka elity przechodzi przez dane CARLOS i kontrolę podstaw. Nazwisko bez źródła nie tworzy porady.</p>
        <div className="epa-status-row"><span>FAZA · <strong>{analysis.phase}</strong></span><span>EXECUTION · <strong>{comparableSessions} SESJI</strong></span><span>STRAVA · <strong>{strava.connected ? 'POŁĄCZONA' : 'BRAK POŁĄCZENIA'}</strong></span></div>
      </section>

      <section className="epa-main-grid">
        <article className={`epa-surface epa-brief epa-brief-${analysis.brief.tone}`}>
          <span className="eyebrow">EPA BRIEF · FAKTY</span>
          <h2>{analysis.brief.title}</h2>
          <p>{analysis.brief.copy}</p>
          <div className="epa-brief-footer"><span>TRANSFEROWALNOŚĆ</span><strong>{analysis.sources.state === 'partial' ? 'OGRANICZONA' : 'BRAK PODSTAW'}</strong></div>
        </article>
        <article className="epa-surface epa-run">
          <div className="epa-run-head"><div><span className="eyebrow">OSTATNI BIEG</span><h2>{metric(analysis.brief.distanceKm, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>km</small></h2></div><div><strong>{pct(execution.hrTargetPct)}</strong><span>czasu w celu HR</span></div></div>
          {executionReady ? <><div className="epa-execution-track" aria-label={`${pct(execution.belowTargetPct)} poniżej, ${pct(execution.hrTargetPct)} w celu, ${pct(execution.aboveTargetPct)} powyżej`}><i style={{ width: `${execution.belowTargetPct}%` }} /><i style={{ width: `${execution.hrTargetPct}%` }} /><i style={{ width: `${execution.aboveTargetPct}%` }} /></div><div className="epa-track-legend"><span>poniżej {pct(execution.belowTargetPct)}</span><span>w celu {pct(execution.hrTargetPct)}</span><span>powyżej {pct(execution.aboveTargetPct)}</span></div></> : <p className="epa-no-chart">BRAK DANYCH STREFOWYCH — wykres nie rysuje 0%.</p>}
          <div className="epa-facts"><div><span>CEL HR</span><strong>{execution.targetLo === null ? '—' : `${execution.targetLo}–${execution.targetHi} bpm`}</strong></div><div><span>RPE</span><strong>{metric(session?.rpe, { maximumFractionDigits: 1 })}/10</strong></div><div><span>NOGI</span><strong>{metric(session?.legFatigue, { maximumFractionDigits: 1 })}/10</strong></div></div>
        </article>
      </section>

      <section className="epa-surface epa-source-audit">
        <div><span className="eyebrow">DANE DO ANALIZY</span><h2>Strava + Training Log + TCX</h2><p>Najpierw sprawdzamy fakty. Brak pola kończy perspektywę jako „brak podstaw”.</p></div>
        <div className="epa-source-fields">
          <SourceField label="STRAVA" missing={!activity}>{stravaText}</SourceField>
          <SourceField label="TCX / EXECUTION" missing={!executionReady}>{executionReady ? `${pct(execution.hrTargetPct)} w celu ${execution.targetLo}–${execution.targetHi} bpm` : 'brak kompletnej analizy atomowej'}</SourceField>
          <SourceField label="OCENA ZAWODNIKA" missing={session?.rpe === null || session?.pain === null || session?.legFatigue === null}>RPE {metric(session?.rpe)} · nogi {metric(session?.legFatigue)} · ból {metric(session?.pain)}</SourceField>
          <SourceField label="BRAKUJE" missing>{analysis.sources.missing.join(' · ')}</SourceField>
        </div>
        <div className="epa-strava-actions">
          {!strava.checked ? null : !strava.configured ? <span>Skonfiguruj integrację Stravy w środowisku produkcyjnym.</span> : !strava.connected ? <button type="button" onClick={connectStrava}>Połącz Stravę</button> : <button type="button" onClick={loadStrava} disabled={strava.busy}>{strava.busy ? 'Odczytuję…' : 'Odśwież Stravę'}</button>}
          {strava.message ? <small role="status">{strava.message}</small> : null}
        </div>
      </section>

      <section className="epa-academy">
        <div className="section-heading"><div><span className="eyebrow">PEŁNA AKADEMIA</span><h2>10 trenerów + 8 case studies</h2></div><span className="section-aside">podstawa albo jawny jej brak</span></div>
        <div className="epa-tabs" role="group" aria-label="Część Akademii"><button type="button" aria-pressed={group === 'coaches'} onClick={() => switchGroup('coaches')}>Elite Coaches · 10</button><button type="button" aria-pressed={group === 'athletes'} onClick={() => switchGroup('athletes')}>Elite Athletes · 8</button></div>
        <div className="epa-person-grid" role="group" aria-label={group === 'coaches' ? 'Trenerzy EPA' : 'Zawodnicy EPA'}>
          {people.map((person) => <button type="button" key={person.id} aria-pressed={person.id === selected?.id} onClick={() => setSelectedId(person.id)}><span className={`epa-person-${person.tone}`}>{person.state}</span><strong>{person.name}</strong></button>)}
        </div>
        {selected ? <PersonDetail person={selected} /> : null}
      </section>

      <section className="epa-synthesis">
        <div className="section-heading"><div><span className="eyebrow">SYNTEZA</span><h2>Główny Trener × Sztab × EPA</h2></div><span className="section-aside">bez fikcyjnego głosowania</span></div>
        <div className="epa-compare">
          <article><span>GŁÓWNY TRENER</span><strong>{decision}</strong><p>To jedyne źródło operacyjnej decyzji dnia.</p></article>
          <article><span>SZTAB</span><strong>Pełna ocena w zakładce Dziś</strong><p>EPA nie przelicza ani nie duplikuje głosów ról CORE.</p></article>
          <article><span>EPA</span><strong>{analysis.synthesis.state}</strong><p>{analysis.synthesis.conclusion}</p></article>
        </div>
      </section>

      <ZonesDisclosure feed={feed} loading={loading} />
    </>
  );
}
