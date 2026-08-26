import { normalize, parseMetric } from './parse.js';

export const COACH_ACTION = Object.freeze({
  TRAIN: 'TRAIN',
  CONTROL: 'CONTROL',
  RECOVERY: 'RECOVERY',
  NO_TRAIN: 'NO_TRAIN',
  NO_DECISION: 'NO_DECISION',
});

const COACH_ACTION_LABELS = Object.freeze({
  [COACH_ACTION.TRAIN]: 'TRENUJ ZGODNIE Z PLANEM',
  [COACH_ACTION.CONTROL]: 'TRENING KONTROLOWANY',
  [COACH_ACTION.RECOVERY]: 'ODPOCZYNEK I REGENERACJA',
  [COACH_ACTION.NO_TRAIN]: 'NIE TRENUJ',
  [COACH_ACTION.NO_DECISION]: 'BRAK PEWNEJ DECYZJI',
});

export function coachActionLabel(action) {
  return COACH_ACTION_LABELS[action] || COACH_ACTION_LABELS[COACH_ACTION.NO_DECISION];
}

function hasRecoveryIntent(...values) {
  const text = normalize(values.filter(Boolean).join(' '));
  return /(^|\s)(?:off|recovery|odpoczynek|regeneracja|odpuszczony|odpusc)(?:\s|$)/.test(text);
}

export function resolveCoachAction({ status, dataOk = true, plannedSession = '', plannedStatus = '', recommendation = '' } = {}) {
  if (!dataOk) return COACH_ACTION.NO_DECISION;
  if (status === 'GREEN') return COACH_ACTION.TRAIN;
  if (status === 'RED') return COACH_ACTION.NO_TRAIN;
  if (status === 'YELLOW') {
    return hasRecoveryIntent(plannedSession, plannedStatus, recommendation)
      ? COACH_ACTION.RECOVERY
      : COACH_ACTION.CONTROL;
  }
  return COACH_ACTION.NO_DECISION;
}

export const MALAGA_RACE = {
  date: '2027-03-07',
  distanceKm: 21.0975,
  anchors: [
    { id: 'A', seconds: 1 * 3600 + 45 * 60 },
    { id: 'B', seconds: 1 * 3600 + 50 * 60 },
    { id: 'C', seconds: 2 * 3600 },
  ],
};

function n(value) {
  return parseMetric(value);
}

export function normalizeCoachStatus(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  return ['GREEN', 'YELLOW', 'RED'].includes(raw) ? raw : '';
}

export function metricDeltaPercent(current, baseline) {
  const a = n(current);
  const b = n(baseline);
  if (a === null || b === null || b === 0) return null;
  return ((a - b) / b) * 100;
}

export function classifyCoachStatus({
  recovery,
  sleep,
  hrv,
  hrv7d,
  pain,
  doms,
  fatigue,
  dataOk = true,
  plannedSession = '',
  plannedStatus = '',
}) {
  if (!dataOk) {
    return {
      status: 'RED',
      action: COACH_ACTION.NO_DECISION,
      title: 'Najpierw popraw dane',
      recommendation: 'Nie zwiększaj obciążenia na podstawie niepełnego lub niespójnego odczytu.',
      reasons: ['brak lub anomalia danych krytycznych'],
      source: 'fallback',
    };
  }

  const recoveryN = n(recovery);
  const sleepN = n(sleep);
  const painN = n(pain);
  const domsN = n(doms);
  const fatigueN = n(fatigue);
  const hrvDelta = metricDeltaPercent(hrv, hrv7d);
  const red = [];
  const yellow = [];

  if (painN !== null && painN >= 4) red.push(`ból ${painN}/10`);
  else if (painN !== null && painN > 0) yellow.push(`ból ${painN}/10`);

  if (domsN !== null && domsN >= 8) red.push(`DOMS ${domsN}/10`);
  else if (domsN !== null && domsN >= 5) yellow.push(`DOMS ${domsN}/10`);

  if (fatigueN !== null && fatigueN >= 8) red.push(`zmęczenie ${fatigueN}/10`);
  else if (fatigueN !== null && fatigueN >= 5) yellow.push(`zmęczenie ${fatigueN}/10`);

  if (recoveryN !== null && recoveryN < 35) red.push(`Recovery ${Math.round(recoveryN)}%`);
  else if (recoveryN !== null && recoveryN < 65) yellow.push(`Recovery ${Math.round(recoveryN)}%`);

  if (sleepN !== null && sleepN < 55) red.push(`Sleep ${Math.round(sleepN)}%`);
  else if (sleepN !== null && sleepN < 75) yellow.push(`Sleep ${Math.round(sleepN)}%`);

  if (hrvDelta !== null && hrvDelta <= -20) red.push(`HRV ${Math.round(hrvDelta)}% vs 7d`);
  else if (hrvDelta !== null && hrvDelta <= -10) yellow.push(`HRV ${Math.round(hrvDelta)}% vs 7d`);

  if (red.length) {
    return {
      status: 'RED',
      action: COACH_ACTION.NO_TRAIN,
      title: 'Regeneracja ma pierwszeństwo',
      recommendation: 'Odpoczynek albo bardzo lekka aktywność. Bez jakościowego biegu i bez dokładania intensywności.',
      reasons: red,
      source: 'fallback',
    };
  }

  if (yellow.length) {
    const recommendation = 'Trzymaj intensywność nisko i nie dokładaj pracy ponad plan. Akcent tylko po potwierdzeniu świeżości.';
    return {
      status: 'YELLOW',
      action: resolveCoachAction({ status: 'YELLOW', plannedSession, plannedStatus, recommendation }),
      title: 'Trening tylko kontrolowany',
      recommendation,
      reasons: yellow,
      source: 'fallback',
    };
  }

  return {
    status: 'GREEN',
    action: COACH_ACTION.TRAIN,
    title: 'Plan może iść zgodnie z założeniem',
    recommendation: 'Realizuj zaplanowaną jednostkę w docelowym HR/RPE, bez dokładania pracy ponad plan.',
    reasons: ['brak czerwonych lub żółtych sygnałów w dostępnych danych'],
    source: 'fallback',
  };
}

export function resolveCoachDecision({ sheetStatus, sheetDecision, plannedSession = '', plannedStatus = '', fallbackInput }) {
  const status = normalizeCoachStatus(sheetStatus);
  const decision = String(sheetDecision ?? '').trim();
  if (status) {
    const titles = {
      GREEN: 'Plan może iść',
      YELLOW: 'Kontroluj obciążenie',
      RED: 'Regeneracja ma pierwszeństwo',
    };
    const recommendation = decision || (status === 'GREEN'
      ? 'Realizuj zaplanowaną jednostkę bez dokładania pracy ponad plan.'
      : status === 'YELLOW'
        ? 'Zachowaj rezerwę i wykonuj tylko pracę kontrolowaną.'
        : 'Priorytetem jest regeneracja; bez dokładania intensywności.');
    return {
      status,
      action: resolveCoachAction({ status, plannedSession, plannedStatus, recommendation }),
      title: titles[status],
      recommendation,
      reasons: [],
      source: 'head-coach',
    };
  }
  return classifyCoachStatus({ ...fallbackInput, plannedSession, plannedStatus });
}

export function integrateCoachDecision({
  decision,
  integrity = {},
  recovery = {},
  daily = null,
  execution = null,
  load = null,
  patterns = {},
} = {}) {
  const base = decision || {
    status: 'RED',
    action: COACH_ACTION.NO_DECISION,
    title: 'Brak decyzji źródłowej',
    recommendation: 'Najpierw odśwież dane.',
    reasons: [],
    source: 'engine',
  };
  const evidence = [];
  const limitations = [];
  const dataProblems = [];

  if (integrity.validationOk === false) dataProblems.push('brak lub anomalia danych wymaganych');
  if (integrity.freshnessState === 'stale') dataProblems.push('dane starsze niż 36 godzin');
  if ((integrity.verifierMismatches || []).some(({ severity }) => severity === 'error')) dataProblems.push('niezgodność źródeł w Verifierze');
  if ((integrity.dailyIssues || []).some(({ severity }) => severity === 'error')) dataProblems.push('błąd integralności Raw_Data');
  if (execution?.status === 'data-error') dataProblems.push('błąd danych Execution');

  if (dataProblems.length) {
    return {
      ...base,
      status: 'RED',
      action: COACH_ACTION.NO_DECISION,
      title: 'Najpierw popraw dane',
      recommendation: 'Nie wydawaj pewnej decyzji treningowej, dopóki wskazane dane nie będą poprawne i świeże.',
      reasons: dataProblems,
      evidence: dataProblems.map((reason) => `DANE: ${reason}`),
      limitations: dataProblems,
      confidence: 'NONE',
      engineAdjustments: ['integrity-gate'],
    };
  }

  evidence.push(`DANE: ${integrity.freshnessState === 'fresh' ? 'świeże, bez błędu blokującego' : 'bez błędu blokującego'}`);
  const pain = n(recovery.pain);
  const doms = n(recovery.doms);
  const fatigue = n(recovery.fatigue);
  const redSignals = [];
  if (pain !== null && pain >= 4) redSignals.push(`ból ${pain}/10`);
  if (doms !== null && doms >= 8) redSignals.push(`DOMS ${doms}/10`);
  if (fatigue !== null && fatigue >= 8) redSignals.push(`zmęczenie ${fatigue}/10`);

  if (redSignals.length) {
    return {
      ...base,
      status: 'RED',
      action: COACH_ACTION.NO_TRAIN,
      title: 'Regeneracja ma pierwszeństwo',
      recommendation: 'Nie trenuj. Nowy, narastający albo nietypowy objaw wymaga oceny poza aplikacją.',
      reasons: redSignals,
      evidence: [...evidence, ...redSignals.map((reason) => `SYGNAŁ CZERWONY: ${reason}`)],
      limitations,
      confidence: 'SUPPORTED',
      engineAdjustments: ['red-recovery-gate'],
    };
  }

  if (pain === null || doms === null || fatigue === null) limitations.push('brak pełnej deklaracji bólu, DOMS lub zmęczenia');
  if (daily?.state !== 'ready') limitations.push(`Daily Metrics: ${daily?.state || 'brak danych'}`);
  if (execution?.status) evidence.push(`OSTATNIA SESJA: ${execution.status}`);
  if (load?.loadRatio === null || load?.loadRatio === undefined) limitations.push(`Load ratio: ${load?.calibrationDays || 'kalibracja'}`);
  else evidence.push(`LOAD RATIO: ${Number(load.loadRatio).toFixed(2)}`);

  const easyPattern = patterns.easyExecution;
  if (easyPattern?.state === 'calibrating') {
    evidence.push(`WZORZEC EASY: KALIBRACJA ${easyPattern.sample}`);
    limitations.push(`wzorzec easy: ${easyPattern.sample}`);
  } else if (easyPattern?.state === 'active') {
    evidence.push(`WZORZEC EASY: ${easyPattern.sample} sesji ponad ${easyPattern.thresholdPct}% czasu powyżej celu`);
  } else if (easyPattern?.state === 'clear') {
    evidence.push(`WZORZEC EASY: brak serii przekroczeń w ostatnich ${easyPattern.required} sesjach`);
  }

  if (daily?.bridgeSignal?.active) evidence.push('TREND 3 DNI: RHR rośnie, HRV spada');

  if (easyPattern?.active && easyPattern.appliesToday && base.action === COACH_ACTION.TRAIN) {
    return {
      ...base,
      status: 'YELLOW',
      action: COACH_ACTION.CONTROL,
      title: 'Easy tylko z kontrolą intensywności',
      recommendation: 'Ustaw alarm górnej granicy HR. Jeżeli przekroczenia wrócą, zacznij od 10 minut marszobiegu i nie zwiększaj planu.',
      reasons: [...(base.reasons || []), `trzy kolejne easy ponad ${easyPattern.thresholdPct}% czasu powyżej celu`],
      evidence,
      limitations,
      confidence: 'SUPPORTED',
      engineAdjustments: ['repeated-easy-over-target'],
    };
  }

  if (daily?.bridgeSignal?.active) {
    if (base.action === COACH_ACTION.TRAIN) {
      return {
        ...base,
        status: 'YELLOW',
        action: COACH_ACTION.CONTROL,
        title: 'Trening tylko kontrolowany',
        recommendation: 'Sygnał pomostowy wymaga kontroli po 10–15 minutach rozgrzewki; nie zwiększaj planu.',
        reasons: [...(base.reasons || []), 'trzydniowy trend RHR w górę i HRV w dół'],
        evidence,
        limitations,
        confidence: 'LIMITED',
        engineAdjustments: ['pre-calibration-bridge'],
      };
    }
  }

  return {
    ...base,
    evidence,
    limitations,
    confidence: limitations.length ? 'LIMITED' : 'SUPPORTED',
    engineAdjustments: [],
  };
}

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function summarizeLoad(records, now = new Date()) {
  const today = startOfDay(now);
  if (!today) return { sum7: 0, sum28: 0, sessions7: 0, sessions28: 0, ratio: null, enoughForRatio: false };
  const day = 86400000;
  const valid = records
    .map((r) => ({ date: startOfDay(r.date), srpe: n(r.srpe) }))
    .filter((r) => r.date && r.srpe !== null && r.srpe >= 0 && r.date <= today);

  const inWindow = (r, days) => (today - r.date) / day < days;
  const rows7 = valid.filter((r) => inWindow(r, 7));
  const rows28 = valid.filter((r) => inWindow(r, 28));
  const sum = (rows) => rows.reduce((acc, r) => acc + r.srpe, 0);
  const sum7 = sum(rows7);
  const sum28 = sum(rows28);
  const spanDays = rows28.length > 1
    ? Math.round((Math.max(...rows28.map((r) => r.date.getTime())) - Math.min(...rows28.map((r) => r.date.getTime()))) / day)
    : 0;
  const enoughForRatio = rows28.length >= 6 && spanDays >= 14 && sum28 > 0;
  const weekly28 = sum28 / 4;
  const ratio = enoughForRatio && weekly28 > 0 ? sum7 / weekly28 : null;
  return { sum7, sum28, sessions7: rows7.length, sessions28: rows28.length, ratio, enoughForRatio };
}

export function sourceFreshness(sourceDate, now = new Date(), staleHours = 36) {
  const src = sourceDate instanceof Date ? sourceDate : new Date(sourceDate);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(src.getTime()) || Number.isNaN(current.getTime())) return { state: 'unknown', ageHours: null };
  const ageHours = (current - src) / 3600000;
  if (ageHours < -0.25) return { state: 'future', ageHours };
  if (ageHours > staleHours) return { state: 'stale', ageHours };
  return { state: 'fresh', ageHours };
}

export function daysUntilRace(now = new Date(), raceDate = MALAGA_RACE.date) {
  const current = startOfDay(now);
  const target = startOfDay(`${raceDate}T12:00:00`);
  if (!current || !target) return null;
  const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  return Math.max(0, calendarDay(target) - calendarDay(current));
}

export function millisecondsUntilNextLocalMidnight(now = new Date()) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(current.getTime())) return null;
  const next = new Date(current);
  next.setHours(24, 0, 0, 0);
  return next - current;
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(secondsPerKm) {
  const total = Math.round(secondsPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

export function raceGoalMatrix() {
  return MALAGA_RACE.anchors.map((goal) => {
    const pace = goal.seconds / MALAGA_RACE.distanceKm;
    const split = (km) => formatDuration(goal.seconds * km / MALAGA_RACE.distanceKm);
    return {
      id: goal.id,
      finish: formatDuration(goal.seconds),
      pace: formatPace(pace),
      km5: split(5),
      km10: split(10),
      km15: split(15),
    };
  });
}
