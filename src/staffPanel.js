import { parseNumber } from './parse.js';

const DIRECTION_BY_STATUS = {
  GREEN: 'GO',
  YELLOW: 'MODIFY',
  RED: 'STOP',
};

const DIRECTION_LABEL = {
  GO: 'TRENUJ ZGODNIE Z PLANEM',
  MODIFY: 'KONTROLUJ OBCIĄŻENIE',
  STOP: 'NIE TRENUJ',
};

function evidence(label, value, unit = '') {
  return { label, value: value ?? null, unit };
}

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function numeric(value) {
  return parseNumber(value);
}

function runningCoach({ plan, execution }) {
  const session = plan?.session || '';
  const planEvidence = [
    evidence('Plan', session || 'brak sesji z dzisiejszą datą'),
    evidence('Cel HR', plan?.targetHr || 'brak danych'),
    evidence('RPE max', plan?.rpeMax || 'brak danych'),
  ];

  if (!session) {
    return {
      id: 'running', role: 'TRENER BIEGOWY', scope: 'plan i wykonanie', status: 'INFO', direction: null,
      evidence: planEvidence,
      interpretation: 'Plan nie zawiera sesji z dzisiejszą datą. To nie jest automatycznie dzień wolny ani błąd danych.',
      recommendation: 'Nie twórz nowej jednostki w aplikacji; obowiązuje jawny werdykt Głównego Trenera i następny wpis w Planie.',
    };
  }

  const executionStatus = execution?.status || 'no-data';
  const executionEvidence = executionStatus === 'no-target' || executionStatus === 'no-data'
    ? evidence('Ostatnie Execution', 'brak danych atomowych')
    : executionStatus === 'data-error'
      ? evidence('Ostatnie Execution', 'DATA ERROR')
      : evidence('Ostatnie Execution', executionStatus.toUpperCase());
  const over = executionStatus === 'over';

  return {
    id: 'running', role: 'TRENER BIEGOWY', scope: 'plan i wykonanie', status: over ? 'YELLOW' : 'INFO', direction: null,
    evidence: [...planEvidence, executionEvidence],
    interpretation: over
      ? 'Ostatni bieg był kosztowniejszy niż plan. To kontekst wykonania, nie samodzielna zmiana dzisiejszej jednostki.'
      : executionStatus === 'ok'
        ? 'Ostatni bieg spełnił zakodowane reguły intensywności i objętości.'
        : 'Brak podstaw do liczbowej oceny ostatniego wykonania.',
    recommendation: over
      ? 'Wykonaj dzisiejszy plan bez dokładania intensywności; przy easy użyj kontroli górnej granicy HR.'
      : 'Realizuj tylko jednostkę zapisaną w Planie i zgodną z werdyktem Głównego Trenera.',
  };
}

function physiologist({ daily }) {
  const hrv = daily?.metrics?.hrv?.current ?? daily?.current?.values?.hrv ?? null;
  const rhr = daily?.metrics?.rhr?.current ?? daily?.current?.values?.rhr ?? null;
  const bridge = daily?.bridgeSignal;
  const ready = daily?.state === 'ready';

  if (bridge?.active) {
    return {
      id: 'physiology', role: 'FIZJOLOG', scope: 'HRV, RHR i trend', status: 'YELLOW', direction: 'MODIFY',
      evidence: [
        evidence('HRV dziś', hrv, 'ms'),
        evidence('RHR dziś', rhr, 'bpm'),
        evidence('Trend 3 dni', 'RHR rośnie · HRV spada'),
      ],
      interpretation: 'Aktywny jest tymczasowy sygnał pomostowy. Jest podatny na szum i sam nie uzasadnia STOP.',
      recommendation: 'Rozważ modyfikację planu po potwierdzeniu samopoczuciem i rozgrzewką; nie zwiększaj obciążenia.',
    };
  }

  return {
    id: 'physiology', role: 'FIZJOLOG', scope: 'HRV, RHR i trend', status: ready ? 'INFO' : 'CALIBRATION', direction: null,
    evidence: [
      evidence('HRV dziś', hrv ?? 'brak danych', hrv === null ? '' : 'ms'),
      evidence('RHR dziś', rhr ?? 'brak danych', rhr === null ? '' : 'bpm'),
      evidence('Baseline', ready ? 'gotowy' : `KALIBRACJA ${daily?.calibrationDays || '0/28'}`),
    ],
    interpretation: ready
      ? 'Baseline jest gotowy, ale panel nie ma zakodowanej pojedynczej reguły, która z samego z-score tworzy decyzję.'
      : 'Historia jest za krótka na z-score. Brak liczby jest prawidłowym stanem kalibracji.',
    recommendation: ready
      ? 'Łącz odchylenia z samopoczuciem i planem; nie wydawaj decyzji z jednego parametru.'
      : 'Do końca kalibracji używaj danych opisowo i stosuj wyłącznie jawną regułę pomostową.',
  };
}

function recoverySpecialist({ recovery }) {
  const pain = numeric(recovery?.pain);
  const doms = numeric(recovery?.doms);
  const fatigue = numeric(recovery?.fatigue);
  const evidenceItems = [
    evidence('Ból', pain ?? 'brak deklaracji', pain === null ? '' : '/10'),
    evidence('DOMS', doms ?? 'brak deklaracji', doms === null ? '' : '/10'),
    evidence('Zmęczenie', fatigue ?? 'brak deklaracji', fatigue === null ? '' : '/10'),
    evidence('Sen', present(recovery?.sleep) ? recovery.sleep : 'brak danych', present(recovery?.sleep) ? '%' : ''),
  ];
  const red = pain !== null && pain >= 4
    || doms !== null && doms >= 8
    || fatigue !== null && fatigue >= 8;
  const yellow = !red && (
    pain !== null && pain > 0
    || doms !== null && doms >= 5
    || fatigue !== null && fatigue >= 5
  );
  const complete = pain !== null && doms !== null && fatigue !== null;

  if (red) {
    return {
      id: 'recovery', role: 'REGENERACJA I UKŁAD RUCHU', scope: 'ból i zmęczenie', status: 'RED', direction: 'STOP',
      evidence: evidenceItems,
      interpretation: 'Co najmniej jeden sygnał przekroczył istniejący czerwony próg aplikacji. To nie jest diagnoza medyczna.',
      recommendation: 'Nie wydawaj GO bez jawnego rozstrzygnięcia przez Głównego Trenera; nowe lub narastające objawy wymagają oceny poza aplikacją.',
    };
  }
  if (yellow) {
    return {
      id: 'recovery', role: 'REGENERACJA I UKŁAD RUCHU', scope: 'ból i zmęczenie', status: 'YELLOW', direction: 'MODIFY',
      evidence: evidenceItems,
      interpretation: 'Sygnały subiektywne wymagają ostrożniejszego wykonania, ale same nie tworzą diagnozy.',
      recommendation: 'Utrzymaj kontrolowaną intensywność i potwierdź możliwość kontynuacji po 10–15 minutach rozgrzewki.',
    };
  }

  return {
    id: 'recovery', role: 'REGENERACJA I UKŁAD RUCHU', scope: 'ból i zmęczenie', status: complete ? 'GREEN' : 'INCOMPLETE', direction: null,
    evidence: evidenceItems,
    interpretation: complete
      ? 'Podane wartości nie przekraczają progów ostrzegawczych aplikacji.'
      : 'Brak deklaracji zawodnika nie jest dowodem braku bólu, DOMS ani zmęczenia.',
    recommendation: complete
      ? 'Zachowaj zaplanowaną intensywność i obserwuj zmianę objawów podczas rozgrzewki.'
      : 'Przed kategoryczną decyzją uzupełnij jednym komunikatem ból, DOMS i zmęczenie.',
  };
}

function loadIntegrator({ load }) {
  const ratioReady = load?.loadRatio !== null && load?.loadRatio !== undefined;
  const internalLoadUnreliable = load?.ratioStatus === 'unreliable-internal-load';
  return {
    id: 'load', role: 'OBCIĄŻENIE I INTEGRACJA', scope: '7 / 28 dni', status: ratioReady ? 'INFO' : internalLoadUnreliable ? 'INCOMPLETE' : 'CALIBRATION', direction: null,
    evidence: [
      evidence('Bieg 7d', load?.km7 ?? 0, 'km'),
      evidence('sRPE 7d', load?.srpe7 ?? 0),
      evidence('sRPE 28d', load?.srpe28 ?? 0),
      evidence('Load ratio', ratioReady ? load.loadRatio : internalLoadUnreliable ? 'WYŁĄCZONE — RPE/sRPE niepełne' : `KALIBRACJA ${load?.calibrationDays || '0/28'}`),
    ],
    interpretation: ratioReady
      ? 'Load ratio jest dostępny jako kontekst obciążenia, nie jako automatyczny limit bezpieczeństwa.'
      : internalLoadUnreliable
        ? 'Historia może być wystarczająco długa, ale niepełne RPE/sRPE unieważnia wiarygodność load ratio.'
        : 'Rozpiętość historii nie wystarcza do wiarygodnego load ratio.',
    recommendation: ratioReady
      ? 'Uwzględnij trend obciążenia w decyzji, ale nie zmieniaj planu wyłącznie na podstawie ratio.'
      : internalLoadUnreliable
        ? 'Nie używaj ratio w decyzji; najpierw zbierz wiarygodne RPE dla wykonanych sesji.'
        : 'Nie pokazuj zastępczej liczby; utrzymuj stan kalibracji do 28 dni dostępności.',
  };
}

function dataSteward({ integrity, execution }) {
  const dailyIssues = (integrity?.dailyIssues || []).filter(({ severity }) => severity === 'error' || severity === 'warning');
  const verifier = integrity?.verifierMismatches || [];
  const missing = integrity?.validation?.missing || [];
  const suspicious = integrity?.validation?.suspicious || [];
  const freshness = integrity?.freshnessState || 'unknown';
  const executionError = execution?.status === 'data-error';
  const active = missing.length || suspicious.length || dailyIssues.length || verifier.length
    || freshness !== 'fresh' || executionError;
  if (!active) return null;

  const error = missing.length || suspicious.length || dailyIssues.some(({ severity }) => severity === 'error')
    || verifier.some(({ severity }) => severity === 'error') || executionError;
  return {
    id: 'data', role: 'OPIEKUN DANYCH', scope: 'integralność i świeżość', status: error ? 'RED' : 'YELLOW', direction: null,
    evidence: [
      evidence('Pola wymagane', missing.length ? `brak: ${missing.join(', ')}` : 'kompletne'),
      evidence('Verifier', verifier.length ? `${verifier.length} rozbieżności` : 'zgodny'),
      evidence('Raw_Data', dailyIssues.length ? `${dailyIssues.length} ostrzeżeń/błędów` : 'bez aktywnych problemów'),
      evidence('Świeżość', freshness),
      ...(executionError ? [evidence('Execution', 'DATA ERROR')] : []),
    ],
    interpretation: 'Co najmniej jedna warstwa danych nie daje pełnej podstawy do pewnego odczytu.',
    recommendation: 'Najpierw rozstrzygnij wskazany problem danych; nie zastępuj braków domysłem ani wartością ze średniej.',
  };
}

function buildDispute(decision, core) {
  const headDirection = DIRECTION_BY_STATUS[String(decision?.status || '').toUpperCase()] || null;
  const divergent = core.filter(({ direction }) => direction && headDirection && direction !== headDirection);
  if (!divergent.length) return null;
  return {
    status: 'YELLOW',
    evidence: [
      evidence('GŁÓWNY TRENER', DIRECTION_LABEL[headDirection] || headDirection),
      ...divergent.map(({ role, direction }) => evidence(role, DIRECTION_LABEL[direction] || direction)),
    ],
    interpretation: 'Co najmniej jedna domena wskazuje inny kierunek niż końcowy werdykt Głównego Trenera.',
    recommendation: 'Rozbieżność wymaga jawnego uzasadnienia przed treningiem; panel nie nadpisuje automatycznie werdyktu Głównego Trenera.',
  };
}

export function buildStaffPanel(input = {}) {
  const core = [
    runningCoach(input),
    physiologist(input),
    recoverySpecialist(input),
    loadIntegrator(input),
  ];
  const specialists = [dataSteward(input)].filter(Boolean);
  return {
    core,
    specialists,
    dispute: buildDispute(input.decision, core),
    methodology: 'DOWODY → INTERPRETACJA → REKOMENDACJA; Główny Trener pozostaje właścicielem decyzji końcowej.',
  };
}
