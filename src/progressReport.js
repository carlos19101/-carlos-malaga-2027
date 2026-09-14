import { normalize, parseDate, parseNumber } from './parse.js';

export const HALF_MARATHON_KM = 21.0975;
export const RACE_GOALS = [
  { id: '1h30', label: '1:30', seconds: 90 * 60 },
  { id: '1h35', label: '1:35', seconds: 95 * 60 },
  { id: '1h40', label: '1:40', seconds: 100 * 60 },
  { id: '1h45', label: '1:45', seconds: 105 * 60 },
];

function localDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  return date && !Number.isNaN(date.getTime())
    ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
    : null;
}

function clock(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function pace(seconds, km) {
  return `${Math.floor(seconds / km / 60)}:${String(Math.round(seconds / km) % 60).padStart(2, '0')}/km`;
}

function sum(items, key) {
  return items.reduce((total, item) => total + (item[key] ?? 0), 0);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weekKey(day) {
  const weekday = new Date(day * 86400000).getUTCDay() || 7;
  return new Date((day - weekday + 1) * 86400000).toISOString().slice(0, 10);
}

function isRaceOrTest(session) {
  return /(?:test|sprawdzian|zawod|race|parkrun|time trial)/i.test(`${session.name} ${session.type}`);
}

function normalizedSessions(input) {
  return (Array.isArray(input) ? input : []).map((session, index) => {
    const day = localDay(session.date);
    const km = parseNumber(session.distanceKm);
    const minutes = parseNumber(session.durationMinutes);
    const rpe = parseNumber(session.rpe);
    const pain = parseNumber(session.pain);
    const legs = parseNumber(session.legFatigue);
    return {
      ...session, index, day, km, minutes, rpe, pain, legs,
      hrAvg: parseNumber(session.hrAvg),
      name: String(session.name ?? ''), type: String(session.type ?? ''),
      isEasy: /(?:^|\s)(?:easy|spokoj|recovery|regener)/i.test(normalize(`${session.name} ${session.type}`)),
    };
  }).filter(({ day, km }) => day !== null && km !== null && km > 0)
    .sort((left, right) => left.day - right.day || left.index - right.index);
}

function weeklyHistory(sessions) {
  const weeks = new Map();
  sessions.forEach(({ day, km }) => {
    const key = weekKey(day);
    const current = weeks.get(key) || { week: key, km: 0, sessions: 0 };
    current.km += km;
    current.sessions += 1;
    weeks.set(key, current);
  });
  const values = [...weeks.values()].sort((left, right) => left.week.localeCompare(right.week));
  return { values, maximumKm: values.length ? Math.max(...values.map(({ km }) => km)) : 0 };
}

function easyTrend(sessions) {
  const easy = sessions.filter(({ isEasy, minutes, km, hrAvg }) => isEasy && minutes !== null && km > 0 && hrAvg !== null);
  const referenceKm = median(easy.slice(-3).map(({ km }) => km));
  const comparable = referenceKm === null ? [] : easy.filter(({ km }) => Math.abs(km - referenceKm) / referenceKm <= 0.2);
  if (comparable.length < 6) return { state: 'missing', sample: `${comparable.length}/6`, first: null, recent: null, paceDeltaSeconds: null, hrDelta: null, referenceKm };
  const firstSample = comparable.slice(0, 3);
  const recentSample = comparable.slice(-3);
  const summarize = (sample) => ({
    paceSeconds: median(sample.map(({ minutes, km }) => minutes * 60 / km)),
    hr: median(sample.map(({ hrAvg }) => hrAvg)),
  });
  const first = summarize(firstSample);
  const recent = summarize(recentSample);
  const paceDeltaSeconds = Math.round(recent.paceSeconds - first.paceSeconds);
  const hrDelta = Math.round((recent.hr - first.hr) * 10) / 10;
  const similarHr = Math.abs(hrDelta) <= 3;
  const state = similarHr && paceDeltaSeconds <= -5 ? 'potential-improvement'
    : similarHr && paceDeltaSeconds >= 5 ? 'potential-regression' : 'mixed';
  return { state, sample: '3/3', first, recent, paceDeltaSeconds, hrDelta, referenceKm };
}

function windows(sessions) {
  const endDay = sessions.at(-1)?.day ?? null;
  if (endDay === null) return { recent: [], previous: [], endDay: null };
  return {
    endDay,
    recent: sessions.filter(({ day }) => day >= endDay - 13),
    previous: sessions.filter(({ day }) => day >= endDay - 27 && day < endDay - 13),
  };
}

function raceEstimate(sessions) {
  const candidates = sessions.filter((session) => isRaceOrTest(session) && session.km >= 5 && session.minutes !== null && session.minutes > 0);
  const source = candidates.at(-1) || null;
  if (!source) return { state: 'missing', predictedSeconds: null, source: null };
  const predictedSeconds = Math.round(source.minutes * 60 * ((HALF_MARATHON_KM / source.km) ** 1.06));
  return {
    state: 'provisional',
    predictedSeconds,
    source: { date: source.date, km: source.km, durationMinutes: source.minutes, name: source.name || source.type || 'test' },
  };
}

function priorities({ sessions, recent, previous, execution, estimate }) {
  const items = [];
  const recentKm = sum(recent, 'km');
  const previousKm = sum(previous, 'km');
  const feedbackComplete = recent.filter(({ rpe, pain, legs }) => rpe !== null && pain !== null && legs !== null).length;
  const atomic = execution.filter(({ status }) => ['ok', 'over', 'under'].includes(status));
  const easyOver = execution.filter(({ isEasy, aboveTargetPct }) => isEasy && parseNumber(aboveTargetPct) > 40);
  const elevatedPain = recent.some(({ pain }) => pain !== null && pain >= 3);

  if (sessions.length < 6 || (sessions.at(-1).day - sessions[0].day) < 21) {
    items.push({ state: 'CALIBRACJA', title: 'Najpierw regularność i materiał porównawczy', detail: `${sessions.length} biegów w historii; raport nie ocenia jeszcze formy pod 1:30.` });
  }
  if (estimate.state === 'missing') items.push({ state: 'TEST', title: 'Brak podstaw do automatycznej prognozy', detail: 'Cel 1:30 nie jest zablokowany. Prognoza pojawi się dopiero po oznaczonym teście lub starcie na dystansie co najmniej 5 km.' });
  if (atomic.length < Math.min(3, sessions.length)) {
    items.push({ state: 'DANE', title: 'Domknij wykonanie sesji', detail: `${atomic.length}/${sessions.length} biegów ma atomowe dane HR. TCX po sesji z celem HR daje podstawę do oceny intensywności.` });
  }
  if (easyOver.length >= 3) {
    items.push({ state: 'INTENSYWNOŚĆ', title: 'Dopilnuj easy', detail: `${easyOver.length} sesje easy miały ponad 40% czasu HR powyżej celu. To sygnał wykonania, nie diagnoza formy.` });
  }
  if (recent.length >= 2 && previous.length >= 2 && previousKm > 0) {
    const deltaPct = ((recentKm / previousKm) - 1) * 100;
    items.push(deltaPct < -15
      ? { state: 'RYTM', title: 'Odbuduj ciągłość biegania', detail: `Ostatnie 14 dni: ${recentKm.toFixed(1).replace('.', ',')} km; poprzednie: ${previousKm.toFixed(1).replace('.', ',')} km (${deltaPct.toFixed(0)}%). Nie wyciągaj wniosku o spadku formy z samego tempa.` }
      : { state: 'OBJĘTOŚĆ', title: 'Utrzymaj spokojną progresję objętości', detail: `Ostatnie 14 dni: ${recentKm.toFixed(1).replace('.', ',')} km; poprzednie: ${previousKm.toFixed(1).replace('.', ',')} km (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%).` });
  }
  if (elevatedPain) items.push({ state: 'REAKCJA', title: 'Sprawdź odpowiedź organizmu', detail: 'W ostatnich 14 dniach odnotowano ból ≥3/10; nie zwiększaj bodźca wyłącznie na podstawie celu czasowego.' });
  if (feedbackComplete < recent.length) items.push({ state: 'DANE', title: 'Domknij odczucia po treningu', detail: `${feedbackComplete}/${recent.length} ostatnich biegów ma komplet RPE, bólu i zmęczenia nóg.` });
  return items.slice(0, 3);
}

export function buildProgressReport(input = {}) {
  const sessions = normalizedSessions(input.sessions);
  const { recent, previous } = windows(sessions);
  const execution = (Array.isArray(input.execution) ? input.execution : []).map((item) => ({
    ...item,
    aboveTargetPct: parseNumber(item.aboveTargetPct),
  }));
  const estimate = raceEstimate(sessions);
  const target = RACE_GOALS.find(({ id }) => id === input.goalId) || RACE_GOALS[0];
  const recentKm = sum(recent, 'km');
  const previousKm = sum(previous, 'km');
  const historyDays = sessions.length > 1 ? sessions.at(-1).day - sessions[0].day + 1 : sessions.length;
  const weekly = weeklyHistory(sessions);
  return {
    target: { ...target, pace: pace(target.seconds, HALF_MARATHON_KM) },
    goalOptions: RACE_GOALS.map((goal) => ({ ...goal, pace: pace(goal.seconds, HALF_MARATHON_KM) })),
    history: {
      state: sessions.length ? (historyDays >= 28 && sessions.length >= 8 ? 'ready' : 'calibrating') : 'missing',
      sessions: sessions.length,
      km: sum(sessions, 'km'),
      longestKm: sessions.length ? Math.max(...sessions.map(({ km }) => km)) : null,
      historyDays,
      recentSessions: recent.length,
      recentKm,
      previousSessions: previous.length,
      previousKm,
      volumeDeltaPct: previous.length >= 2 && previousKm > 0 ? Number((((recentKm / previousKm) - 1) * 100).toFixed(1)) : null,
    },
    estimate,
    weekly,
    easyTrend: easyTrend(sessions),
    priorities: priorities({ sessions, recent, previous, execution, estimate }),
  };
}

