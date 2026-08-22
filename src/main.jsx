import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { exactKey, exactValue, normalize, parseCSV, parseDate, parseMetric, resolveLogSession } from './parse';
import {
  daysUntilRace,
  metricDeltaPercent,
  raceGoalMatrix,
  resolveCoachDecision,
  sourceFreshness,
  summarizeLoad,
} from './performance';
import './styles.css';

const SHEET_ID = '1FoExswYMSy5Ou2HwyzPd3bWgnplWgfPGCd5scC0lCXM';
const SHEETS = { feed: 'APP_FEED', log: 'Training Log', plan: 'Plan' };
const APP_VERSION = 'FINAL 4.0';
const SNAPSHOT_KEY = 'carlos:snapshot:final-v4';
const FETCH_TIMEOUT_MS = 8000;
const AUTO_REFRESH_MS = 90000;
const MIN_REFRESH_MS = 15000;
const STALE_AFTER_HOURS = 36;

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'zones', label: 'Strefy', icon: '◒' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'plan', label: 'Plan', icon: '◇' },
];

const A = {
  date: ['date', 'data'],
  lastSynced: ['last synced'],
  recovery: ['recovery', 'readiness'],
  strain: ['strain'],
  sleep: ['sleep', 'sleep score'],
  hrv: ['hrv'],
  hrv7d: ['hrv 7d'],
  rhr: ['rhr'],
  weight: ['weight', 'waga'],
  weightAvg7d: ['weight avg 7d'],
  weightDelta7d: ['weight delta 7d'],
  steps: ['steps', 'kroki'],
  status: ['status'],
  decision: ['decision'],
  pain: ['pain'],
  doms: ['doms'],
  fatigue: ['fatigue'],
  hrmax: ['hrmax'],
  lt1: ['lt1'],
  lt2: ['lt2'],
  thresholdPower: ['threshold power'],
  z1: ['z1'], z2: ['z2'], z3: ['z3'], z4: ['z4'], z5: ['z5'],
  runKm7d: ['run km 7d'],
  runKm28d: ['run km 28d'],
  runCount7d: ['run count 7d'],
  srpe7d: ['srpe 7d'],
  srpe28d: ['srpe 28d'],
  lastRunDistance: ['last run distance'],
  lastRunPace: ['last run pace'],
  lastRunHrAvg: ['last run hr avg'],
  lastRunHrMax: ['last run hr max'],
  lastRunRpe: ['last run rpe'],
  phase: ['phase'],
  goalA: ['goal a'], goalB: ['goal b'], goalC: ['goal c'],
  mainGoal: ['main goal'],

  logTime: ['time', 'czas'],
  logType: ['type', 'typ', 'typ treningu', 'activity'],
  logName: ['name', 'nazwa'],
  logDistance: ['distance km', 'distance_km', 'distance'],
  logDuration: ['duration text', 'duration_text', 'duration', 'czas trwania'],
  logPace: ['pace', 'tempo'],
  logHrAvg: ['hr avg', 'hr_avg'],
  logHrMax: ['hr max', 'hr_max'],
  logPowerAvg: ['power avg', 'power_avg'],
  logRpe: ['rpe'],
  logSrpe: ['srpe'],
  logPain: ['pain'],
  logLoad: ['garmin load', 'garmin_load'],
  logNotes: ['notes', 'uwagi'],
  logSource: ['source', 'zrodlo'],
  logStatus: ['status'],

  planDay: ['dzien', 'dzień'],
  planMorning: ['rano'],
  planLater: ['pozniej', 'później'],
  planHr: ['cel hr'],
  planRpe: ['rpe max'],
  planStatus: ['status'],
  planNotes: ['uwagi'],
  planSession: ['trening', 'session'],
};

const ZONES = [
  { key: 'z1', id: 'Z1', name: 'Recovery', note: 'bardzo lekko', color: '#58c5e8' },
  { key: 'z2', id: 'Z2', name: 'Aerobic', note: 'baza tlenowa', color: '#64d8a2' },
  { key: 'z3', id: 'Z3', name: 'Tempo', note: 'kontrolowana praca', color: '#f3c846' },
  { key: 'z4', id: 'Z4', name: 'Threshold', note: 'próg', color: '#f07822' },
  { key: 'z5', id: 'Z5', name: 'Peak', note: 'wysoka intensywność', color: '#ef4867' },
];

function sheetUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_t=${Date.now()}`;
}

async function fetchSheet(sheetName, signal) {
  const response = await fetch(sheetUrl(sheetName), {
    cache: 'no-store', signal, headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`${sheetName}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return [];
  if (/^\s*</.test(text) && /<html/i.test(text)) throw new Error(`${sheetName}: HTML zamiast CSV`);
  return parseCSV(text);
}

function v(row, field, fallback = '') {
  return exactValue(row, A[field] || [], fallback);
}

function rowDate(row) {
  return parseDate(v(row, 'date', ''));
}

function sortedRows(rows, direction = 'desc') {
  return (rows || [])
    .map((row, i) => ({ row, i, t: rowDate(row)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return direction === 'asc' ? a.t - b.t : b.t - a.t;
    })
    .map((x) => x.row);
}

function latestRow(rows) {
  return sortedRows(rows, 'desc')[0] || {};
}

function sameCalendarDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDate(value, withTime = false) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return String(value || '—');
  return new Intl.DateTimeFormat('pl-PL', withTime
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' }).format(d);
}

function formatNumber(value, digits = 0) {
  const n = parseMetric(value);
  if (n === null) return '—';
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

function metric(value) {
  const n = parseMetric(value);
  return n === null ? null : n;
}

function display(value, suffix = '') {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const raw = String(value).trim();
  return suffix && !raw.endsWith(suffix) ? `${raw}${suffix}` : raw;
}

function validateFeed(row) {
  const missing = [];
  const suspicious = [];
  const required = ['recovery', 'sleep', 'hrv', 'rhr', 'weight'];
  required.forEach((field) => { if (!v(row, field, '')) missing.push(field); });
  const ranges = { recovery: [0, 100], sleep: [0, 100], hrv: [10, 250], rhr: [30, 120], weight: [50, 160], pain: [0, 10] };
  Object.entries(ranges).forEach(([field, [lo, hi]]) => {
    const n = metric(v(row, field, ''));
    if (n !== null && (n < lo || n > hi)) suspicious.push(`${field}=${n} poza ${lo}–${hi}`);
  });
  return { ok: missing.length === 0 && suspicious.length === 0, missing, suspicious };
}

function sourceTime(feedRow) {
  return parseDate(v(feedRow, 'lastSynced', '')) || parseDate(v(feedRow, 'date', ''));
}

function logLoadRecords(rows) {
  return rows.map((row) => ({ date: rowDate(row), srpe: v(row, 'logSrpe', '') })).filter((r) => r.date);
}

function getTodayPlan(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.find((row) => sameCalendarDay(rowDate(row), today)) || null;
}

function getUpcomingPlan(rows, limit = 3) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return sortedRows(rows, 'asc').filter((row) => {
    const d = rowDate(row);
    return d && d >= today;
  }).slice(0, limit);
}

function StatusChip({ status, children }) {
  const s = String(status || '').toUpperCase();
  return <span className={`status-chip status-${s.toLowerCase() || 'neutral'}`}>{children || s || '—'}</span>;
}

function Hero({ feedRow }) {
  const countdown = daysUntilRace();
  return (
    <section className="race-hero">
      <div>
        <span className="eyebrow">MÁLAGA 2027</span>
        <h1>Forma, która ma kierunek.</h1>
        <p>{v(feedRow, 'phase', 'Budujemy bazę i gotowość do półmaratonu.')}</p>
      </div>
      <div className="race-hero-side">
        <span>DO STARTU</span>
        <strong>{countdown ?? '—'}</strong>
        <small>dni · 21,0975 km</small>
      </div>
    </section>
  );
}

function MetricRing({ label, value, note, max = 100, suffix = '%' }) {
  const n = metric(value);
  const progress = n === null ? 0 : Math.max(0, Math.min(100, (n / max) * 100));
  return (
    <article className="ring-card">
      <div className={`metric-ring ${n === null ? 'metric-empty' : ''}`} style={{ '--progress': `${progress * 3.6}deg` }}>
        <div><strong>{n === null ? '—' : display(value, suffix)}</strong><span>{label}</span></div>
      </div>
      <p>{n === null ? 'brak danych w źródle' : note}</p>
    </article>
  );
}

function StatCard({ label, value, unit = '', note = '', tone = '' }) {
  const empty = value === null || value === undefined || String(value).trim() === '';
  return (
    <article className={`stat-card ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{empty ? '—' : value}{!empty && unit ? <small> {unit}</small> : null}</strong>
      <small>{note}</small>
    </article>
  );
}

function TodayPlanCard({ row }) {
  if (!row) return (
    <article className="today-plan-card empty-today">
      <div><span>PLAN NA DZIŚ</span><strong>Brak sesji z dzisiejszą datą</strong></div>
      <p>Decyzja sztabu nadal obowiązuje; kolejna sesja jest widoczna w zakładce Plan.</p>
    </article>
  );
  const status = v(row, 'planStatus', 'PLANNED');
  const morning = v(row, 'planMorning', v(row, 'planSession', 'Sesja'));
  const later = v(row, 'planLater', '');
  return (
    <article className="today-plan-card">
      <div className="today-plan-title">
        <div><span>PLAN NA DZIŚ</span><strong>{morning}</strong></div>
        <StatusChip status={status} />
      </div>
      <div className="today-plan-grid">
        <p><b>Cel HR</b>{v(row, 'planHr', '—')}</p>
        <p><b>RPE max</b>{v(row, 'planRpe', '—')}</p>
        <p><b>Później</b>{later || '—'}</p>
      </div>
      {v(row, 'planNotes', '') ? <small>{v(row, 'planNotes')}</small> : null}
    </article>
  );
}

function Dashboard({ feed, log, plan, loading, freshnessState }) {
  const row = latestRow(feed);
  const validation = useMemo(() => validateFeed(row), [row]);
  const loadFallback = useMemo(() => summarizeLoad(logLoadRecords(log)), [log]);
  const todayPlan = useMemo(() => getTodayPlan(plan), [plan]);
  const upcoming = useMemo(() => getUpcomingPlan(plan), [plan]);
  const matrix = useMemo(() => raceGoalMatrix(), []);

  const decision = useMemo(() => resolveCoachDecision({
    sheetStatus: v(row, 'status', ''),
    sheetDecision: v(row, 'decision', ''),
    fallbackInput: {
      recovery: v(row, 'recovery', ''), sleep: v(row, 'sleep', ''), hrv: v(row, 'hrv', ''), hrv7d: v(row, 'hrv7d', ''),
      pain: v(row, 'pain', ''), doms: v(row, 'doms', ''), fatigue: v(row, 'fatigue', ''), dataOk: validation.ok,
    },
  }), [row, validation.ok]);

  const hrvDelta = metricDeltaPercent(v(row, 'hrv', ''), v(row, 'hrv7d', ''));
  const weightDelta = metric(v(row, 'weightDelta7d', ''));
  const srpe7 = metric(v(row, 'srpe7d', '')) ?? loadFallback.sum7;
  const srpe28 = metric(v(row, 'srpe28d', '')) ?? loadFallback.sum28;
  const ratio = loadFallback.enoughForRatio ? loadFallback.ratio : null;

  const sourceSignals = [
    v(row, 'pain', '') !== '' ? `ból ${v(row, 'pain')}/10` : '',
    v(row, 'doms', '') !== '' ? `DOMS ${v(row, 'doms')}/10` : '',
    v(row, 'fatigue', '') !== '' ? `zmęczenie ${v(row, 'fatigue')}/10` : '',
    hrvDelta !== null ? `HRV ${hrvDelta >= 0 ? '+' : ''}${Math.round(hrvDelta)}% vs 7d` : '',
  ].filter(Boolean);

  return (
    <>
      <Hero feedRow={row} />

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">SZTAB #CARLOS</span><h2>Decyzja dnia</h2></div>
          <StatusChip status={decision.status} />
        </div>
        <article className={`coach-card coach-${decision.status.toLowerCase()}`}>
          <div>
            <span className="coach-label">HEAD COACH</span>
            <strong>{decision.title}</strong>
            <p>{decision.recommendation}</p>
          </div>
          <div className="coach-context">
            <span>{decision.source === 'head-coach' ? 'WERDYKT Z APP_FEED' : 'FALLBACK AUTOMATYCZNY'}</span>
            <p>{sourceSignals.length ? sourceSignals.join(' · ') : 'Brak dodatkowych sygnałów subiektywnych w źródle.'}</p>
            {freshnessState !== 'fresh' ? <small>Uwaga: dane źródłowe nie są oznaczone jako świeże.</small> : null}
          </div>
        </article>
      </section>

      <section className="section-block">
        <TodayPlanCard row={todayPlan} />
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">DZISIAJ</span><h2>Sygnały organizmu</h2></div></div>
        {!validation.ok ? (
          <div className="data-quality-banner" role="alert">
            <strong>DATA ERROR — decyzję traktuj ostrożnie.</strong>
            {validation.missing.length ? <span>Brak: {validation.missing.join(', ')}</span> : null}
            {validation.suspicious.length ? <span>{validation.suspicious.join(' · ')}</span> : null}
          </div>
        ) : null}
        {loading && !feed.length ? <div className="skeleton-grid"><i /><i /></div> : (
          <div className="readiness-grid">
            <MetricRing label="RECOVERY" value={v(row, 'recovery', '')} note="Garmin readiness / recovery" />
            <MetricRing label="SLEEP" value={v(row, 'sleep', '')} note="jakość / realizacja snu" />
            <div className="stats-grid compact-stats">
              <StatCard label="HRV" value={v(row, 'hrv', '')} unit="ms" note={v(row, 'hrv7d', '') ? `7d: ${v(row, 'hrv7d')} ms` : 'nocne HRV'} />
              <StatCard label="RHR" value={v(row, 'rhr', '')} unit="bpm" note="tętno spoczynkowe" />
              <StatCard label="WAGA" value={v(row, 'weight', '')} unit="kg" note={v(row, 'weightAvg7d', '') ? `śr. 7d: ${v(row, 'weightAvg7d')} kg` : 'ostatni odczyt'} />
              <StatCard label="BÓL" value={v(row, 'pain', '')} unit="/10" note="subiektywnie" tone={metric(v(row, 'pain', '')) >= 4 ? 'red' : ''} />
            </div>
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">OBCIĄŻENIE</span><h2>7 / 28 dni</h2></div>
          <span className="section-aside">sRPE + kilometraż</span>
        </div>
        <div className="load-grid">
          <StatCard label="BIEG · 7D" value={v(row, 'runKm7d', '')} unit="km" note={`${v(row, 'runCount7d', '—')} biegów`} />
          <StatCard label="BIEG · 28D" value={v(row, 'runKm28d', '')} unit="km" note="kontekst objętości" />
          <StatCard label="sRPE · 7D" value={srpe7 ? Math.round(srpe7) : ''} note="wszystkie sesje" />
          <StatCard label="sRPE · 28D" value={srpe28 ? Math.round(srpe28) : ''} note="wszystkie sesje" />
          <StatCard label="LOAD RATIO" value={ratio !== null ? ratio.toFixed(2) : ''} note={ratio !== null ? 'informacyjnie: 7d / tyg. ekwiwalent 28d' : 'czeka na dłuższą historię'} />
          <StatCard label="WAGA · TREND" value={weightDelta !== null ? `${weightDelta >= 0 ? '+' : ''}${formatNumber(weightDelta, 1)}` : ''} unit={weightDelta !== null ? 'kg' : ''} note="śr. 7d vs poprzednie 7d" />
        </div>
        <p className="method-note">Load ratio jest kontekstem, nie automatycznym limitem bezpieczeństwa. Finalny werdykt sztabu ma pierwszeństwo.</p>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">OSTATNI BIEG</span><h2>Punkt odniesienia</h2></div></div>
        <article className="last-run-card">
          <div><span>DYSTANS</span><strong>{display(v(row, 'lastRunDistance', ''), ' km')}</strong></div>
          <div><span>TEMPO</span><strong>{v(row, 'lastRunPace', '—')}</strong></div>
          <div><span>HR</span><strong>{v(row, 'lastRunHrAvg', '—')} <small>/ {v(row, 'lastRunHrMax', '—')}</small></strong></div>
          <div><span>RPE</span><strong>{display(v(row, 'lastRunRpe', ''), '/10')}</strong></div>
        </article>
      </section>

      <section className="section-block race-goals">
        <div className="section-heading">
          <div><span className="eyebrow">CEL GŁÓWNY</span><h2>Málaga 07.03.2027</h2></div>
          <span className="section-aside">{v(row, 'phase', '—')}</span>
        </div>
        <div className="goal-chips">
          <span><b>A</b>{v(row, 'goalA', '1:45–1:48')}</span>
          <span><b>B</b>{v(row, 'goalB', '1:48–1:52')}</span>
          <span><b>C</b>{v(row, 'goalC', 'SUB 2:00')}</span>
        </div>
        <div className="race-table-shell">
          <table className="race-table">
            <thead><tr><th>Anchor</th><th>Meta</th><th>Tempo</th><th>5 km</th><th>10 km</th><th>15 km</th></tr></thead>
            <tbody>{matrix.map((goal) => (
              <tr key={goal.id}><td><b>{goal.id}</b></td><td>{goal.finish}</td><td>{goal.pace}</td><td>{goal.km5}</td><td>{goal.km10}</td><td>{goal.km15}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="method-note">Anchory służą do matematyki tempa i międzyczasów; scenariusze A/B/C z arkusza są celami rozwojowymi, nie oceną aktualnej formy.</p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">NASTĘPNE</span><h2>Najbliższe sesje</h2></div>
          <span className="section-aside">{upcoming.length} pozycji</span>
        </div>
        <div className="plan-preview">
          {upcoming.length ? upcoming.map((p, i) => <PlanMini row={p} key={`${v(p, 'date', '')}-${i}`} />) : <p className="muted-copy">Brak kolejnych datowanych sesji.</p>}
        </div>
      </section>
    </>
  );
}

function Zones({ feed, loading }) {
  const row = latestRow(feed);
  const anchors = [
    ['HRmax', v(row, 'hrmax', ''), 'bpm'],
    ['LT1', v(row, 'lt1', ''), 'bpm'],
    ['LT2 / LTHR', v(row, 'lt2', ''), 'bpm'],
    ['Threshold Power', v(row, 'thresholdPower', ''), 'W'],
  ];
  return (
    <>
      <section className="section-hero"><span className="eyebrow">INTENSYWNOŚĆ</span><h1>Strefy i kotwice</h1><p>Wartości robocze z APP_FEED. Treningowe zakresy celowe mogą być węższe niż pełne strefy zegarka.</p></section>
      <section className="section-block anchor-grid">
        {anchors.map(([label, value, unit]) => <StatCard key={label} label={label} value={value} unit={unit} note="kotwica fizjologiczna" />)}
      </section>
      <section className="section-block zone-list">
        {loading && !feed.length ? <div className="skeleton-grid"><i /></div> : ZONES.map((zone) => (
          <article className="zone-card" key={zone.id}>
            <div className="zone-badge" style={{ background: zone.color }}>{zone.id}</div>
            <div><strong>{zone.name}</strong><small>{zone.note}</small><i style={{ background: zone.color }} /></div>
            <b>{v(row, zone.key, '—')}</b>
          </article>
        ))}
      </section>
      <section className="info-card"><strong>Praktyka #carlos</strong><p>Recovery ~135–150 bpm · easy zwykle 150–166 bpm · steady 169–180 bpm · próg roboczo 188–193 bpm. Pełne strefy zegarka pozostają szersze.</p></section>
    </>
  );
}

function LogCard({ row }) {
  const type = resolveLogSession(row, A.logType);
  const name = v(row, 'logName', type || 'Sesja');
  const distance = v(row, 'logDistance', '');
  const duration = v(row, 'logDuration', '');
  const hrAvg = v(row, 'logHrAvg', '');
  const hrMax = v(row, 'logHrMax', '');
  const status = v(row, 'logStatus', '');
  return (
    <article className="log-card">
      <div className="log-card-head">
        <div><span>{formatDate(v(row, 'date', ''))}{v(row, 'logTime', '') ? ` · ${v(row, 'logTime')}` : ''}</span><strong>{name}</strong><small>{type || '—'}</small></div>
        {status ? <StatusChip status={status === 'DONE' ? 'GREEN' : status === 'RECOVERY' ? 'YELLOW' : ''}>{status}</StatusChip> : null}
      </div>
      <div className="log-metrics">
        <p><b>Dystans</b>{distance ? `${distance} km` : '—'}</p>
        <p><b>Czas</b>{duration || '—'}</p>
        <p><b>Tempo</b>{v(row, 'logPace', '—')}</p>
        <p><b>HR</b>{hrAvg ? `${hrAvg}${hrMax ? ` / ${hrMax}` : ''}` : '—'}</p>
        <p><b>RPE</b>{v(row, 'logRpe', '—')}</p>
        <p><b>sRPE</b>{v(row, 'logSrpe', '—')}</p>
      </div>
      {v(row, 'logNotes', '') ? <p className="log-note">{v(row, 'logNotes')}</p> : null}
    </article>
  );
}

function Log({ rows, loading }) {
  const sorted = useMemo(() => sortedRows(rows, 'desc').slice(0, 30), [rows]);
  return (
    <>
      <section className="section-hero"><span className="eyebrow">HISTORIA</span><h1>Training Log</h1><p>Ostatnie 30 wpisów. Bieg, siła, recovery i później boks są liczone jako realne obciążenie systemu.</p></section>
      <section className="section-block log-list">
        {loading && !rows.length ? <div className="skeleton-grid"><i /><i /></div> : sorted.length ? sorted.map((row, i) => <LogCard row={row} key={`${v(row, 'date', '')}-${i}`} />) : <p className="muted-copy">Brak wpisów w Training Log.</p>}
      </section>
    </>
  );
}

function PlanMini({ row }) {
  const date = rowDate(row);
  return (
    <article className="plan-mini">
      <div><b>{date ? formatDate(date) : '—'}</b><small>{v(row, 'planDay', '')}</small></div>
      <div><strong>{v(row, 'planMorning', v(row, 'planSession', 'Sesja'))}</strong><p>{v(row, 'planHr', '') || v(row, 'planNotes', 'Brak dodatkowych uwag')}</p></div>
      <StatusChip status={v(row, 'planStatus', '') === 'DONE' ? 'GREEN' : v(row, 'planStatus', '') === 'ACTIVE' || v(row, 'planStatus', '') === 'CONDITIONAL' ? 'YELLOW' : ''}>{v(row, 'planStatus', 'PLANNED')}</StatusChip>
    </article>
  );
}

function PlanCard({ row }) {
  const date = rowDate(row);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = date && sameCalendarDay(date, today);
  const status = v(row, 'planStatus', 'PLANNED');
  return (
    <article className={`plan-card ${isToday ? 'plan-today' : ''}`}>
      <div className="plan-date-box"><strong>{date ? formatDate(date) : v(row, 'date', '—')}</strong><small>{v(row, 'planDay', '')}</small></div>
      <div className="plan-card-main">
        <div className="plan-card-title"><strong>{v(row, 'planMorning', v(row, 'planSession', 'Sesja'))}</strong><StatusChip status={status === 'DONE' ? 'GREEN' : status === 'ACTIVE' || status === 'CONDITIONAL' ? 'YELLOW' : ''}>{status}</StatusChip></div>
        <div className="plan-details">
          <p><b>Później</b>{v(row, 'planLater', '—')}</p>
          <p><b>Cel HR</b>{v(row, 'planHr', '—')}</p>
          <p><b>RPE max</b>{v(row, 'planRpe', '—')}</p>
        </div>
        {v(row, 'planNotes', '') ? <small>{v(row, 'planNotes')}</small> : null}
      </div>
    </article>
  );
}

function Plan({ rows, loading }) {
  const dated = useMemo(() => sortedRows(rows.filter((r) => rowDate(r)), 'asc'), [rows]);
  const undated = useMemo(() => rows.filter((r) => !rowDate(r)), [rows]);
  return (
    <>
      <section className="section-hero"><span className="eyebrow">DROGA DO CELU</span><h1>Plan</h1><p>Mikrocykl jest adaptacyjny. Status Head Coacha i regeneracja mogą zmienić wykonanie jednostki bez zmiany celu całego bloku.</p></section>
      <section className="section-block plan-list">
        {loading && !rows.length ? <div className="skeleton-grid"><i /><i /></div> : dated.map((row, i) => <PlanCard row={row} key={`${v(row, 'date', '')}-${i}`} />)}
      </section>
      {undated.length ? <section className="section-block"><div className="section-heading"><div><span className="eyebrow">DALEJ</span><h2>Do ustalenia</h2></div></div><div className="plan-list">{undated.map((row, i) => <PlanCard row={row} key={`u-${i}`} />)}</div></section> : null}
    </>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState({ feed: [], log: [], plan: [] });
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [networkSyncedAt, setNetworkSyncedAt] = useState(null);
  const [errors, setErrors] = useState({});
  const [fromCache, setFromCache] = useState(false);
  const dataRef = useRef(data);
  const inFlight = useRef(null);
  const lastAttempt = useRef(0);

  useEffect(() => { dataRef.current = data; }, [data]);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!force && Date.now() - lastAttempt.current < MIN_REFRESH_MS) return;
    lastAttempt.current = Date.now();
    if (inFlight.current) inFlight.current.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setLoading(true);

    const entries = Object.entries(SHEETS);
    const results = await Promise.allSettled(entries.map(([, sheet]) => fetchSheet(sheet, controller.signal)));
    clearTimeout(timer);
    if (inFlight.current !== controller) return;
    inFlight.current = null;

    const merged = { ...dataRef.current };
    const nextErrors = {};
    let anyOk = false;
    results.forEach((result, index) => {
      const [key, sheet] = entries[index];
      if (result.status === 'fulfilled') { merged[key] = result.value; anyOk = true; }
      else nextErrors[key] = result.reason?.name === 'AbortError' ? `${sheet}: timeout` : result.reason?.message || `${sheet}: błąd`;
    });

    const now = Date.now();
    setData(merged);
    setErrors(nextErrors);
    setCheckedAt(now);
    if (anyOk) {
      setNetworkSyncedAt(now);
      setFromCache(false);
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ data: merged, at: now })); } catch { /* optional */ }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      const snap = raw ? JSON.parse(raw) : null;
      if (snap?.data) {
        setData(snap.data); dataRef.current = snap.data; setNetworkSyncedAt(snap.at || null); setFromCache(true);
      }
    } catch { /* ignore corrupted local snapshot */ }
    refresh({ force: true });
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onFocus = () => refresh();
    const onOnline = () => refresh({ force: true });
    const onPageShow = (event) => { if (event.persisted) refresh({ force: true }); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js');
        reg.update().catch(() => undefined);
      } catch { /* PWA remains usable without SW */ }
    };
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  const feedRow = latestRow(data.feed);
  const sourceAt = sourceTime(feedRow);
  const freshness = sourceFreshness(sourceAt, new Date(), STALE_AFTER_HOURS);
  const errorCount = Object.keys(errors).length;
  const offline = errorCount === Object.keys(SHEETS).length;
  const status = offline ? 'offline' : freshness.state === 'stale' ? 'stale' : freshness.state === 'future' || freshness.state === 'unknown' ? 'partial' : errorCount ? 'partial' : 'live';
  const statusLabel = {
    live: 'Dane aktualne', partial: 'Dane częściowe', stale: 'Dane źródłowe są stare', offline: 'Offline — lokalna kopia',
  }[status];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('dashboard')} aria-label="Dashboard">
          <span className="brand-mark">C</span><span><strong>CARLOS</strong><small>MÁLAGA 2027</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Nawigacja">
          {TABS.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>
        <button className="refresh-button" onClick={() => refresh({ force: true })} disabled={loading} aria-label="Odśwież dane">
          <span className={loading ? 'spin' : ''}>↻</span><b>{loading ? 'Sync' : 'Odśwież'}</b>
        </button>
      </header>

      <div className={`sync-strip sync-${status}`} aria-live="polite">
        <span className="live-dot" />
        <strong>{statusLabel}</strong>
        <span>Dane z: {sourceAt ? formatDate(sourceAt, true) : '—'} · Sprawdzono: {checkedAt ? formatDate(new Date(checkedAt), true) : '—'}</span>
      </div>

      {errorCount ? <div className="error-banner" role="status"><strong>{offline ? 'Brak połączenia ze źródłem.' : 'Nie wszystkie arkusze zostały odświeżone.'}</strong><span>{Object.values(errors).join(' · ')}</span>{fromCache ? <span>Pokazuję ostatnią lokalną kopię.</span> : null}</div> : null}

      <main>
        {tab === 'dashboard' && <Dashboard feed={data.feed} log={data.log} plan={data.plan} loading={loading} freshnessState={freshness.state} />}
        {tab === 'zones' && <Zones feed={data.feed} loading={loading} />}
        {tab === 'log' && <Log rows={data.log} loading={loading} />}
        {tab === 'plan' && <Plan rows={data.plan} loading={loading} />}
      </main>

      <footer className="app-footer"><span>{APP_VERSION}</span><span>{networkSyncedAt ? `sieć: ${formatDate(new Date(networkSyncedAt), true)}` : 'brak synchronizacji sieciowej'}</span></footer>

      <nav className="mobile-nav" aria-label="Dolna nawigacja">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
