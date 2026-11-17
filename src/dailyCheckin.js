const CHECKIN_FIELDS = {
  hrvOrthostatic: 'HRV_orthostatic_rMSSD_ms',
  hrLying: 'HR_lying_bpm',
  hrStanding: 'HR_standing_bpm',
  wellbeing: 'Wellbeing',
  dizziness: 'Symptom_Dizziness',
  palpitations: 'Symptom_Palpitations',
  chestPain: 'Symptom_Chest_Pain',
  illness: 'Symptom_Illness',
  savedAt: 'Checkin_Saved_At',
  source: 'Checkin_Source',
};

const OPTIONAL_FIELDS = {
  sleepMinutes: 'Sleep_min',
  weightKg: 'Weight_kg',
  hrvNight: 'HRV_night_ms',
};

const FEELINGS = new Set(['GOOD', 'NORMAL', 'BAD']);
const SYMPTOMS = ['dizziness', 'palpitations', 'chestPain', 'illness'];

function numberOrNull(value, min, max, field, errors) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors[field] = `Wartość musi mieścić się w zakresie ${min}–${max}.`;
    return null;
  }
  return parsed;
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function warsawDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function validateDailyCheckin(input = {}, options = {}) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { input: 'Nieprawidłowy format check-inu.' }, value: null };
  }

  const date = String(input.date || '').trim();
  const hrvOrthostatic = numberOrNull(input.hrvOrthostatic, 1, 250, 'hrvOrthostatic', errors);
  const hrLying = numberOrNull(input.hrLying, 25, 250, 'hrLying', errors);
  const hrStanding = numberOrNull(input.hrStanding, 25, 250, 'hrStanding', errors);
  const sleepHours = numberOrNull(input.sleepHours, 1, 18, 'sleepHours', errors);
  const weightKg = numberOrNull(input.weightKg, 20, 300, 'weightKg', errors);
  const hrvNight = numberOrNull(input.hrvNight, 1, 250, 'hrvNight', errors);
  const wellbeing = String(input.wellbeing || '').trim().toUpperCase();

  if (!validCalendarDate(date)) errors.date = 'Nieprawidłowa data.';
  if (validCalendarDate(date) && date > warsawDate(options.now || new Date())) errors.date = 'Nie można zapisać check-inu z przyszłości.';
  if (!FEELINGS.has(wellbeing)) errors.wellbeing = 'Wybierz samopoczucie: dobrze, normalnie lub słabo.';
  if (input.symptomsConfirmed !== true) errors.symptoms = 'Potwierdź, czy występują objawy.';
  if (!input.symptoms || typeof input.symptoms !== 'object' || SYMPTOMS.some((key) => typeof input.symptoms[key] !== 'boolean')) {
    errors.symptoms = 'Zapisz odpowiedź dla każdego z czterech objawów.';
  }
  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: {
      date, hrvOrthostatic, hrLying, hrStanding,
      sleepMinutes: sleepHours === null ? null : Math.round(sleepHours * 60),
      weightKg, hrvNight, wellbeing,
      symptoms: Object.fromEntries(SYMPTOMS.map((key) => [key, input.symptoms[key]])),
    },
  };
}

export function planDailyCheckinUpsert(headers = [], rows = [], value, options = {}) {
  const headerIndex = new Map(headers.map((header, index) => [String(header || '').trim(), index]));
  const requiredHeaders = ['Date', ...Object.values(CHECKIN_FIELDS)];
  const missingHeaders = requiredHeaders.filter((header) => !headerIndex.has(header));
  for (const header of Object.values(OPTIONAL_FIELDS)) {
    if (!headerIndex.has(header)) missingHeaders.push(header);
  }
  if (missingHeaders.length) return { action: 'contract-error', missingHeaders };

  const dateIndex = headerIndex.get('Date');
  let target = null;
  for (const row of rows) {
    const rowDate = String(row.values?.[dateIndex] ?? '').trim().slice(0, 10);
    if (rowDate === value.date) target = row;
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const sourceValues = {
    hrvOrthostatic: value.hrvOrthostatic,
    hrLying: value.hrLying,
    hrStanding: value.hrStanding,
    wellbeing: value.wellbeing,
    dizziness: value.symptoms.dizziness ? 'YES' : 'NO',
    palpitations: value.symptoms.palpitations ? 'YES' : 'NO',
    chestPain: value.symptoms.chestPain ? 'YES' : 'NO',
    illness: value.symptoms.illness ? 'YES' : 'NO',
    savedAt: now.toISOString(),
    source: 'MANUAL_MORNING_CHECKIN',
  };
  const updates = [];
  for (const [field, header] of Object.entries(CHECKIN_FIELDS)) {
    const item = sourceValues[field];
    if (item !== null && item !== undefined) updates.push({ header, value: item });
  }
  for (const [field, header] of Object.entries(OPTIONAL_FIELDS)) {
    const item = value[field];
    if (item !== null && item !== undefined) updates.push({ header, value: item });
  }

  if (target) {
    return {
      action: 'update', date: value.date, rowNumber: target.rowNumber,
      updates: updates.map((item) => ({ ...item, columnIndex: headerIndex.get(item.header) })),
    };
  }

  const newRow = Array(headers.length).fill('');
  newRow[dateIndex] = value.date;
  for (const item of updates) newRow[headerIndex.get(item.header)] = item.value;
  return { action: 'append', date: value.date, row: newRow, updates };
}
