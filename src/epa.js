function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const EPA_COACHES = [
  { id: 'canova', name: 'Renato Canova', initials: 'RC', focus: 'specyficzność i kontrola bodźca' },
  { id: 'sang', name: 'Patrick Sang', initials: 'PS', focus: 'ciągłość procesu i ekonomia wykonania' },
  { id: 'eyestone', name: 'Ed Eyestone', initials: 'EE', focus: 'rozwój objętości i przygotowanie maratońskie' },
  { id: 'ritzenhein', name: 'Dathan Ritzenhein', initials: 'DR', focus: 'progresja obciążenia i jakość jednostek' },
  { id: 'norwegian', name: 'System norweski / Ingebrigtsen', initials: 'NO', focus: 'kontrola pracy progowej' },
  { id: 'rowberry', name: 'Tim Rowberry', initials: 'TR', focus: 'łączenie bodźców i adaptacja planu' },
  { id: 'bosshard', name: 'Joe Bosshard', initials: 'JB', focus: 'indywidualizacja i odporność zawodnika' },
  { id: 'coogan', name: 'Mark Coogan', initials: 'MC', focus: 'stabilność tygodnia i rozwój tlenowy' },
  { id: 'bideau', name: 'Nic Bideau', initials: 'NB', focus: 'dyspozycyjność i przygotowanie startowe' },
  { id: 'rosario', name: 'Ben Rosario', initials: 'BR', focus: 'specyfika półmaratonu i maratonu' },
];

export const EPA_ATHLETES = [
  { id: 'kipchoge', name: 'Eliud Kipchoge', initials: 'EK' },
  { id: 'hassan', name: 'Sifan Hassan', initials: 'SH' },
  { id: 'kipyegon', name: 'Faith Kipyegon', initials: 'FK' },
  { id: 'mantz', name: 'Conner Mantz', initials: 'CM' },
  { id: 'nuguse', name: 'Yared Nuguse', initials: 'YN' },
  { id: 'monson', name: 'Alicia Monson', initials: 'AM' },
  { id: 'mcsweyn', name: 'Stewart McSweyn', initials: 'SM' },
  { id: 'coburn', name: 'Emma Coburn', initials: 'EC' },
];

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function sourceSummary({ activity, session, execution, nextDayAvailable, comparableSessions }) {
  const stravaFacts = [
    present(activity?.distanceMeters) ? 'dystans' : null,
    present(activity?.movingSeconds) ? 'czas ruchu' : null,
    present(activity?.averageHeartRate) ? 'HR średnie' : null,
    present(activity?.maxHeartRate) ? 'HR maksymalne' : null,
  ].filter(Boolean);
  const feedbackFacts = [
    present(session?.rpe) ? 'RPE' : null,
    present(session?.pain) ? 'ból' : null,
    present(session?.legFatigue) ? 'zmęczenie nóg' : null,
  ].filter(Boolean);
  const executionReady = ['ok', 'over', 'under'].includes(execution?.status)
    && number(execution?.hrTargetPct) !== null;
  const available = [
    stravaFacts.length ? `Strava: ${stravaFacts.join(', ')}` : null,
    executionReady ? 'TCX: rozkład czasu względem celu HR' : null,
    feedbackFacts.length ? `ocena zawodnika: ${feedbackFacts.join(', ')}` : null,
  ].filter(Boolean);
  const missing = [
    !stravaFacts.length ? 'aktywność Stravy' : null,
    !executionReady ? 'pełna analiza TCX / Execution' : null,
    !feedbackFacts.length ? 'ocena zawodnika' : null,
    !nextDayAvailable ? 'reakcja następnego dnia' : null,
    comparableSessions < 3 ? `seria porównywalnych sesji (${comparableSessions}/3)` : null,
    'zweryfikowane karty źródłowe metod EPA',
  ].filter(Boolean);
  return {
    state: available.length >= 2 ? 'partial' : available.length ? 'limited' : 'missing',
    available,
    missing,
    stravaFacts,
    feedbackFacts,
    executionReady,
  };
}

function sessionBrief({ activity, session, execution }) {
  const distanceKm = number(activity?.distanceMeters) !== null
    ? number(activity.distanceMeters) / 1000
    : number(session?.distanceKm);
  const rpe = number(session?.rpe);
  const pain = number(session?.pain);
  const targetPct = number(execution?.hrTargetPct);
  const abovePct = number(execution?.aboveTargetPct);
  const status = execution?.status;
  let title = 'Za mało danych do oceny wykonania';
  let copy = 'EPA nie tworzy wniosku, dopóki nie ma atomowych danych wykonania i odczuć zawodnika.';
  let tone = 'missing';

  if (['ok', 'over', 'under'].includes(status) && targetPct !== null) {
    tone = status === 'ok' ? 'ok' : 'attention';
    title = status === 'ok'
      ? 'Wykonanie mieści się w zapisanym kontrakcie sesji'
      : status === 'over' ? 'Wykonanie przekroczyło kontrakt sesji' : 'Wykonanie było poniżej kontraktu sesji';
    copy = `${targetPct.toFixed(1).replace('.', ',')}% analizowanego czasu było w celu HR${abovePct === null ? '' : `, ${abovePct.toFixed(1).replace('.', ',')}% ponad celem`}.`;
    if (rpe !== null) copy += ` RPE: ${rpe}/10.`;
    if (pain !== null) copy += ` Ból: ${pain}/10.`;
  }
  return { title, copy, tone, distanceKm, rpe, pain, targetPct, abovePct };
}

function coachAssessment(person, input, sources) {
  const easy = /easy|spokoj|recovery|regener/i.test(`${input.session?.name || ''} ${input.session?.type || ''}`);
  const specialState = person.id === 'norwegian' && easy ? 'NIE DOTYCZY TEJ SESJI' : 'BRAK PODSTAW';
  return {
    ...person,
    kind: 'coach',
    state: specialState,
    tone: specialState === 'NIE DOTYCZY TEJ SESJI' ? 'neutral' : 'missing',
    principle: `Obszar roboczy EPA: ${person.focus}. To etykieta porządkująca analizę, nie przypisana temu trenerowi wypowiedź ani automatyczna rekomendacja.`,
    available: sources.available,
    missing: specialState === 'NIE DOTYCZY TEJ SESJI'
      ? ['pasująca sesja progowa', 'zweryfikowana karta źródłowa metody']
      : sources.missing,
    verdict: specialState === 'NIE DOTYCZY TEJ SESJI'
      ? 'Ta perspektywa nie jest uruchamiana dla obecnej sesji easy. Nie zmienia decyzji Głównego Trenera.'
      : 'Brak zweryfikowanej karty źródłowej, która łączyłaby tę perspektywę z obecnym problemem CARLOS. EPA nie wydaje opinii.',
  };
}

function athleteAssessment(person, sources) {
  return {
    ...person,
    kind: 'athlete',
    state: 'CASE STUDY · BRAK PARY',
    tone: 'case-study',
    principle: 'Zawodnik jest wyłącznie potencjalnym studium przypadku, a nie członkiem sztabu ani autorem opinii o CARLOS.',
    available: sources.available,
    missing: ['zweryfikowany przypadek rozwiązujący ten sam problem', 'ocena transferowalności do CARLOS'],
    verdict: 'Nie znaleziono zweryfikowanego, porównywalnego przypadku. Nazwisko nie tworzy rekomendacji i nie zmienia decyzji Głównego Trenera.',
  };
}

export function buildEpaAnalysis(input = {}) {
  const normalized = {
    activity: input.activity || null,
    session: input.session || null,
    execution: input.execution || null,
    phase: String(input.phase || '').trim(),
    nextDayAvailable: Boolean(input.nextDayAvailable),
    comparableSessions: Math.max(0, Number(input.comparableSessions) || 0),
  };
  const sources = sourceSummary(normalized);
  const brief = sessionBrief(normalized);
  return {
    phase: normalized.phase || 'BRAK DANYCH',
    sources,
    brief,
    coaches: EPA_COACHES.map((person) => coachAssessment(person, normalized, sources)),
    athletes: EPA_ATHLETES.map((person) => athleteAssessment(person, sources)),
    synthesis: {
      state: sources.executionReady ? 'DANE SESJI GOTOWE' : 'BRAK PEŁNEJ PODSTAWY',
      conclusion: 'EPA porządkuje dowody i luki. Nie głosuje, nie zastępuje Sztabu i nie nadpisuje werdyktu Głównego Trenera.',
    },
  };
}
