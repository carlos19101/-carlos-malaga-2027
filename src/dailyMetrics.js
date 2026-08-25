import { exactValue, isNullish, normalize, parseDate, parseNumber } from './parse.js';

export const RAW_DAILY_FIELDS = {
  date: ['date'],
  timestamp: ['timestamp'],
  source: ['source'],
  weight: ['weight kg'],
  rhr: ['rhr bpm'],
  hrv: ['hrv night ms'],
  sleepMinutes: ['sleep min'],
  sleepScore: ['sleep score'],
};

export const DAILY_METRIC_DEFS = {
  hrv: { label: 'HRV', min: 10, max: 250, conflictDelta: 5 },
  rhr: { label: 'RHR', min: 30, max: 120, conflictDelta: 3 },
  sleepMinutes: { label: 'Sen', min: 0, max: 1440, conflictDelta: 30 },
  sleepScore: { label: 'Sleep Score', min: 0, max: 100, conflictDelta: 5 },
  weight: { label: 'Waga', min: 50, max: 160, conflictDelta: 0.2 },
};

function localDayNumber(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function dayKey(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}

function parseRawTimestamp(value) {
  const date = parseDate(value);
  if (!date) return null;
  const seconds = String(value ?? '').match(/[ T]\d{1,2}:\d{2}:(\d{2})(?:[.,]\d+)?(?:\s|$)/)?.[1];
  if (seconds !== undefined) date.setSeconds(Number(seconds), 0);
  return date;
}

function sourcePriority(field, sourceValue) {
  const source = normalize(sourceValue);
  if (field === 'weight' && source.includes('user')) return 5;
  if (source.includes('agent garmin')) return 4;
  if (source.includes('garmin')) return 3;
  if (source.includes('user')) return 2;
  if (source.includes('head coach')) return 1;
  return 0;
}

function issue(id, severity, date, detail, evidence = []) {
  return { id, severity, date, detail, evidence };
}

function selectCandidate(field, candidates, date, issues) {
  if (!candidates.length) return { value: null, selection: null };
  const sorted = [...candidates].sort((a, b) => b.timeMs - a.timeMs || b.priority - a.priority);
  const first = sorted[0];
  const top = sorted.filter((candidate) => (
    candidate.timeMs === first.timeMs && candidate.priority === first.priority
  ));
  const topValues = [...new Set(top.map(({ value }) => value))];
  if (topValues.length > 1) {
    issues.push(issue(
      `ambiguous-${field}`,
      'error',
      date,
      `${DAILY_METRIC_DEFS[field].label}: sprzeczne wartości z tym samym czasem i priorytetem źródła.`,
      top.map(({ value, timestamp, source }) => ({ value, timestamp, source })),
    ));
    return { value: null, selection: null };
  }

  const distinct = [...new Set(sorted.map(({ value }) => value))];
  if (distinct.length > 1) {
    const spread = Math.max(...distinct) - Math.min(...distinct);
    const isSignificant = spread > DAILY_METRIC_DEFS[field].conflictDelta;
    issues.push(issue(
      `updated-${field}`,
      'info',
      date,
      `${DAILY_METRIC_DEFS[field].label}: kilka odczytów; wybrano najnowszy${isSignificant ? ` (rozpiętość ${spread})` : ''}.`,
      sorted.map(({ value, timestamp, source }) => ({ value, timestamp, source })),
    ));
  }

  return {
    value: first.value,
    selection: {
      timestamp: first.timestamp,
      source: first.source,
      candidateCount: sorted.length,
      rule: 'latest-timestamp/source-priority-on-tie',
    },
  };
}

export function normalizeRawData(rows = []) {
  const days = new Map();
  const issues = [];
  let undatedSkipped = 0;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawDate = exactValue(row, RAW_DAILY_FIELDS.date, '');
    const date = parseDate(rawDate);
    const dayNumber = localDayNumber(date);
    if (dayNumber === null) {
      undatedSkipped += 1;
      issues.push(issue('undated-row', 'error', null, 'Raw_Data: wiersz bez czytelnej daty.'));
      return;
    }

    const dateString = dayKey(dayNumber);
    const rawTimestamp = exactValue(row, RAW_DAILY_FIELDS.timestamp, '');
    const parsedTimestamp = parseRawTimestamp(rawTimestamp);
    if (rawTimestamp && !parsedTimestamp) {
      issues.push(issue('invalid-timestamp', 'warning', dateString, `Nieczytelny Timestamp: ${rawTimestamp}`));
    }
    if (parsedTimestamp && localDayNumber(parsedTimestamp) !== dayNumber) {
      issues.push(issue('timestamp-date-mismatch', 'warning', dateString, `Date ${dateString} nie zgadza się z Timestamp ${rawTimestamp}.`));
    }
    const timestamp = parsedTimestamp || date;
    const source = exactValue(row, RAW_DAILY_FIELDS.source, '');
    if (!days.has(dayNumber)) {
      days.set(dayNumber, {
        date: dateString,
        dayNumber,
        rawRowCount: 0,
        candidates: Object.fromEntries(Object.keys(DAILY_METRIC_DEFS).map((field) => [field, []])),
      });
    }
    const day = days.get(dayNumber);
    day.rawRowCount += 1;

    Object.entries(DAILY_METRIC_DEFS).forEach(([field, definition]) => {
      const raw = exactValue(row, RAW_DAILY_FIELDS[field], '');
      if (isNullish(raw)) return;
      const value = parseNumber(raw);
      if (value === null || value < definition.min || value > definition.max) {
        issues.push(issue(
          `invalid-${field}`,
          'error',
          dateString,
          `${definition.label}: wartość ${raw} poza kontraktem ${definition.min}–${definition.max}.`,
        ));
        return;
      }
      day.candidates[field].push({
        value,
        timeMs: timestamp.getTime(),
        timestamp: rawTimestamp || dateString,
        source,
        priority: sourcePriority(field, source),
      });
    });
  });

  const normalizedDays = [...days.values()].sort((a, b) => a.dayNumber - b.dayNumber).map((day) => {
    const values = {};
    const selections = {};
    Object.keys(DAILY_METRIC_DEFS).forEach((field) => {
      const selected = selectCandidate(field, day.candidates[field], day.date, issues);
      values[field] = selected.value;
      selections[field] = selected.selection;
    });
    return {
      date: day.date,
      dayNumber: day.dayNumber,
      rawRowCount: day.rawRowCount,
      values,
      selections,
    };
  });

  return { days: normalizedDays, issues, undatedSkipped };
}

export function baseline(series = [], endDate = new Date(), days = 30, options = {}) {
  const endDay = localDayNumber(endDate);
  const minSamples = options.minSamples ?? 14;
  const minHistoryDays = options.minHistoryDays ?? 28;
  if (endDay === null || days <= 0) {
    return {
      mean: null, sd: null, n: 0, ready: false, historyDays: 0,
      calibrationDays: `0/${minHistoryDays}`, coverage: 0, sampleCoverage: 0, from: null, to: null,
    };
  }

  const valid = (Array.isArray(series) ? series : []).map((point) => ({
    dayNumber: localDayNumber(point.date),
    value: parseNumber(point.value),
  })).filter(({ dayNumber, value }) => dayNumber !== null && dayNumber < endDay && value !== null)
    .sort((a, b) => a.dayNumber - b.dayNumber);
  const oldestDay = valid[0]?.dayNumber ?? null;
  const historyDays = oldestDay === null ? 0 : Math.max(0, endDay - oldestDay);
  const window = valid.filter(({ dayNumber }) => dayNumber >= endDay - days);
  const values = window.map(({ value }) => value);
  const n = values.length;
  const mean = n ? values.reduce((sum, value) => sum + value, 0) / n : null;
  const variance = n > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0;
  const sd = n ? Math.sqrt(variance) : null;
  const ready = historyDays >= minHistoryDays && n >= minSamples;
  const availableDays = Math.min(historyDays, minHistoryDays);
  const sampledSpan = Math.min(historyDays, days);

  return {
    mean,
    sd,
    n,
    ready,
    historyDays,
    calibrationDays: `${availableDays}/${minHistoryDays}`,
    coverage: availableDays / minHistoryDays,
    sampleCoverage: sampledSpan > 0 ? Math.min(1, n / sampledSpan) : 0,
    from: dayKey(endDay - days),
    to: dayKey(endDay - 1),
  };
}

export function zScore(value, base) {
  const numericValue = parseNumber(value);
  if (numericValue === null || !base?.ready || !Number.isFinite(base.sd) || base.sd === 0) return null;
  return (numericValue - base.mean) / base.sd;
}

function dataGapIssues(days, evaluationDay) {
  const historical = days.filter(({ dayNumber }) => dayNumber < evaluationDay);
  if (!historical.length) return [];
  const present = new Set(historical.map(({ dayNumber }) => dayNumber));
  const oldest = historical[0].dayNumber;
  const issues = [];
  let gapStart = null;

  for (let day = oldest; day < evaluationDay; day += 1) {
    if (!present.has(day) && gapStart === null) gapStart = day;
    const closesGap = present.has(day) && gapStart !== null;
    const reachesEnd = day === evaluationDay - 1 && gapStart !== null && !present.has(day);
    if (closesGap || reachesEnd) {
      const gapEnd = closesGap ? day - 1 : day;
      const length = gapEnd - gapStart + 1;
      if (length >= 2) {
        issues.push(issue(
          'data-gap',
          'warning',
          dayKey(gapStart),
          `Raw_Data: ${length} kolejne dni bez żadnego wpisu (${dayKey(gapStart)}–${dayKey(gapEnd)}).`,
        ));
      }
      gapStart = null;
    }
  }
  return issues;
}

export function computeDailyMetrics(rows = [], evaluationDate = new Date()) {
  const evaluationDay = localDayNumber(evaluationDate);
  const normalized = normalizeRawData(rows);
  if (evaluationDay === null) {
    return {
      state: 'calibrating', calibrationDays: '0/28', historyDays: 0,
      current: null, metrics: {}, days: normalized.days, issues: normalized.issues,
    };
  }

  const usableDays = normalized.days.filter(({ dayNumber }) => dayNumber <= evaluationDay);
  const historicalDays = usableDays.filter(({ dayNumber }) => dayNumber < evaluationDay);
  const oldestDay = historicalDays[0]?.dayNumber ?? null;
  const historyDays = oldestDay === null ? 0 : evaluationDay - oldestDay;
  const current = usableDays.find(({ dayNumber }) => dayNumber === evaluationDay) || null;
  const metrics = Object.fromEntries(Object.keys(DAILY_METRIC_DEFS).map((field) => {
    const series = usableDays
      .filter(({ values }) => values[field] !== null)
      .map((day) => ({ date: day.date, value: day.values[field] }));
    const metricBaseline = baseline(series, evaluationDate, 30, { minSamples: 14, minHistoryDays: 28 });
    const currentValue = current?.values[field] ?? null;
    return [field, {
      current: currentValue,
      baseline: metricBaseline,
      zScore: zScore(currentValue, metricBaseline),
    }];
  }));
  const issues = [...normalized.issues, ...dataGapIssues(usableDays, evaluationDay)];
  const allReady = Object.values(metrics).every((metric) => metric.baseline.ready);

  return {
    state: historyDays < 28 ? 'calibrating' : allReady ? 'ready' : 'partial',
    calibrationDays: `${Math.min(historyDays, 28)}/28`,
    historyDays,
    current,
    metrics,
    days: usableDays,
    issues,
    undatedSkipped: normalized.undatedSkipped,
    methodology: {
      selection: 'latest valid timestamp; source priority only on exact timestamp tie',
      baselineWindowDays: 30,
      minimumHistoryDays: 28,
      minimumSamples: 14,
      evaluatedDayExcluded: true,
      standardDeviation: 'sample',
    },
  };
}
