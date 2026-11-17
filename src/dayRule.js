import { exactValue, parseNumber } from './parse.js';
import { A } from './schema.js';

const SYMPTOMS = [
  ['dizziness', 'Zawroty głowy', 'rawSymptomDizziness'],
  ['palpitations', 'Kołatanie serca', 'rawSymptomPalpitations'],
  ['chestPain', 'Ból w klatce piersiowej', 'rawSymptomChestPain'],
  ['illness', 'Choroba / objawy infekcji', 'rawSymptomIllness'],
];

function metric(row, field, min, max) {
  const value = parseNumber(exactValue(row, A[field] || [], ''));
  return value !== null && value >= min && value <= max ? value : null;
}

function truthy(value) {
  return ['YES', 'TRUE', 'TAK', '1'].includes(String(value || '').trim().toUpperCase());
}

function rowDate(row) {
  const value = exactValue(row, A.date, '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
}

function dayValue(row) {
  const hrv = metric(row, 'rawOrthostaticHrv', 1, 250);
  const lying = metric(row, 'rawHrLying', 25, 250);
  const standing = metric(row, 'rawHrStanding', 25, 250);
  const wellbeing = exactValue(row, A.rawWellbeing, '').trim().toUpperCase();
  return {
    hrv,
    lying,
    standing,
    delta: lying === null || standing === null ? null : standing - lying,
    sleep: metric(row, 'rawSleepMinutes', 60, 1080),
    wellbeing: ['GOOD', 'NORMAL', 'BAD'].includes(wellbeing) ? wellbeing : '',
    symptomsKnown: SYMPTOMS.every(([, , field]) => /^(YES|NO|TRUE|FALSE|TAK|NIE|1|0)$/i.test(exactValue(row, A[field], '').trim())),
    symptoms: Object.fromEntries(SYMPTOMS.map(([key, _label, field]) => [key, truthy(exactValue(row, A[field] || [], ''))])),
  };
}

function completeOrthostatic(value) {
  return value.hrv !== null && value.lying !== null && value.standing !== null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function previousCalendarDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

function formatted(value, fractionDigits = 1) {
  if (value === null || !Number.isFinite(value)) return 'brak danych';
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: fractionDigits }).format(value);
}

export function computeDayRule(rows = [], date) {
  const byDate = new Map();
  for (const row of rows) {
    const currentDate = rowDate(row);
    if (currentDate) byDate.set(currentDate, row);
  }
  const currentRow = byDate.get(date);
  const checkinFields = ['rawCheckinSavedAt', 'rawOrthostaticHrv', 'rawHrLying', 'rawHrStanding', 'rawWellbeing', ...SYMPTOMS.map(([, , field]) => field)];
  if (!currentRow || !checkinFields.some(field => exactValue(currentRow, A[field], '').trim())) return {
    status: 'missing', label: 'BRAK POMIARU', date, signals: [], reasons: [], baseline: null,
    symptoms: [], missing: [], calibrationDays: 0, calibrationTarget: 7, current: null, triggeredCount: null,
    sleepStreak: false, recommendation: 'Brak danych do oceny dnia.',
  };

  const current = dayValue(currentRow);
  const symptoms = SYMPTOMS.filter(([key]) => current.symptoms[key]).map(([, label]) => label);
  const prior = [...byDate.entries()]
    .filter(([rowDay]) => rowDay < date)
    .map(([rowDay, row]) => ({ date: rowDay, ...dayValue(row) }))
    .filter(completeOrthostatic)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
  const baseline = prior.length >= 7 ? {
    days: prior.length,
    hrv: mean(prior.map(({ hrv }) => hrv)),
    lying: mean(prior.map(({ lying }) => lying)),
    delta: mean(prior.map(({ delta }) => delta)),
  } : null;

  let calibrationDays = prior.length;
  if (completeOrthostatic(current)) calibrationDays += 1;
  const sleepStreak = [date, previousCalendarDate(date), previousCalendarDate(previousCalendarDate(date))]
    .every((day) => {
      const row = byDate.get(day);
      return row && dayValue(row).sleep !== null && dayValue(row).sleep < 420;
    });

  const signals = [];
  if (baseline) {
    const hrvKnown = current.hrv !== null;
    const lyingKnown = current.lying !== null;
    if (hrvKnown || lyingKnown) {
      const hrvLow = hrvKnown && current.hrv < baseline.hrv * 0.9;
      const lyingHigh = lyingKnown && current.lying > baseline.lying + 5;
      signals.push({
        id: 1,
        triggered: Boolean(hrvLow || lyingHigh),
        label: 'HRV / tętno leżąc',
        detail: `HRV ${formatted(current.hrv)} ms vs norma ${formatted(baseline.hrv)} ms; tętno leżąc ${formatted(current.lying, 0)} vs norma ${formatted(baseline.lying, 0)} bpm. Próg: HRV < 90% normy lub tętno > norma + 5.`,
      });
    }
    if (current.delta !== null) {
      signals.push({
        id: 2,
        triggered: current.delta > baseline.delta + 10,
        label: 'Różnica stojąc–leżąc',
        detail: `${formatted(current.delta, 0)} bpm vs norma ${formatted(baseline.delta, 0)} bpm; próg > norma + 10.`,
      });
    }
  }
  if (current.sleep !== null || current.wellbeing) {
    const triggered = (current.sleep !== null && current.sleep < 420) || current.wellbeing === 'BAD';
    signals.push({
      id: 3,
      triggered,
      label: 'Sen / samopoczucie',
      detail: `Sen ${current.sleep === null ? 'brak danych' : `${formatted(current.sleep / 60, 2)} h`} (próg < 7 h); samopoczucie ${current.wellbeing || 'brak danych'} (sygnał przy „słabo”).`,
    });
  }

  const missing = [];
  if (current.hrv === null) missing.push('HRV rMSSD');
  if (current.lying === null) missing.push('tętno leżąc');
  if (current.standing === null) missing.push('tętno stojąc');
  if (current.sleep === null) missing.push('sen');
  if (!current.wellbeing) missing.push('samopoczucie');
  if (!current.symptomsKnown) missing.push('potwierdzenie objawów');
  const triggeredCount = signals.filter(({ triggered }) => triggered).length;
  const reasons = signals.filter(({ triggered }) => triggered).map(({ label }) => label);

  let status;
  if (symptoms.length) status = 'red';
  else if (!baseline) status = 'calibration';
  else if (triggeredCount >= 3) status = 'red';
  else if (triggeredCount >= 2) status = 'yellow';
  else if (missing.length) status = 'incomplete';
  else status = 'green';

  return {
    status,
    label: {
      red: 'CZERWONY', yellow: 'ŻÓŁTY', green: 'ZIELONY',
      calibration: 'KALIBRACJA', incomplete: 'DANE NIEPEŁNE',
    }[status],
    date,
    current,
    triggeredCount,
    baseline: baseline ? { ...baseline, days: prior.length } : null,
    calibrationDays: Math.min(7, calibrationDays),
    calibrationTarget: 7,
    signals,
    reasons,
    symptoms,
    missing,
    sleepStreak,
    recommendation: status === 'green' ? 'Trening według planu Runny.'
      : status === 'yellow' ? 'Około 30% mniej pracy; bez maksymalnych wysiłków.'
        : status === 'red' ? (symptoms.length ? 'Zgłoszono objaw. Wstrzymaj trening i oceń potrzebę konsultacji.' : 'Odpoczynek albo bardzo spokojny ruch.')
          : status === 'incomplete' ? 'Brak wystarczających danych do bezpiecznej klasyfikacji.'
            : 'Zbieramy pomiary. Do zakończenia kalibracji system nie nadaje koloru dnia.',
  };
}
