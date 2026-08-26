import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  buildSheetCsvUrl,
  datedRowsError,
  exactKey,
  exactValue,
  findRecentMeasurement,
  formatMetricNumber,
  isRecoveryActivity,
  normalize,
  normalizeActivityStatus,
  parseCSV,
  parseDate,
  parseMetric,
  resolveLogSession,
  validateDailyFeed,
} from './parse';
import {
  daysUntilRace,
  metricDeltaPercent,
  millisecondsUntilNextLocalMidnight,
  raceGoalMatrix,
  resolveCoachDecision,
  sourceFreshness,
} from './performance';
import { computeExecution, computeLoad, computeVerifierMetrics, crossValidate } from './metrics';
import { computeDailyMetrics } from './dailyMetrics';
import { buildDecisionJournal } from './decisionJournal';
import { buildStaffPanel } from './staffPanel';
import { fetchPrivateApplicationData, parseApplicationSnapshot } from './appDataApi';
import { feedbackLogin, feedbackLogout, feedbackSessionStatus, sendTcxImport, sendTrainingFeedback } from './feedbackApi';
import {
  createTrainingFeedback,
  enqueueTrainingFeedback,
  flushTrainingFeedbackQueue,
  readFeedbackQueue,
} from './trainingFeedback';
import { MAX_TCX_FILE_BYTES, prepareTcxImport, tcxImportPreview } from './tcxImportClient';
import { A, sheetContractError } from './schema';
import './styles.css';

const SHEET_ID = '1FoExswYMSy5Ou2HwyzPd3bWgnplWgfPGCd5scC0lCXM';
const SHEETS = { feed: 'APP_FEED', log: 'Training Log', plan: 'Plan', raw: 'Raw_Data' };
const SHEET_QUERIES = { raw: 'select A,B,C,D,E,G,H,I,J,O,P,Q,R,S,T,AL' };
const APP_VERSION = 'FINAL 5.2';
const SNAPSHOT_KEY = 'carlos:snapshot:final-v4';
const FETCH_TIMEOUT_MS = 8000;
const MIN_REFRESH_MS = 15000;
const STALE_AFTER_HOURS = 36;
const EMPTY_DATA = { feed: [], log: [], plan: [], raw: [] };

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'zones', label: 'Strefy', icon: '◒' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'plan', label: 'Plan', icon: '◇' },
];

const ZONES = [
  { key: 'z1', id: 'Z1', name: 'Recovery', note: 'bardzo lekko', color: '#58c5e8' },
  { key: 'z2', id: 'Z2', name: 'Aerobic', note: 'baza tlenowa', color: '#64d8a2' },
  { key: 'z3', id: 'Z3', name: 'Tempo', note: 'kontrolowana praca', color: '#f3c846' },
  { key: 'z4', id: 'Z4', name: 'Threshold', note: 'próg', color: '#f07822' },
  { key: 'z5', id: 'Z5', name: 'Peak', note: 'wysoka intensywność', color: '#ef4867' },
];

function sheetUrl(sheetName, query = '') {
  return buildSheetCsvUrl(SHEET_ID, sheetName, Date.now(), query);
}

async function fetchSheet(sheetName, signal, query = '') {
  const response = await fetch(sheetUrl(sheetName, query), {
    cache: 'no-store', signal, headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`${sheetName}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return [];
  if (/^\s*</.test(text) && /<html/i.test(text)) throw new Error(`${sheetName}: HTML zamiast CSV`);
  const rows = parseCSV(text);
  const contractError = sheetContractError(rows, sheetName);
  if (contractError) throw new Error(`DATA ERROR — ${contractError}`);
  const dateError = datedRowsError(rows, A.date, sheetName);
  if (dateError) throw new Error(`DATA ERROR — ${dateError}`);
  return rows;
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

function metric(value) {
  const n = parseMetric(value);
  return n === null ? null : n;
}

function validateFeed(row, weight = v(row, 'weight', '')) {
  return validateDailyFeed({
    date: v(row, 'date', ''),
    status: v(row, 'status', ''),
    readiness: v(row, 'readiness', ''),
    recovery: v(row, 'recovery', ''),
    bodyBattery: v(row, 'bodyBattery', ''),
    sleep: v(row, 'sleep', ''),
    hrv: v(row, 'hrv', ''),
    rhr: v(row, 'rhr', ''),
    weight,
    pain: v(row, 'pain', ''),
  });
}

function resolveWeight(feedRow, rawRows, now) {
  const current = v(feedRow, 'weight', '');
  if (metric(current) !== null) return { value: current, date: rowDate(feedRow), ageDays: 0, inherited: false };
  const recent = findRecentMeasurement(rawRows, {
    dateAliases: A.date,
    valueAliases: A.weight,
    now,
    maxAgeDays: 7,
  });
  return recent ? { ...recent, inherited: true } : null;
}

function formatNumericDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' }).format(date);
}

function sourceTime(feedRow) {
  return parseDate(v(feedRow, 'lastSynced', '')) || parseDate(v(feedRow, 'date', ''));
}

function verifierTrainingRecords(rows) {
  return rows.map((row) => ({
    date: v(row, 'date', ''),
    type: resolveLogSession(row, A.logType),
    km: v(row, 'logDistance', ''),
    srpe: v(row, 'logSrpe', ''),
  }));
}

function verifierWeightRecords(rows) {
  return rows.map((row) => ({ date: v(row, 'date', ''), weight: v(row, 'weight', '') }));
}

function verifierFeedMetrics(row) {
  return {
    km7: v(row, 'runKm7d', ''),
    km28: v(row, 'runKm28d', ''),
    srpe7: v(row, 'srpe7d', ''),
    srpe28: v(row, 'srpe28d', ''),
    sessions7: v(row, 'runCount7d', ''),
    weight: v(row, 'weight', ''),
  };
}

function isRunLogRow(row) {
  return ['bieg', 'run', 'running'].includes(normalize(resolveLogSession(row, A.logType)));
}

function planForLogRow(planRows, logRow) {
  const date = logRow ? rowDate(logRow) : null;
  if (!date) return null;
  return planRows.find((planRow) => sameCalendarDay(rowDate(planRow), date)) || null;
}

function executionInput(logRow, planRow) {
  if (!logRow) return {};
  return {
    targetLo: v(logRow, 'logHrTargetMin', ''),
    targetHi: v(logRow, 'logHrTargetMax', ''),
    timeInTarget: v(logRow, 'logTimeInTarget', ''),
    timeAboveTarget: v(logRow, 'logTimeAboveTarget', ''),
    timeBelowTarget: v(logRow, 'logTimeBelowTarget', ''),
    analyzedDuration: v(logRow, 'logHrAnalyzedDuration', ''),
    actualKm: v(logRow, 'logDistance', ''),
    distanceTargetMin: planRow ? v(planRow, 'planDistanceTargetMin', '') : '',
    distanceTargetMax: planRow ? v(planRow, 'planDistanceTargetMax', '') : '',
  };
}

function getTodayPlan(rows, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return rows.find((row) => sameCalendarDay(rowDate(row), today)) || null;
}

function getUpcomingPlan(rows, limit = 3, now = new Date()) {
  const today = new Date(now);
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

function statusTone(status) {
  if (status === 'DONE' || status === 'GREEN') return 'GREEN';
  if (status === 'ACTIVE' || status === 'CONDITIONAL' || status === 'YELLOW') return 'YELLOW';
  if (status === 'RED') return 'RED';
  return '';
}

function ActivityBadges({ status, recovery = false }) {
  const normalizedStatus = normalizeActivityStatus(status);
  if (!normalizedStatus && !recovery) return null;
  return (
    <div className="activity-badges">
      {normalizedStatus ? <StatusChip status={statusTone(normalizedStatus)}>{normalizedStatus}</StatusChip> : null}
      {recovery ? <StatusChip status="YELLOW">RECOVERY</StatusChip> : null}
    </div>
  );
}

function Hero({ feedRow, now }) {
  const countdown = daysUntilRace(now);
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
  const formatted = formatMetricNumber(value, { maximumFractionDigits: 0 });
  return (
    <article className="ring-card">
      <div className={`metric-ring ${n === null ? 'metric-empty' : ''}`} style={{ '--progress': `${progress * 3.6}deg` }}>
        <div><strong>{n === null ? '—' : `${formatted}${suffix}`}</strong><span>{label}</span></div>
      </div>
      <p>{n === null ? 'brak danych' : note}</p>
    </article>
  );
}

function StatCard({ label, value, unit = '', note = '', tone = '' }) {
  const empty = value === null || value === undefined || /^(?:|—|–|-)$/.test(String(value).trim());
  return (
    <article className={`stat-card ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{empty ? '—' : value}{!empty && unit ? <small> {unit}</small> : null}</strong>
      <small>{empty ? 'brak danych' : note}</small>
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
        <ActivityBadges status={status} recovery={isRecoveryActivity(morning, status)} />
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

function VerifierBanner({ mismatches }) {
  if (!mismatches.length) return null;
  const severity = mismatches.some((item) => item.severity === 'error') ? 'error' : 'warning';
  const digits = (field) => field.startsWith('km') || field === 'weight' ? 2 : 0;
  const display = (item, value) => {
    const formatted = formatMetricNumber(value, { maximumFractionDigits: digits(item.field) });
    return item.unit ? `${formatted} ${item.unit}` : formatted;
  };
  return (
    <div className={`data-quality-banner verifier-${severity}`} role={severity === 'error' ? 'alert' : 'status'}>
      <strong>{severity === 'error'
        ? 'NIEZGODNOŚĆ ŹRÓDEŁ — jedna z wartości jest błędna.'
        : 'RÓŻNICA ŹRÓDEŁ — sprawdź wartości przed decyzją.'}</strong>
      {mismatches.map((item) => (
        <span key={item.field}>{item.label}: APP_FEED {display(item, item.fromFeed)} vs policzone {display(item, item.computed)}</span>
      ))}
    </div>
  );
}

function dailyMetricNote(daily, field, prefix = '') {
  const metricState = daily?.metrics?.[field];
  const metricBaseline = metricState?.baseline;
  if (!metricBaseline) return prefix;
  const baselineNote = !metricBaseline.ready
    ? `baseline: KALIBRACJA ${metricBaseline.calibrationDays} · n=${metricBaseline.n}`
    : metricState.zScore === null
      ? `baseline gotowy · n=${metricBaseline.n}`
      : `${metricState.zScore >= 0 ? '+' : ''}${formatMetricNumber(metricState.zScore, { maximumFractionDigits: 2 })} SD vs baseline · n=${metricBaseline.n}`;
  return [prefix, baselineNote].filter(Boolean).join(' · ');
}

function DailyMetricsStatus({ daily }) {
  const actionable = (daily?.issues || []).filter(({ severity }) => severity === 'error' || severity === 'warning');
  const severity = actionable.some(({ severity: itemSeverity }) => itemSeverity === 'error') ? 'error' : 'warning';
  return (
    <>
      {actionable.length ? (
        <div className={`data-quality-banner verifier-${severity}`} role={severity === 'error' ? 'alert' : 'status'}>
          <strong>RAW_DATA — wykryto problem z integralnością danych.</strong>
          {actionable.slice(0, 4).map((item, index) => <span key={`${item.id}-${item.date || 'row'}-${index}`}>{item.detail}</span>)}
        </div>
      ) : null}
      {daily?.bridgeSignal?.active ? (
        <div className="data-quality-banner verifier-warning" role="status">
          <strong>SYGNAŁ POMOSTOWY — rozważ MODIFY, nie STOP.</strong>
          <span>Przez trzy kolejne dni RHR rosło, a HRV spadało. Reguła jest tymczasowa i podatna na szum; wymaga potwierdzenia samopoczuciem oraz rozgrzewką.</span>
        </div>
      ) : null}
      <p className="method-note"><strong>DAILY METRICS · {daily?.state === 'ready' ? 'GOTOWE' : `KALIBRACJA ${daily?.calibrationDays || '0/28'}`}</strong> · baseline 30 dni wyklucza oceniany dzień; przed kalibracją nie pokazujemy z-score.</p>
    </>
  );
}

function journalEvidenceText(item) {
  const value = formatMetricNumber(item.value, { maximumFractionDigits: item.field === 'weight' ? 2 : 0 });
  const suffix = item.unit?.startsWith('/') ? item.unit : item.unit ? ` ${item.unit}` : '';
  return `${item.label} ${value}${suffix}`;
}

function DecisionJournal({ journal }) {
  if (!journal.entries.length) return null;
  return (
    <section className="section-block">
      <div className="section-heading">
        <div><span className="eyebrow">DZIENNIK DECYZJI</span><h2>Co wiedział sztab</h2></div>
        <span className="section-aside">dowody dostępne w chwili decyzji</span>
      </div>
      <div className="decision-journal-list">
        {journal.entries.map((entry) => (
          <article className="decision-journal-card" key={entry.id}>
            <div className="decision-journal-heading">
              <div><span>{formatDate(entry.timestamp, true)}</span><small>{entry.source || 'źródło niepodane'}</small></div>
              <StatusChip status={entry.status} />
            </div>
            {entry.evidence.length ? (
              <div className="decision-evidence" aria-label="Dowody">
                {entry.evidence.map((item) => <span key={item.field}>{journalEvidenceText(item)}</span>)}
              </div>
            ) : <small className="decision-no-evidence">Brak atomowych dowodów dostępnych przed tą decyzją.</small>}
            <p>{entry.recommendation || 'Status bez zapisanej rekomendacji.'}</p>
          </article>
        ))}
      </div>
      <p className="method-note">DOWODY są ograniczone czasowo: późniejszy pomiar z tego samego dnia nie jest dopisywany wstecz do wcześniejszej decyzji. Tekst rekomendacji pozostaje cytatem ze źródła.</p>
    </section>
  );
}

function executionDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function ExecutionCard({ execution }) {
  const unavailable = {
    'no-target': 'BRAK CELU — Execution wymaga atomowego zakresu HR.',
    'no-data': 'BRAK DANYCH — wykonania intensywności nie można zweryfikować.',
    'data-error': 'DATA ERROR — atomowe czasy Execution są niespójne.',
  };
  if (unavailable[execution.status]) {
    return <article className={`execution-card execution-${execution.status}`}><strong>{unavailable[execution.status]}</strong></article>;
  }

  const verdict = {
    ok: 'OK — wykonanie zgodne z celem',
    over: 'OVER — sesja kosztowniejsza niż plan',
    under: 'UNDER — bodziec poniżej planu',
  }[execution.status];
  const volumeNote = execution.volumePct === null
    ? 'brak atomowego celu dystansu'
    : `${formatMetricNumber(execution.actualKm, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} / max ${formatMetricNumber(execution.distanceTargetMax, { maximumFractionDigits: 2 })} km`;

  return (
    <article className={`execution-card execution-${execution.status}`}>
      <div className="execution-heading">
        <div><span>EXECUTION · CEL HR {execution.targetLo}–{execution.targetHi} BPM</span><strong>{verdict}</strong></div>
        <small>Wyliczone z danych atomowych, nie ze średniego HR.</small>
      </div>
      <div className="execution-grid">
        <p><b>W OKNIE</b><strong>{formatMetricNumber(execution.hrTargetPct, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(execution.timeInTarget)}</small></p>
        <p><b>PONAD CELEM</b><strong>{formatMetricNumber(execution.aboveTargetPct, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(execution.timeAboveTarget)}</small></p>
        <p><b>PONIŻEJ CELU</b><strong>{formatMetricNumber(execution.belowTargetPct, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(execution.timeBelowTarget)}</small></p>
        <p><b>OBJĘTOŚĆ</b><strong>{execution.volumePct === null ? '—' : `${formatMetricNumber(execution.volumePct, { maximumFractionDigits: 1 })}%`}</strong><small>{volumeNote}</small></p>
      </div>
    </article>
  );
}

function staffEvidenceText(item) {
  const formatted = typeof item.value === 'number'
    ? formatMetricNumber(item.value, { maximumFractionDigits: 2 })
    : String(item.value ?? 'brak danych');
  const unit = item.unit ? (item.unit.startsWith('/') ? item.unit : ` ${item.unit}`) : '';
  return `${item.label}: ${formatted}${unit}`;
}

function StaffRoleCard({ member }) {
  const tone = ['GREEN', 'YELLOW', 'RED'].includes(member.status) ? member.status : '';
  return (
    <article className={`staff-role-card staff-${member.status.toLowerCase()}`}>
      <div className="staff-role-heading">
        <div><span>{member.role}</span><small>{member.scope}</small></div>
        <StatusChip status={tone}>{member.status}</StatusChip>
      </div>
      <div className="staff-evidence" aria-label={`Dowody: ${member.role}`}>
        <b>DOWODY</b>
        <div>{member.evidence.map((item, index) => <span key={`${item.label}-${index}`}>{staffEvidenceText(item)}</span>)}</div>
      </div>
      <div className="staff-conclusion">
        <p><b>INTERPRETACJA</b>{member.interpretation}</p>
        <p><b>REKOMENDACJA</b>{member.recommendation}</p>
      </div>
    </article>
  );
}

function StaffPanel({ panel }) {
  return (
    <section className="section-block staff-panel">
      <div className="section-heading">
        <div><span className="eyebrow">PANEL SZTABU · 4 CORE</span><h2>Konsultacja domenowa</h2></div>
        <span className="section-aside">dowody, nie głosowanie</span>
      </div>
      {panel.dispute ? (
        <div className="staff-dispute" role="status">
          <strong>SPÓR SZTABU — kierunki nie są zgodne.</strong>
          <div>{panel.dispute.evidence.map((item) => <span key={item.label}>{staffEvidenceText(item)}</span>)}</div>
          <p>{panel.dispute.interpretation} {panel.dispute.recommendation}</p>
        </div>
      ) : null}
      <div className="staff-grid">
        {panel.core.map((member) => <StaffRoleCard member={member} key={member.id} />)}
      </div>
      {panel.specialists.length ? (
        <div className="staff-conditional">
          <div className="staff-conditional-heading"><span>SPECJALIŚCI WARUNKOWI</span><small>uruchomieni przez dane</small></div>
          <div className="staff-grid">
            {panel.specialists.map((member) => <StaffRoleCard member={member} key={member.id} />)}
          </div>
        </div>
      ) : null}
      <p className="method-note">{panel.methodology}</p>
    </section>
  );
}

function Dashboard({ feed, log, plan, raw, loading, freshnessState, verifierReady, now }) {
  const row = latestRow(feed);
  const weightReading = useMemo(() => resolveWeight(row, raw, now), [row, raw, now]);
  const validation = useMemo(() => validateFeed(row, weightReading?.value || ''), [row, weightReading]);
  const loadComputed = useMemo(() => computeLoad(verifierTrainingRecords(log), now), [log, now]);
  const todayPlan = useMemo(() => getTodayPlan(plan, now), [plan, now]);
  const upcoming = useMemo(() => getUpcomingPlan(plan, 3, now), [plan, now]);
  const matrix = useMemo(() => raceGoalMatrix(), []);
  const verifierEndDate = v(row, 'date', '') || now;
  const daily = useMemo(() => computeDailyMetrics(raw, verifierEndDate), [raw, verifierEndDate]);
  const journal = useMemo(() => buildDecisionJournal(raw, { limit: 4 }), [raw]);
  const computedMetrics = useMemo(() => computeVerifierMetrics(
    verifierTrainingRecords(log), verifierWeightRecords(raw), verifierEndDate,
  ), [log, raw, verifierEndDate]);
  const verifierMismatches = useMemo(() => verifierReady
    ? crossValidate(computedMetrics, verifierFeedMetrics(row))
    : [], [computedMetrics, row, verifierReady]);
  const latestRunRow = useMemo(() => sortedRows(log, 'desc').find(isRunLogRow) || null, [log]);
  const latestRunPlan = useMemo(() => planForLogRow(plan, latestRunRow), [plan, latestRunRow]);
  const execution = useMemo(() => computeExecution(executionInput(latestRunRow, latestRunPlan)), [latestRunRow, latestRunPlan]);

  const decision = useMemo(() => resolveCoachDecision({
    sheetStatus: v(row, 'status', ''),
    sheetDecision: v(row, 'decision', ''),
    fallbackInput: {
      recovery: v(row, 'recovery', ''), sleep: v(row, 'sleep', ''), hrv: v(row, 'hrv', ''), hrv7d: v(row, 'hrv7d', ''),
      pain: v(row, 'pain', ''), doms: v(row, 'doms', ''), fatigue: v(row, 'fatigue', ''), dataOk: validation.ok,
    },
  }), [row, validation.ok]);
  const staffPanel = useMemo(() => buildStaffPanel({
    decision,
    plan: todayPlan ? {
      session: v(todayPlan, 'planMorning', v(todayPlan, 'planSession', '')),
      targetHr: v(todayPlan, 'planHr', ''),
      rpeMax: v(todayPlan, 'planRpe', ''),
    } : null,
    execution,
    daily,
    recovery: {
      pain: v(row, 'pain', ''),
      doms: v(row, 'doms', ''),
      fatigue: v(row, 'fatigue', ''),
      sleep: v(row, 'sleep', ''),
      recovery: v(row, 'recovery', ''),
      bodyBattery: v(row, 'bodyBattery', ''),
    },
    load: loadComputed,
    integrity: {
      validation,
      verifierMismatches,
      dailyIssues: daily.issues,
      freshnessState,
    },
  }), [decision, todayPlan, execution, daily, row, loadComputed, validation, verifierMismatches, freshnessState]);

  const hrvDelta = metricDeltaPercent(v(row, 'hrv', ''), v(row, 'hrv7d', ''));
  const weightDelta = metric(v(row, 'weightDelta7d', ''));
  const srpe7 = metric(v(row, 'srpe7d', '')) ?? loadComputed.srpe7;
  const srpe28 = metric(v(row, 'srpe28d', '')) ?? loadComputed.srpe28;
  const ratio = loadComputed.loadRatio;

  const sourceSignals = [
    v(row, 'pain', '') !== '' ? `ból ${formatMetricNumber(v(row, 'pain'), { maximumFractionDigits: 1 })}/10` : '',
    v(row, 'doms', '') !== '' ? `DOMS ${formatMetricNumber(v(row, 'doms'), { maximumFractionDigits: 1 })}/10` : '',
    v(row, 'fatigue', '') !== '' ? `zmęczenie ${formatMetricNumber(v(row, 'fatigue'), { maximumFractionDigits: 1 })}/10` : '',
    hrvDelta !== null ? `HRV ${hrvDelta >= 0 ? '+' : ''}${formatMetricNumber(hrvDelta, { maximumFractionDigits: 0 })}% vs 7d` : '',
  ].filter(Boolean);

  return (
    <>
      <Hero feedRow={row} now={now} />

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

      <StaffPanel panel={staffPanel} />

      <section className="section-block">
        <TodayPlanCard row={todayPlan} />
      </section>

      <DecisionJournal journal={journal} />

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">DZISIAJ</span><h2>Sygnały organizmu</h2></div></div>
        {!validation.ok ? (
          <div className="data-quality-banner" role="alert">
            <strong>DATA ERROR — decyzję traktuj ostrożnie.</strong>
            {validation.missing.length ? <span>Brak: {validation.missing.join(', ')}</span> : null}
            {validation.suspicious.length ? <span>{validation.suspicious.join(' · ')}</span> : null}
          </div>
        ) : null}
        <VerifierBanner mismatches={verifierMismatches} />
        <DailyMetricsStatus daily={daily} />
        {loading && !feed.length ? <div className="skeleton-grid"><i /><i /></div> : (
          <div className="readiness-grid">
            <MetricRing label="READINESS" value={v(row, 'readiness', '')} note="gotowość Garmin" />
            <MetricRing label="RECOVERY" value={v(row, 'recovery', '')} note="regeneracja" />
            <MetricRing label="BODY BATTERY" value={v(row, 'bodyBattery', '')} note="energia Garmin" />
            <div className="stats-grid compact-stats">
              <StatCard label="SLEEP" value={formatMetricNumber(v(row, 'sleep', ''), { maximumFractionDigits: 0 })} unit="%" note={dailyMetricNote(daily, 'sleepScore', 'jakość / realizacja snu')} />
              <StatCard label="HRV" value={formatMetricNumber(v(row, 'hrv', ''), { maximumFractionDigits: 0 })} unit="ms" note={dailyMetricNote(daily, 'hrv', v(row, 'hrv7d', '') ? `7d: ${formatMetricNumber(v(row, 'hrv7d'), { maximumFractionDigits: 0 })} ms` : 'nocne HRV')} />
              <StatCard label="RHR" value={formatMetricNumber(v(row, 'rhr', ''), { maximumFractionDigits: 0 })} unit="bpm" note={dailyMetricNote(daily, 'rhr', 'tętno spoczynkowe')} />
              <StatCard label="WAGA" value={formatMetricNumber(weightReading?.value, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} unit="kg" note={dailyMetricNote(daily, 'weight', weightReading?.inherited ? `waga z ${formatNumericDate(weightReading.date)}` : v(row, 'weightAvg7d', '') ? `śr. 7d: ${formatMetricNumber(v(row, 'weightAvg7d'), { maximumFractionDigits: 2, minimumFractionDigits: 2 })} kg` : 'ostatni odczyt')} />
              <StatCard label="BÓL" value={formatMetricNumber(v(row, 'pain', ''), { maximumFractionDigits: 1 })} unit="/10" note="subiektywnie" tone={metric(v(row, 'pain', '')) >= 4 ? 'red' : ''} />
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
          <StatCard label="BIEG · 7D" value={formatMetricNumber(v(row, 'runKm7d', ''), { maximumFractionDigits: 2, minimumFractionDigits: 2 })} unit="km" note={`${formatMetricNumber(v(row, 'runCount7d', ''), { maximumFractionDigits: 0, fallback: '—' })} biegów`} />
          <StatCard label="BIEG · 28D" value={formatMetricNumber(v(row, 'runKm28d', ''), { maximumFractionDigits: 2, minimumFractionDigits: 2 })} unit="km" note="kontekst objętości" />
          <StatCard label="sRPE · 7D" value={srpe7 ? formatMetricNumber(srpe7, { maximumFractionDigits: 0 }) : ''} note="wszystkie sesje" />
          <StatCard label="sRPE · 28D" value={srpe28 ? formatMetricNumber(srpe28, { maximumFractionDigits: 0 }) : ''} note="wszystkie sesje" />
          <StatCard label="LOAD RATIO" value={ratio !== null ? formatMetricNumber(ratio, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : ''} note={ratio !== null ? '7d / średnia tygodniowa z dni 8–28' : `kalibracja ${loadComputed.calibrationDays}`} />
          <StatCard label="WAGA · TREND" value={weightDelta !== null ? `${weightDelta >= 0 ? '+' : ''}${formatMetricNumber(weightDelta, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}` : ''} unit={weightDelta !== null ? 'kg' : ''} note="śr. 7d vs poprzednie 7d" />
        </div>
        <p className="method-note">Load ratio jest kontekstem, nie automatycznym limitem bezpieczeństwa. Finalny werdykt sztabu ma pierwszeństwo.</p>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">OSTATNI BIEG</span><h2>Punkt odniesienia</h2></div></div>
        <article className="last-run-card">
          <div><span>DYSTANS</span><strong>{v(row, 'lastRunDistance', '') ? `${formatMetricNumber(v(row, 'lastRunDistance'), { maximumFractionDigits: 2, minimumFractionDigits: 2 })} km` : '—'}</strong></div>
          <div><span>TEMPO</span><strong>{v(row, 'lastRunPace', '—')}</strong></div>
          <div><span>HR</span><strong>{formatMetricNumber(v(row, 'lastRunHrAvg', ''), { maximumFractionDigits: 0, fallback: '—' })} <small>/ {formatMetricNumber(v(row, 'lastRunHrMax', ''), { maximumFractionDigits: 0, fallback: '—' })}</small></strong></div>
          <div><span>RPE</span><strong>{v(row, 'lastRunRpe', '') ? `${formatMetricNumber(v(row, 'lastRunRpe'), { maximumFractionDigits: 1 })}/10` : '—'}</strong></div>
        </article>
        <ExecutionCard execution={execution} />
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
              <tr key={goal.id}><td data-label="Anchor"><b>{goal.id}</b></td><td data-label="Meta">{goal.finish}</td><td data-label="Tempo">{goal.pace}</td><td data-label="5 km">{goal.km5}</td><td data-label="10 km">{goal.km10}</td><td data-label="15 km">{goal.km15}</td></tr>
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
    ['HRmax', formatMetricNumber(v(row, 'hrmax', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['LT1', formatMetricNumber(v(row, 'lt1', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['LT2 / LTHR', formatMetricNumber(v(row, 'lt2', ''), { maximumFractionDigits: 0 }), 'bpm'],
    ['Threshold Power', formatMetricNumber(v(row, 'thresholdPower', ''), { maximumFractionDigits: 0 }), 'W'],
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
  const rawStatus = v(row, 'logStatus', '');
  const status = normalizeActivityStatus(rawStatus);
  const recovery = isRecoveryActivity(type, rawStatus);
  return (
    <article className="log-card">
      <div className="log-card-head">
        <div><span>{formatDate(v(row, 'date', ''))}{v(row, 'logTime', '') ? ` · ${v(row, 'logTime')}` : ''}</span><strong>{name}</strong><small>{type || '—'}</small></div>
        <ActivityBadges status={status} recovery={recovery} />
      </div>
      <div className="log-metrics">
        <p><b>Dystans</b>{distance ? `${formatMetricNumber(distance, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} km` : '—'}</p>
        <p><b>Czas</b>{duration || '—'}</p>
        <p><b>Tempo</b>{v(row, 'logPace', '—')}</p>
        <p><b>HR</b>{hrAvg ? `${formatMetricNumber(hrAvg, { maximumFractionDigits: 0 })}${hrMax ? ` / ${formatMetricNumber(hrMax, { maximumFractionDigits: 0 })}` : ''}` : '—'}</p>
        <p><b>RPE</b>{formatMetricNumber(v(row, 'logRpe', ''), { maximumFractionDigits: 1, fallback: '—' })}</p>
        <p><b>sRPE</b>{formatMetricNumber(v(row, 'logSrpe', ''), { maximumFractionDigits: 0, fallback: '—' })}</p>
        {v(row, 'logLegFatigue', '') !== '' ? <p><b>Nogi</b>{formatMetricNumber(v(row, 'logLegFatigue'), { maximumFractionDigits: 1, fallback: '—' })}/10</p> : null}
      </div>
      {v(row, 'logNotes', '') ? <p className="log-note">{v(row, 'logNotes')}</p> : null}
      {v(row, 'logFeedbackNotes', '') ? <p className="log-note feedback-note"><b>Ocena zawodnika:</b> {v(row, 'logFeedbackNotes')}</p> : null}
    </article>
  );
}

function FeedbackPanel({ target, access, queueCount, onLogin, onSubmit }) {
  const [passcode, setPasscode] = useState('');
  const [values, setValues] = useState({ rpe: '', pain: '', legFatigue: '', notes: '' });
  const [state, setState] = useState({ busy: false, message: '' });

  useEffect(() => {
    setValues({
      rpe: v(target, 'logRpe', ''),
      pain: v(target, 'logPain', ''),
      legFatigue: v(target, 'logLegFatigue', ''),
      notes: v(target, 'logFeedbackNotes', ''),
    });
    setState({ busy: false, message: '' });
  }, [target]);

  if (!access.checked || !access.configured || !target) return null;
  const sessionId = v(target, 'logSessionId', '');
  const sessionLabel = `${formatDate(v(target, 'date', ''))} · ${v(target, 'logName', resolveLogSession(target, A.logType) || 'Sesja')}`;

  const submitLogin = async (event) => {
    event.preventDefault();
    setState({ busy: true, message: '' });
    const result = await onLogin(passcode);
    setState({ busy: false, message: result.ok ? '' : 'Nie udało się odblokować zapisu.' });
    if (result.ok) setPasscode('');
  };

  const submitFeedback = async (event) => {
    event.preventDefault();
    setState({ busy: true, message: '' });
    try {
      const result = await onSubmit({ sessionId, ...values });
      const message = result.synced.length
        ? 'Ocena zapisana i potwierdzona przez Training Log.'
        : result.blocked === 'session-not-ready'
          ? 'Ocena czeka — sesja nie pojawiła się jeszcze w Training Log.'
          : 'Ocena zapisana lokalnie i czeka na synchronizację.';
      setState({ busy: false, message });
    } catch (error) {
      const first = Object.values(error.validation || {})[0];
      setState({ busy: false, message: first || 'Nie udało się przygotować oceny.' });
    }
  };

  return (
    <section className="section-block feedback-section">
      <div className="section-heading">
        <div><span className="eyebrow">PO TRENINGU</span><h2>Oceń bieg</h2></div>
        <span className="section-aside">{queueCount ? `${queueCount} oczekuje` : sessionLabel}</span>
      </div>
      {!access.authenticated ? (
        <form className="feedback-card feedback-login" onSubmit={submitLogin}>
          <div><strong>Odblokuj zapis</strong><p>Passcode tworzy siedmiodniową sesję HttpOnly. Nie jest zapisywany w aplikacji.</p></div>
          <label><span>Passcode</span><input type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" required /></label>
          <button type="submit" disabled={state.busy}>{state.busy ? 'Sprawdzam…' : 'Odblokuj'}</button>
          {state.message ? <p className="feedback-message" role="status">{state.message}</p> : null}
        </form>
      ) : (
        <form className="feedback-card" onSubmit={submitFeedback}>
          <div className="feedback-target"><span>SESJA</span><strong>{sessionLabel}</strong><small>{sessionId}</small></div>
          <div className="feedback-scales">
            {[
              ['rpe', 'RPE', 'Jak ciężki był cały trening?'],
              ['pain', 'Ból', '0 = nic nie boli'],
              ['legFatigue', 'Zmęczenie nóg', '0 = świeże nogi'],
            ].map(([field, label, note]) => (
              <label key={field}>
                <span>{label}</span>
                <input type="number" min="0" max="10" step={field === 'rpe' ? '0.5' : '1'} inputMode="decimal" value={values[field]} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} required />
                <small>{note}</small>
              </label>
            ))}
          </div>
          <label className="feedback-notes"><span>Notatka opcjonalna</span><textarea maxLength="500" rows="3" value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} placeholder="Odczucia, warunki, co zadziałało…" /></label>
          <div className="feedback-actions">
            <small>Najpierw zapis lokalny, potem idempotentna synchronizacja po Session_ID.</small>
            <button type="submit" disabled={state.busy}>{state.busy ? 'Zapisuję…' : 'Zapisz ocenę'}</button>
          </div>
          {state.message ? <p className="feedback-message" role="status">{state.message}</p> : null}
        </form>
      )}
    </section>
  );
}

function TcxImportPanel({ rows, access, onSubmit }) {
  const eligible = useMemo(() => sortedRows(rows, 'desc').filter((row) => (
    isRunLogRow(row)
    && v(row, 'logSessionId', '')
    && parseMetric(v(row, 'logHrTargetMin', '')) !== null
    && parseMetric(v(row, 'logHrTargetMax', '')) !== null
  )).slice(0, 12), [rows]);
  const [sessionId, setSessionId] = useState('');
  const [envelope, setEnvelope] = useState(null);
  const [fileName, setFileName] = useState('');
  const [state, setState] = useState({ busy: false, message: '', tone: '' });

  useEffect(() => {
    if (!eligible.length) {
      setSessionId('');
      setEnvelope(null);
      return;
    }
    if (!eligible.some((row) => v(row, 'logSessionId', '') === sessionId)) {
      setSessionId(v(eligible[0], 'logSessionId', ''));
      setEnvelope(null);
    }
  }, [eligible, sessionId]);

  if (!access.checked || !access.configured || !access.authenticated || !eligible.length) return null;
  const target = eligible.find((row) => v(row, 'logSessionId', '') === sessionId) || eligible[0];
  const preview = envelope ? tcxImportPreview(envelope) : null;

  const chooseSession = (event) => {
    setSessionId(event.target.value);
    setEnvelope(null);
    setFileName('');
    setState({ busy: false, message: '', tone: '' });
  };

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    setEnvelope(null);
    setFileName(file?.name || '');
    setState({ busy: false, message: '', tone: '' });
    if (!file) return;
    if (file.size > MAX_TCX_FILE_BYTES) {
      setState({ busy: false, message: 'Plik TCX przekracza limit 12 MB.', tone: 'error' });
      return;
    }
    setState({ busy: true, message: 'Analizuję TCX lokalnie…', tone: '' });
    try {
      const prepared = await prepareTcxImport(await file.text(), {
        sessionId: v(target, 'logSessionId', ''),
        targetMin: parseMetric(v(target, 'logHrTargetMin', '')),
        targetMax: parseMetric(v(target, 'logHrTargetMax', '')),
      });
      setEnvelope(prepared);
      setState({ busy: false, message: 'Analiza gotowa. Sprawdź podgląd przed zapisem.', tone: 'ok' });
    } catch (error) {
      setState({ busy: false, message: error.message || 'Nie udało się przeanalizować TCX.', tone: 'error' });
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!envelope) return;
    setState({ busy: true, message: 'Zapisuję dane atomowe…', tone: '' });
    const result = await onSubmit(envelope);
    const messages = {
      update: 'Dane atomowe zapisane i potwierdzone przez Training Log.',
      noop: 'Identyczne dane są już zapisane — bez duplikatu i bez zmian.',
      conflict: 'Konflikt z istniejącymi danymi. Nic nie zostało nadpisane.',
      'missing-session': 'Session_ID nie istnieje już w Training Log.',
      'duplicate-session': 'Training Log zawiera zduplikowany Session_ID. Zapis został zablokowany.',
      'contract-error': 'Kontrakt Training Log nie pozwala na bezpieczny zapis.',
    };
    setState({
      busy: false,
      message: messages[result.action] || (result.status === 0 ? 'Brak sieci — wybierz plik ponownie po odzyskaniu połączenia.' : 'Import nie został zapisany.'),
      tone: result.ok ? 'ok' : 'error',
    });
  };

  return (
    <section className="section-block feedback-section tcx-import-section">
      <div className="section-heading">
        <div><span className="eyebrow">EXECUTION · TCX</span><h2>Importuj bieg</h2></div>
        <span className="section-aside">lokalna analiza · prywatny zapis</span>
      </div>
      <form className="feedback-card tcx-import-card" onSubmit={submit}>
        <div className="tcx-import-fields">
          <label>
            <span>Sesja</span>
            <select value={sessionId} onChange={chooseSession}>
              {eligible.map((row) => {
                const id = v(row, 'logSessionId', '');
                return <option value={id} key={id}>{formatDate(v(row, 'date', ''))} · {v(row, 'logName', 'Bieg')} · HR {v(row, 'logHrTargetMin', '')}–{v(row, 'logHrTargetMax', '')}</option>;
              })}
            </select>
          </label>
          <label>
            <span>Plik TCX</span>
            <input key={sessionId} type="file" accept=".tcx,application/xml,text/xml" onChange={chooseFile} />
            <small>{fileName || 'Maksymalnie 12 MB. Surowy plik nie trafia do arkusza.'}</small>
          </label>
        </div>
        {preview ? (
          <div className="tcx-preview" aria-label="Podgląd analizy TCX">
            <p><b>CEL HR</b><strong>{preview.targetMin}–{preview.targetMax}</strong><small>bpm</small></p>
            <p><b>ANALIZA</b><strong>{executionDuration(preview.analyzedDuration)}</strong><small>{preview.diagnostics.trackpointCount || 0} próbek</small></p>
            <p><b>W OKNIE</b><strong>{formatMetricNumber(preview.pctInTarget, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(preview.timeInTarget)}</small></p>
            <p><b>PONAD</b><strong>{formatMetricNumber(preview.pctAboveTarget, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(preview.timeAboveTarget)}</small></p>
            <p><b>PONIŻEJ</b><strong>{formatMetricNumber(preview.pctBelowTarget, { maximumFractionDigits: 2 })}%</strong><small>{executionDuration(preview.timeBelowTarget)}</small></p>
            <p><b>LUKI &gt; 5 S</b><strong>{preview.diagnostics.excludedGaps || 0}</strong><small>{executionDuration(preview.diagnostics.excludedDuration || 0)} wykluczone</small></p>
          </div>
        ) : null}
        <div className="feedback-actions">
          <small>Granice są domknięte. Czas przypisujemy wcześniejszej próbce; luk powyżej 5 s nie analizujemy.</small>
          <button type="submit" disabled={state.busy || !envelope}>{state.busy ? 'Pracuję…' : 'Zapisz dane TCX'}</button>
        </div>
        {state.message ? <p className={`feedback-message ${state.tone ? `feedback-${state.tone}` : ''}`} role="status">{state.message}</p> : null}
      </form>
    </section>
  );
}

function Log({ rows, loading, feedbackAccess, feedbackQueueCount, onFeedbackLogin, onFeedbackSubmit, onTcxImport }) {
  const sorted = useMemo(() => sortedRows(rows, 'desc').slice(0, 30), [rows]);
  const feedbackTarget = useMemo(() => sorted.find((row) => isRunLogRow(row) && v(row, 'logSessionId', '')) || null, [sorted]);
  return (
    <>
      <section className="section-hero"><span className="eyebrow">HISTORIA</span><h1>Training Log</h1><p>Ostatnie 30 wpisów. Bieg, siła, recovery i później boks są liczone jako realne obciążenie systemu.</p></section>
      <FeedbackPanel target={feedbackTarget} access={feedbackAccess} queueCount={feedbackQueueCount} onLogin={onFeedbackLogin} onSubmit={onFeedbackSubmit} />
      <TcxImportPanel rows={sorted} access={feedbackAccess} onSubmit={onTcxImport} />
      <section className="section-block log-list">
        {loading && !rows.length ? <div className="skeleton-grid"><i /><i /></div> : sorted.length ? sorted.map((row, i) => <LogCard row={row} key={`${v(row, 'date', '')}-${i}`} />) : <p className="muted-copy">Brak wpisów w Training Log.</p>}
      </section>
    </>
  );
}

function PlanMini({ row }) {
  const date = rowDate(row);
  const status = v(row, 'planStatus', 'PLANNED');
  const session = v(row, 'planMorning', v(row, 'planSession', 'Sesja'));
  return (
    <article className="plan-mini">
      <div><b>{date ? formatDate(date) : '—'}</b><small>{v(row, 'planDay', '')}</small></div>
      <div><strong>{session}</strong><p>{v(row, 'planHr', '') || v(row, 'planNotes', 'Brak dodatkowych uwag')}</p></div>
      <ActivityBadges status={status} recovery={isRecoveryActivity(session, status)} />
    </article>
  );
}

function PlanCard({ row, now }) {
  const date = rowDate(row);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const isToday = date && sameCalendarDay(date, today);
  const status = v(row, 'planStatus', 'PLANNED');
  const session = v(row, 'planMorning', v(row, 'planSession', 'Sesja'));
  return (
    <article className={`plan-card ${isToday ? 'plan-today' : ''}`}>
      <div className="plan-date-box"><strong>{date ? formatDate(date) : v(row, 'date', '—')}</strong><small>{v(row, 'planDay', '')}</small></div>
      <div className="plan-card-main">
        <div className="plan-card-title"><strong>{session}</strong><ActivityBadges status={status} recovery={isRecoveryActivity(session, status)} /></div>
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

function Plan({ rows, loading, now }) {
  const dated = useMemo(() => sortedRows(rows.filter((r) => rowDate(r)), 'asc'), [rows]);
  const undated = useMemo(() => rows.filter((r) => !rowDate(r)), [rows]);
  return (
    <>
      <section className="section-hero"><span className="eyebrow">DROGA DO CELU</span><h1>Plan</h1><p>Mikrocykl jest adaptacyjny. Status Head Coacha i regeneracja mogą zmienić wykonanie jednostki bez zmiany celu całego bloku.</p></section>
      <section className="section-block plan-list">
        {loading && !rows.length ? <div className="skeleton-grid"><i /><i /></div> : dated.map((row, i) => <PlanCard row={row} now={now} key={`${v(row, 'date', '')}-${i}`} />)}
      </section>
      {undated.length ? <section className="section-block"><div className="section-heading"><div><span className="eyebrow">DALEJ</span><h2>Do ustalenia</h2></div></div><div className="plan-list">{undated.map((row, i) => <PlanCard row={row} now={now} key={`u-${i}`} />)}</div></section> : null}
    </>
  );
}

function AccessGate({ access, onLogin, onRetry }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await onLogin(passcode);
    if (!result.ok) {
      setMessage(result.status === 401
        ? 'Nieprawidłowy passcode.'
        : result.status === 0 ? 'Brak połączenia z serwerem.' : 'Nie udało się rozpocząć sesji.');
    } else {
      setPasscode('');
    }
    setBusy(false);
  };

  const checking = !access.checked;
  const unavailable = access.checked && access.configured === null;
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <span className="brand-mark">C</span>
        <div><span className="eyebrow">CARLOS · MÁLAGA 2027</span><h1>{checking ? 'Sprawdzam dostęp' : unavailable ? 'Nie można sprawdzić sesji' : 'Prywatny dostęp'}</h1></div>
        {checking ? <p>Łączę aplikację z bezpiecznym endpointem danych.</p> : unavailable ? (
          <>
            <p>Nie przełączam się awaryjnie na publiczny odczyt, dopóki stan prywatnego endpointu jest nieznany.</p>
            <button type="button" onClick={onRetry}>Spróbuj ponownie</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>Passcode tworzy siedmiodniową sesję HttpOnly. Nie trafia do bundla ani pamięci aplikacji.</p>
            <label><span>PASSCODE</span><input type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" required /></label>
            <button type="submit" disabled={busy}>{busy ? 'Otwieram…' : 'Otwórz dashboard'}</button>
            {message ? <small role="status">{message}</small> : null}
          </form>
        )}
        <footer>{APP_VERSION}</footer>
      </section>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [networkSyncedAt, setNetworkSyncedAt] = useState(null);
  const [errors, setErrors] = useState({});
  const [fromCache, setFromCache] = useState(false);
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  const [feedbackAccess, setFeedbackAccess] = useState({ checked: false, configured: null, authenticated: false, error: '' });
  const [feedbackQueueCount, setFeedbackQueueCount] = useState(0);
  const dataRef = useRef(data);
  const accessRef = useRef(feedbackAccess);
  const inFlight = useRef(null);
  const lastAttempt = useRef(0);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { accessRef.current = feedbackAccess; }, [feedbackAccess]);

  const commitAccess = useCallback((next) => {
    accessRef.current = next;
    setFeedbackAccess(next);
  }, []);

  const restoreSnapshot = useCallback((mode) => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      const snapshot = parseApplicationSnapshot(raw, mode);
      if (snapshot) {
        setData(snapshot.data);
        dataRef.current = snapshot.data;
        setNetworkSyncedAt(snapshot.at || null);
        setFromCache(true);
        return true;
      }
    } catch { /* ignore corrupted local snapshot */ }
    return false;
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    const access = accessRef.current;
    if (!access.checked || access.configured === null || (access.configured && !access.authenticated)) {
      setLoading(false);
      return;
    }
    if (!force && Date.now() - lastAttempt.current < MIN_REFRESH_MS) return;
    lastAttempt.current = Date.now();
    if (inFlight.current) inFlight.current.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setLoading(true);

    const merged = { ...dataRef.current };
    const nextErrors = {};
    let anyOk = false;
    if (access.configured) {
      try {
        Object.assign(merged, await fetchPrivateApplicationData(controller.signal));
        anyOk = true;
      } catch (error) {
        nextErrors.private = error?.name === 'AbortError'
          ? 'Prywatny endpoint: timeout'
          : error?.status === 401 || error?.status === 403
            ? 'Sesja wygasła — zaloguj się ponownie.'
            : error?.message || 'Prywatny endpoint: błąd';
        if (error?.status === 401 || error?.status === 403) {
          commitAccess({ ...accessRef.current, checked: true, configured: true, authenticated: false, error: 'session-expired' });
        }
      }
    } else {
      const entries = Object.entries(SHEETS);
      const results = await Promise.allSettled(entries.map(([key, sheet]) => fetchSheet(sheet, controller.signal, SHEET_QUERIES[key] || '')));
      results.forEach((result, index) => {
        const [key, sheet] = entries[index];
        if (result.status === 'fulfilled') { merged[key] = result.value; anyOk = true; }
        else nextErrors[key] = result.reason?.name === 'AbortError' ? `${sheet}: timeout` : result.reason?.message || `${sheet}: błąd`;
      });
    }
    clearTimeout(timer);
    if (inFlight.current !== controller) return;
    inFlight.current = null;

    const now = Date.now();
    setData(merged);
    setErrors(nextErrors);
    setCheckedAt(now);
    if (anyOk) {
      setNetworkSyncedAt(now);
      setFromCache(false);
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
          data: merged, at: now, mode: access.configured ? 'private' : 'public',
        }));
      } catch { /* optional */ }
    }
    setLoading(false);
  }, [commitAccess]);

  const checkFeedbackAccess = useCallback(async () => {
    const result = await feedbackSessionStatus();
    const reachable = result.ok && result.status === 200;
    commitAccess(reachable ? {
      checked: true, configured: Boolean(result.configured), authenticated: Boolean(result.authenticated), error: '',
    } : {
      checked: true, configured: null, authenticated: false, error: result.error || 'session-unavailable',
    });
    return result;
  }, [commitAccess]);

  const syncFeedback = useCallback(async () => {
    const result = await flushTrainingFeedbackQueue(localStorage, sendTrainingFeedback);
    setFeedbackQueueCount(result.remaining.length);
    if (result.blocked === 'auth') {
      commitAccess({ ...accessRef.current, authenticated: false, error: 'session-expired' });
    }
    if (result.synced.length) refresh({ force: true });
    return result;
  }, [commitAccess, refresh]);

  const loginFeedback = useCallback(async (passcode) => {
    const result = await feedbackLogin(passcode);
    if (result.ok && result.authenticated) {
      commitAccess({ checked: true, configured: true, authenticated: true, error: '' });
      restoreSnapshot('private');
      const syncResult = await syncFeedback();
      if (!syncResult.synced.length) await refresh({ force: true });
    }
    return result;
  }, [commitAccess, refresh, restoreSnapshot, syncFeedback]);

  const logout = useCallback(async () => {
    await feedbackLogout();
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* optional */ }
    if (inFlight.current) inFlight.current.abort();
    dataRef.current = EMPTY_DATA;
    setData(EMPTY_DATA);
    setErrors({});
    setCheckedAt(null);
    setNetworkSyncedAt(null);
    setFromCache(false);
    setLoading(false);
    commitAccess({ checked: true, configured: true, authenticated: false, error: '' });
  }, [commitAccess]);

  const submitFeedback = useCallback(async (input) => {
    const feedback = createTrainingFeedback(input);
    const queue = enqueueTrainingFeedback(localStorage, feedback);
    setFeedbackQueueCount(queue.length);
    return syncFeedback();
  }, [syncFeedback]);

  const submitTcxImport = useCallback(async (envelope) => {
    const result = await sendTcxImport(envelope);
    if (result.status === 401 || result.status === 403) {
      commitAccess({ ...accessRef.current, authenticated: false, error: 'session-expired' });
      return result;
    }
    if (result.ok) await refresh({ force: true });
    return result;
  }, [commitAccess, refresh]);

  useEffect(() => {
    setFeedbackQueueCount(readFeedbackQueue(localStorage).length);
    let active = true;
    checkFeedbackAccess().then((result) => {
      if (!active) return;
      if (!(result.ok && result.status === 200)) {
        setLoading(false);
        return;
      }
      if (!result.configured) {
        restoreSnapshot('public');
        refresh({ force: true });
      } else if (result.authenticated) {
        restoreSnapshot('private');
        refresh({ force: true });
        syncFeedback();
      } else {
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [checkFeedbackAccess, refresh, restoreSnapshot, syncFeedback]);

  useEffect(() => {
    const onFeedbackOnline = () => {
      checkFeedbackAccess().then((result) => {
        if (!(result.ok && result.status === 200)) return;
        if (result.authenticated) syncFeedback();
        refresh({ force: true });
      });
    };
    window.addEventListener('online', onFeedbackOnline);
    return () => window.removeEventListener('online', onFeedbackOnline);
  }, [checkFeedbackAccess, refresh, syncFeedback]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setCalendarNow(new Date());
      refresh();
    };
    const onFocus = () => { setCalendarNow(new Date()); refresh(); };
    const onPageShow = () => { setCalendarNow(new Date()); refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let midnightTimer;
    const scheduleNextMidnight = () => {
      const delay = millisecondsUntilNextLocalMidnight(new Date());
      if (delay === null) return;
      midnightTimer = window.setTimeout(() => {
        if (!active) return;
        setCalendarNow(new Date());
        refresh({ force: true });
        scheduleNextMidnight();
      }, delay);
    };
    scheduleNextMidnight();
    return () => {
      active = false;
      window.clearTimeout(midnightTimer);
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

  const retryAccess = async () => {
    commitAccess({ checked: false, configured: null, authenticated: false, error: '' });
    setLoading(true);
    const result = await checkFeedbackAccess();
    if (!(result.ok && result.status === 200)) {
      setLoading(false);
      return;
    }
    if (!result.configured) {
      restoreSnapshot('public');
      refresh({ force: true });
    } else if (result.authenticated) {
      restoreSnapshot('private');
      refresh({ force: true });
    } else {
      setLoading(false);
    }
  };

  if (!feedbackAccess.checked || feedbackAccess.configured === null
    || (feedbackAccess.configured && !feedbackAccess.authenticated)) {
    return <AccessGate access={feedbackAccess} onLogin={loginFeedback} onRetry={retryAccess} />;
  }

  const feedRow = latestRow(data.feed);
  const sourceAt = sourceTime(feedRow);
  const freshness = sourceFreshness(sourceAt, calendarNow, STALE_AFTER_HOURS);
  const errorCount = Object.keys(errors).length;
  const offline = Boolean(errors.private) || errorCount === Object.keys(SHEETS).length;
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
        <div className="topbar-actions">
          {feedbackAccess.configured ? <button className="logout-button" onClick={logout} aria-label="Wyloguj" title="Wyloguj">⇥</button> : null}
          <button className="refresh-button" onClick={() => refresh({ force: true })} disabled={loading} aria-label="Odśwież dane">
            <span className={loading ? 'spin' : ''}>↻</span><b>{loading ? 'Sync' : 'Odśwież'}</b>
          </button>
        </div>
      </header>

      <div className={`sync-strip sync-${status}`} aria-live="polite">
        <span className="live-dot" />
        <strong>{statusLabel}</strong>
        <span>Dane z: {sourceAt ? formatDate(sourceAt, true) : '—'} · Sprawdzono: {checkedAt ? formatDate(new Date(checkedAt), true) : '—'}</span>
      </div>

      {errorCount ? <div className="error-banner" role="status"><strong>{offline ? 'Brak połączenia ze źródłem.' : 'Nie wszystkie arkusze zostały odświeżone.'}</strong><span>{Object.values(errors).join(' · ')}</span>{fromCache ? <span>Pokazuję ostatnią lokalną kopię.</span> : null}</div> : null}

      <main>
        {tab === 'dashboard' && <Dashboard feed={data.feed} log={data.log} plan={data.plan} raw={data.raw || []} loading={loading} freshnessState={freshness.state} verifierReady={!loading && !errorCount} now={calendarNow} />}
        {tab === 'zones' && <Zones feed={data.feed} loading={loading} />}
        {tab === 'log' && <Log rows={data.log} loading={loading} feedbackAccess={feedbackAccess} feedbackQueueCount={feedbackQueueCount} onFeedbackLogin={loginFeedback} onFeedbackSubmit={submitFeedback} onTcxImport={submitTcxImport} />}
        {tab === 'plan' && <Plan rows={data.plan} loading={loading} now={calendarNow} />}
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
