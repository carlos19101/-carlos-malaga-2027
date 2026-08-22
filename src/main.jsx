import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { normalize, parseCSV, parseDate, parseMetric, parseNumber, resolveLogSession } from './parse';
import './styles.css';

const SHEET_ID = '1FoExswYMSy5Ou2HwyzPd3bWgnplWgfPGCd5scC0lCXM';
const SHEETS = {
  feed: 'APP_FEED',
  log: 'Training Log',
  plan: 'Plan',
};

const SNAPSHOT_KEY = 'carlos:snapshot:v2';
const FETCH_TIMEOUT = 8000;
const MIN_REFRESH_MS = 60000;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'zones', label: 'Strefy', icon: '◒' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'plan', label: 'Plan', icon: '◇' },
];

const FIELD_ALIASES = {
  date: ['date', 'data', 'day', 'dzien', 'timestamp', 'datetime', 'czas'],
  recovery: ['recovery', 'recovery score', 'regeneracja', 'readiness', 'gotowosc'],
  strain: ['strain', 'day strain', 'obciazenie dnia'],
  srpe: ['srpe', 's rpe', 'srpe today', 'obciazenie'],
  sleep: ['sleep', 'sleep score', 'sleep performance', 'sen'],
  hrv: ['hrv', 'heart rate variability', 'zmiennosc'],
  rhr: ['rhr', 'resting hr', 'resting heart rate', 'tetno spoczynkowe'],
  weight: ['weight', 'waga', 'body weight', 'masa'],
  steps: ['steps', 'kroki'],
  session: ['session', 'workout', 'training', 'trening', 'nazwa', 'title', 'zadanie', 'type', 'typ', 'typ treningu', 'rodzaj', 'rodzaj treningu', 'activity', 'aktywnosc', 'aktywność', 'sport', 'sesja'],
  target: ['target', 'cel', 'focus', 'intensity', 'intensywnosc'],
  notes: ['notes', 'note', 'uwagi', 'opis', 'description'],
  duration: ['duration', 'czas trwania', 'time', 'minutes', 'min'],
  calories: ['calories', 'kcal', 'kalorie'],
  z1: ['z1', 'zone 1', 'strefa 1', 'czas z1'],
  z2: ['z2', 'zone 2', 'strefa 2', 'czas z2'],
  z3: ['z3', 'zone 3', 'strefa 3', 'czas z3'],
  z4: ['z4', 'zone 4', 'strefa 4', 'czas z4'],
  z5: ['z5', 'zone 5', 'strefa 5', 'czas z5'],
  __label__: ['metric', 'metryka', 'name', 'nazwa', 'label', 'parametr', 'kpi', 'key'],
  __value__: ['value', 'wartosc', 'current', 'wynik', 'result', 'score'],
};

const REQUIRED_FEED = ['recovery', 'hrv', 'rhr', 'weight'];
const RANGES = {
  hrv: [10, 200],
  rhr: [30, 110],
  weight: [60, 130],
  recovery: [0, 100],
  sleep: [0, 100],
};
const MAX_DELTA = { weight: 1.5, rhr: 15, hrv: 40 };

const ZONE_META = [
  { id: 1, name: 'Recovery', note: 'bardzo lekko', color: '#58c5e8' },
  { id: 2, name: 'Aerobic', note: 'baza tlenowa', color: '#64d8a2' },
  { id: 3, name: 'Tempo', note: 'kontrolowana praca', color: '#f3c846' },
  { id: 4, name: 'Threshold', note: 'próg', color: '#f07822' },
  { id: 5, name: 'Peak', note: 'wysoka intensywność', color: '#ef4867' },
];

function sheetUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_t=${Date.now()}`;
}

async function fetchSheet(sheetName, signal) {
  const response = await fetch(sheetUrl(sheetName), {
    cache: 'no-store',
    signal,
    headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`${sheetName}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return [];
  if (/^\s*</.test(text) && /<html/i.test(text)) {
    throw new Error(`${sheetName}: brak dostępu do arkusza (HTML zamiast CSV)`);
  }
  return parseCSV(text);
}

function findKey(row, candidates) {
  if (!row) return null;
  const wanted = new Set(candidates.map(normalize));
  return Object.keys(row).find((key) => wanted.has(normalize(key))) || null;
}

function resolveField(row, field) {
  const aliases = FIELD_ALIASES[field];
  if (!aliases) return { status: 'error', reason: `nieznane pole: ${field}` };
  const key = findKey(row, aliases);
  if (!key) return { status: 'missing', column: null, value: '' };
  const raw = String(row[key] ?? '').trim();
  return { status: raw === '' ? 'empty' : 'ok', column: key, value: raw };
}

function getValue(row, field, fallback = '') {
  const r = resolveField(row, field);
  return r.status === 'ok' ? r.value : fallback;
}

function getFeedValue(rows, latest, field, fallback = '') {
  const direct = resolveField(latest, field);
  if (direct.status === 'ok') return direct.value;

  const wanted = new Set((FIELD_ALIASES[field] || []).map(normalize));
  for (const row of rows) {
    const label = normalize(getValue(row, '__label__', ''));
    if (label && wanted.has(label)) {
      const v = getValue(row, '__value__', '');
      if (v !== '') return v;
    }
  }
  return fallback;
}

function rowDate(row) {
  return parseDate(getValue(row, 'date', ''));
}

function sortByDate(rows, direction = 'desc') {
  return rows
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
  if (!rows?.length) return {};
  return sortByDate(rows, 'desc')[0] || {};
}

function validateFeed(rows, latest, previous) {
  const missing = [];
  const suspicious = [];

  for (const field of REQUIRED_FEED) {
    if (resolveField(latest, field).status === 'missing' && getFeedValue(rows, latest, field, '') === '') {
      missing.push(field);
    }
  }

  for (const [field, [lo, hi]] of Object.entries(RANGES)) {
    const n = parseMetric(getFeedValue(rows, latest, field, ''));
    if (n === null) continue;
    if (n < lo || n > hi) suspicious.push(`${field}=${n} poza zakresem ${lo}–${hi}`);
    const prev = previous ? parseMetric(getFeedValue(rows, previous, field, '')) : null;
    const cap = MAX_DELTA[field];
    if (cap && prev !== null && Math.abs(n - prev) > cap) {
      suspicious.push(`${field}: skok o ${Math.abs(n - prev).toFixed(1)} (limit ${cap})`);
    }
  }

  return { missing, suspicious, ok: missing.length === 0 };
}

function formatUpdated(date) {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return value || '—';
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(d);
}

function ringProgress(value, max) {
  const n = parseMetric(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, (n / max) * 100));
}

function displayValue(value, suffix = '') {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const raw = String(value).trim();
  if (!suffix) return raw;
  if (raw.endsWith(suffix)) return raw;
  return `${raw}${suffix}`;
}

function MetricRing({ label, value, max = 100, suffix = '%', note, issue }) {
  const progress = ringProgress(value, max);
  const state = issue ? 'error' : progress === null ? 'empty' : 'ok';
  const shown = state === 'ok' ? displayValue(value, suffix) : state === 'error' ? '!' : '—';
  return (
    <article className={`ring-card ring-${state}`}>
      <div className="metric-ring" style={{ '--progress': `${(progress ?? 0) * 3.6}deg` }}>
        <div className="metric-ring-inner">
          <strong>{shown}</strong>
          <span>{label}</span>
        </div>
      </div>
      {state === 'ok'
        ? <p>{note}</p>
        : <p className="ring-note-issue">{state === 'error' ? issue : 'brak danych w arkuszu'}</p>}
    </article>
  );
}

function StatCard({ label, value, unit, note }) {
  const empty = value === null || value === undefined || String(value).trim() === '';
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{empty ? '—' : value}{!empty && unit ? <small> {unit}</small> : null}</strong>
      <small>{note}</small>
    </article>
  );
}

function SkeletonRings() {
  return <div className="skeleton-rings" aria-hidden="true"><i /><i /><i /></div>;
}

function EmptyState({ title, children }) {
  return (
    <section className="empty-state">
      <span className="empty-mark">—</span>
      <div><strong>{title}</strong><p>{children}</p></div>
    </section>
  );
}

function Hero({ eyebrow, title, children, orbit = true }) {
  return (
    <section className={`hero-panel ${orbit ? 'hero-with-orbit' : ''}`}>
      <div className="hero-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children ? <p>{children}</p> : null}
      </div>
      {orbit ? <div className="hero-orbit" aria-hidden="true"><b>C</b></div> : null}
    </section>
  );
}

function Dashboard({ feed, plan, loading }) {
  const sortedFeed = useMemo(() => sortByDate(feed, 'desc'), [feed]);
  const latest = sortedFeed[0] || {};
  const previous = sortedFeed[1] || null;
  const validation = useMemo(() => validateFeed(feed, latest, previous), [feed, latest, previous]);

  const values = {
    recovery: getFeedValue(feed, latest, 'recovery', ''),
    strain: getFeedValue(feed, latest, 'strain', ''),
    srpe: getFeedValue(feed, latest, 'srpe', ''),
    sleep: getFeedValue(feed, latest, 'sleep', ''),
    hrv: getFeedValue(feed, latest, 'hrv', ''),
    rhr: getFeedValue(feed, latest, 'rhr', ''),
    weight: getFeedValue(feed, latest, 'weight', ''),
    steps: getFeedValue(feed, latest, 'steps', ''),
  };

  const issueFor = (field) => {
    if (validation.missing.includes(field)) return `brak wymaganej kolumny: ${field}`;
    return validation.suspicious.find((x) => x.startsWith(`${field}=`) || x.startsWith(`${field}:`)) || '';
  };

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return sortByDate(plan, 'asc')
      .filter((row) => { const d = rowDate(row); return d && d >= today; })
      .slice(0, 3);
  }, [plan]);

  return (
    <>
      <Hero eyebrow="MÁLAGA 2027" title="Forma, która ma kierunek.">
        Jeden widok na regenerację, obciążenie, sen i plan.
      </Hero>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">DZISIAJ</span><h2>Sygnały organizmu</h2></div></div>

        {!validation.ok || validation.suspicious.length ? (
          <div className="data-quality-banner" role="alert">
            <strong>DATA ERROR — sprawdź źródło przed decyzją treningową.</strong>
            {validation.missing.length ? <span>Brak: {validation.missing.join(', ')}</span> : null}
            {validation.suspicious.length ? <span>{validation.suspicious.join(' · ')}</span> : null}
          </div>
        ) : null}

        {loading && !feed.length ? <SkeletonRings /> : feed.length ? (
          <div className="rings-grid">
            <MetricRing label="RECOVERY" value={values.recovery} max={100} note="Gotowość do pracy" issue={issueFor('recovery')} />
            <MetricRing label="STRAIN" value={values.strain} max={21} suffix="" note="Obciążenie dnia · skala 0–21" />
            <MetricRing label="SLEEP" value={values.sleep} max={100} note="Jakość / realizacja snu" issue={issueFor('sleep')} />
          </div>
        ) : <EmptyState title="Brak danych APP_FEED">Odśwież aplikację albo sprawdź arkusz źródłowy.</EmptyState>}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">BAZA</span><h2>Kluczowe parametry</h2></div></div>
        <div className="stats-grid">
          <StatCard label="HRV" value={values.hrv} unit="ms" note="zmienność rytmu serca" />
          <StatCard label="RHR" value={values.rhr} unit="bpm" note="tętno spoczynkowe" />
          <StatCard label="WAGA" value={values.weight} unit="kg" note="ostatni odczyt" />
          <StatCard label="KROKI" value={values.steps} note="aktywność dzienna" />
          {values.srpe ? <StatCard label="sRPE" value={values.srpe} note="realne obciążenie sesji" /> : null}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">NASTĘPNE</span><h2>Najbliższe sesje</h2></div>
          <span className="section-aside">{upcoming.length} w planie</span>
        </div>
        {loading && !plan.length ? <SkeletonRings /> : upcoming.length ? (
          <div className="plan-list compact">
            {upcoming.map((row, index) => (
              <PlanRow row={row} key={`${getValue(row, 'date', '')}-${index}`} />
            ))}
          </div>
        ) : <EmptyState title="Brak przyszłych sesji">Wpisy bez daty nie są przedstawiane jako „najbliższe”.</EmptyState>}
      </section>
    </>
  );
}

function Zones({ feed, log, loading }) {
  const latestFeed = latestRow(feed);
  const latestLog = latestRow(log);
  const zoneValues = ZONE_META.map((zone) => getFeedValue(feed, latestFeed, `z${zone.id}`, getValue(latestLog, `z${zone.id}`, '')));
  const amounts = zoneValues.map((v) => parseMetric(v));
  const total = amounts.reduce((sum, n) => sum + (n ?? 0), 0);

  return (
    <>
      <Hero eyebrow="INTENSYWNOŚĆ" title="Strefy wysiłku" orbit={false}>
        Odczyt z APP_FEED z fallbackiem do ostatniego treningu.
      </Hero>
      <section className="section-block zone-list">
        {loading && !feed.length && !log.length ? <SkeletonRings /> : ZONE_META.map((zone, index) => {
          const raw = zoneValues[index];
          const amount = amounts[index];
          const width = amount !== null && total > 0 && amount > 0 ? Math.max(2, (amount / total) * 100) : 0;
          return (
            <article className="zone-card" key={zone.id}>
              <div className="zone-badge" style={{ background: zone.color }}>Z{zone.id}</div>
              <div className="zone-main">
                <strong>{zone.name}</strong>
                <small>{zone.note}</small>
                <div className="zone-track"><span style={{ width: `${width}%`, background: zone.color }} /></div>
              </div>
              <b>{raw || '—'}</b>
            </article>
          );
        })}
      </section>
    </>
  );
}

function Log({ rows, loading }) {
  const sorted = useMemo(() => sortByDate(rows, 'desc'), [rows]);
  const columns = [
    { label: 'Data', field: 'date', format: (v) => formatDate(v) },
    { label: 'Trening', field: 'session' },
    { label: 'Czas', field: 'duration' },
    { label: 'sRPE', field: 'srpe' },
    { label: 'Kalorie', field: 'calories' },
  ];

  return (
    <>
      <Hero eyebrow="HISTORIA" title="Training Log" orbit={false}>
        Ostatnie sesje, posortowane od najnowszej poprawnej daty.
      </Hero>
      <section className="section-block">
        {loading && !rows.length ? <SkeletonRings /> : rows.length ? (
          <div className="table-shell">
            <table>
              <thead><tr>{columns.map((c) => <th key={c.field}>{c.label}</th>)}</tr></thead>
              <tbody>
                {sorted.map((row, index) => (
                  <tr key={`${getValue(row, 'date', '')}-${index}`}>
                    {columns.map((column) => {
                      const raw = column.field === 'session'
                        ? resolveLogSession(row, FIELD_ALIASES.session)
                        : getValue(row, column.field, '');
                      return <td key={column.field}>{raw ? (column.format ? column.format(raw) : raw) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Brak wpisów">Training Log nie zwrócił żadnych rekordów.</EmptyState>}
      </section>
    </>
  );
}

function PlanRow({ row }) {
  const date = getValue(row, 'date', '');
  const session = getValue(row, 'session', 'Sesja');
  const target = getValue(row, 'target', '');
  const notes = getValue(row, 'notes', '');
  return (
    <article className="plan-item">
      <div className="plan-date">{date ? formatDate(date) : '—'}</div>
      <div className="plan-copy">
        <span>{target || '—'}</span>
        <strong>{session}</strong>
        <p>{notes || 'Brak dodatkowych uwag'}</p>
      </div>
    </article>
  );
}

function Plan({ rows, loading }) {
  const dated = useMemo(() => sortByDate(rows.filter((row) => rowDate(row)), 'asc'), [rows]);
  const undated = useMemo(() => rows.filter((row) => !rowDate(row)), [rows]);
  return (
    <>
      <Hero eyebrow="DROGA DO CELU" title="Plan" orbit={false}>
        Najbliższe jednostki i priorytety prowadzące do Málaga 2027.
      </Hero>
      <section className="section-block">
        {loading && !rows.length ? <SkeletonRings /> : dated.length ? (
          <div className="plan-list">{dated.map((row, i) => <PlanRow row={row} key={`${getValue(row, 'date', '')}-${i}`} />)}</div>
        ) : <EmptyState title="Brak zaplanowanych dat">Plan nie zawiera obecnie terminowych sesji.</EmptyState>}
      </section>
      {undated.length ? (
        <section className="section-block">
          <div className="section-heading"><div><span className="eyebrow">PLAN</span><h2>Bez terminu</h2></div></div>
          <div className="plan-list">{undated.map((row, i) => <PlanRow row={row} key={`undated-${i}`} />)}</div>
        </section>
      ) : null}
    </>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState({ feed: [], log: [], plan: [] });
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
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
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    setLoading(true);
    const entries = Object.entries(SHEETS);
    const results = await Promise.allSettled(entries.map(([, sheetName]) => fetchSheet(sheetName, controller.signal)));
    clearTimeout(timer);

    if (inFlight.current !== controller) return;
    inFlight.current = null;

    const nextErrors = {};
    const merged = { ...dataRef.current };
    let anyOk = false;

    results.forEach((result, index) => {
      const [key, sheetName] = entries[index];
      if (result.status === 'fulfilled') {
        merged[key] = result.value;
        anyOk = true;
      } else {
        nextErrors[key] = result.reason?.name === 'AbortError'
          ? `${sheetName}: przekroczono czas (${FETCH_TIMEOUT / 1000}s)`
          : result.reason?.message || `${sheetName}: błąd pobierania`;
      }
    });

    setData(merged);
    setErrors(nextErrors);
    setCheckedAt(Date.now());

    if (anyOk) {
      const at = Date.now();
      setSyncedAt(at);
      setFromCache(false);
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ data: merged, at }));
      } catch {
        // Safari private mode / quota: snapshot is optional.
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      const snap = raw ? JSON.parse(raw) : null;
      if (snap?.data) {
        setData(snap.data);
        dataRef.current = snap.data;
        setSyncedAt(snap.at);
        setFromCache(true);
      }
    } catch {
      // Corrupted snapshot: ignore and continue with network.
    }
    refresh({ force: true });
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onPageShow = (event) => { if (event.persisted) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  const errorCount = Object.keys(errors).length;
  const isStale = syncedAt !== null && Date.now() - syncedAt > STALE_AFTER_MS;
  const offline = errorCount === Object.keys(SHEETS).length;
  const status = offline ? 'offline' : isStale ? 'stale' : errorCount ? 'partial' : 'live';
  const statusLabel = {
    live: 'Dane aktualne',
    partial: 'Dane częściowe',
    stale: 'Dane nieaktualne',
    offline: 'Offline — dane zapisane lokalnie',
  }[status];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('dashboard')} aria-label="Przejdź do Dashboard">
          <span className="brand-mark">C</span>
          <span><strong>CARLOS</strong><small>MÁLAGA 2027</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Główna nawigacja">
          {TABS.map((item) => (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <button className="refresh-button" onClick={() => refresh({ force: true })} disabled={loading} aria-label="Odśwież dane">
          <span className={loading ? 'spin' : ''}>↻</span><b>{loading ? 'Sync' : 'Odśwież'}</b>
        </button>
      </header>

      <div className={`sync-strip status-${status}`} aria-live="polite">
        <span className="live-dot" />
        <span className="sync-main">{statusLabel}</span>
        <span className="sync-times">Dane z: {syncedAt ? formatUpdated(new Date(syncedAt)) : '—'} · Sprawdzono: {checkedAt ? formatUpdated(new Date(checkedAt)) : '—'}</span>
      </div>

      {errorCount ? (
        <div className="error-banner" role="status">
          <strong>{offline ? 'Brak połączenia ze źródłem danych.' : 'Nie wszystkie arkusze odświeżone.'}</strong>
          <span>{Object.values(errors).join(' · ')}</span>
          {fromCache ? <span>Pokazane dane pochodzą z lokalnej kopii.</span> : null}
        </div>
      ) : null}

      <main>
        {tab === 'dashboard' && <Dashboard feed={data.feed} plan={data.plan} loading={loading} />}
        {tab === 'zones' && <Zones feed={data.feed} log={data.log} loading={loading} />}
        {tab === 'log' && <Log rows={data.log} loading={loading} />}
        {tab === 'plan' && <Plan rows={data.plan} loading={loading} />}
      </main>

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
