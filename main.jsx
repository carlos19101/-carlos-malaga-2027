import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SHEET_ID = '1FoExswYMSy5Ou2HwyzPd3bWgnplWgfPGCd5scC0lCXM';
const SHEETS = {
  feed: 'APP_FEED',
  log: 'Training Log',
  plan: 'Plan',
};

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'zones', label: 'Strefy', icon: '◒' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'plan', label: 'Plan', icon: '◇' },
];

const normalize = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header, index) => String(header).trim() || `Kolumna ${index + 1}`);
  return rows.slice(1).map((cells) =>
    headers.reduce((record, header, index) => {
      record[header] = String(cells[index] ?? '').trim();
      return record;
    }, {}),
  );
}

function findKey(row, candidates) {
  if (!row) return null;
  const keys = Object.keys(row);
  const normalizedCandidates = candidates.map(normalize);

  return (
    keys.find((key) => normalizedCandidates.includes(normalize(key))) ||
    keys.find((key) => normalizedCandidates.some((candidate) => normalize(key).includes(candidate))) ||
    null
  );
}

function getValue(row, candidates, fallback = '') {
  const key = findKey(row, candidates);
  const value = key ? row[key] : '';
  return value === undefined || value === null || String(value).trim() === '' ? fallback : value;
}

function getFeedValue(rows, latestRow, candidates, fallback = '') {
  const direct = getValue(latestRow, candidates, '');
  if (direct !== '') return direct;

  const wanted = candidates.map(normalize);
  const labelCandidates = ['metric', 'metryka', 'name', 'nazwa', 'label', 'parameter', 'parametr', 'kpi'];
  const valueCandidates = ['value', 'wartosc', 'current', 'today', 'result', 'wynik', 'score'];

  for (const row of rows) {
    const label = normalize(getValue(row, labelCandidates, ''));
    if (!label) continue;
    if (wanted.some((candidate) => label === candidate || label.includes(candidate))) {
      const value = getValue(row, valueCandidates, '');
      if (value !== '') return value;
    }
  }

  return fallback;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!parts) return null;

  let [, day, month, year, hour = '0', minute = '0'] = parts;
  if (year.length === 2) year = `20${year}`;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowDate(row) {
  return parseDate(
    getValue(row, ['date', 'data', 'day', 'dzien', 'timestamp', 'datetime', 'date time', 'czas'], ''),
  );
}

function sortByDate(rows, direction = 'desc') {
  return [...rows].sort((a, b) => {
    const aTime = rowDate(a)?.getTime() ?? 0;
    const bTime = rowDate(b)?.getTime() ?? 0;
    return direction === 'asc' ? aTime - bTime : bTime - aTime;
  });
}

function latestRow(rows) {
  if (!rows.length) return {};
  const dated = rows.filter((row) => rowDate(row));
  if (dated.length) return sortByDate(dated, 'desc')[0];
  return rows[rows.length - 1];
}

function formatDate(value, options = { day: '2-digit', month: 'short' }) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return value || '—';
  return new Intl.DateTimeFormat('pl-PL', options).format(date);
}

function formatUpdated(date) {
  if (!date) return 'Jeszcze nie odświeżono';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sheetUrl(sheetName) {
  const params = new URLSearchParams({
    tqx: 'out:csv',
    sheet: sheetName,
    _: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params.toString()}`;
}

async function fetchSheet(sheetName) {
  const response = await fetch(sheetUrl(sheetName), {
    cache: 'no-store',
    headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
  });

  if (!response.ok) throw new Error(`${sheetName}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return [];
  if (/^\s*</.test(text) && /<html/i.test(text)) {
    throw new Error(`${sheetName}: Google zwrócił stronę HTML zamiast CSV`);
  }
  return parseCSV(text);
}

function numericScore(value, max = 100) {
  const number = parseNumber(value);
  if (number === null) return 0;
  return Math.max(0, Math.min(100, (number / max) * 100));
}

function displayValue(value, suffix = '') {
  if (value === '' || value === null || value === undefined) return '—';
  const raw = String(value).trim();
  return suffix && !raw.toLowerCase().includes(suffix.toLowerCase()) ? `${raw}${suffix}` : raw;
}

function SectionTitle({ eyebrow, title, aside }) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {aside ? <div className="section-aside">{aside}</div> : null}
    </div>
  );
}

function MetricRing({ label, value, max = 100, suffix = '%', note }) {
  const progress = numericScore(value, max);
  const shown = displayValue(value, suffix);

  return (
    <article className="ring-card">
      <div className="metric-ring" style={{ '--progress': `${progress * 3.6}deg` }}>
        <div className="metric-ring-inner">
          <strong>{shown}</strong>
          <span>{label}</span>
        </div>
      </div>
      <p>{note}</p>
    </article>
  );
}

function StatCard({ label, value, meta }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
      <small>{meta}</small>
    </article>
  );
}

function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">＋</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function DataTable({ rows, columns, emptyTitle, emptyText }) {
  if (!rows.length) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowDate(row)?.getTime() || 'row'}-${rowIndex}`}>
              {columns.map((column) => {
                const raw = getValue(row, column.keys, '');
                const value = column.format ? column.format(raw, row) : raw || '—';
                return <td key={column.label}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ feed, plan }) {
  const latest = useMemo(() => latestRow(feed), [feed]);
  const recovery = getFeedValue(feed, latest, ['recovery', 'recovery score', 'regeneracja', 'gotowosc']);
  const strain = getFeedValue(feed, latest, ['strain', 'day strain', 'obciazenie', 'load']);
  const sleep = getFeedValue(feed, latest, ['sleep performance', 'sleep score', 'sleep', 'sen']);
  const hrv = getFeedValue(feed, latest, ['hrv', 'heart rate variability']);
  const rhr = getFeedValue(feed, latest, ['rhr', 'resting heart rate', 'resting hr', 'tetno spoczynkowe']);
  const weight = getFeedValue(feed, latest, ['weight', 'waga', 'body weight']);
  const steps = getFeedValue(feed, latest, ['steps', 'kroki']);

  const upcoming = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sorted = sortByDate(plan, 'asc');
    const future = sorted.filter((row) => {
      const date = rowDate(row);
      return date && date >= now;
    });
    return (future.length ? future : sorted).slice(0, 3);
  }, [plan]);

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">MÁLAGA 2027</span>
          <h1>Forma, która ma kierunek.</h1>
          <p>
            Jeden widok na regenerację, obciążenie, sen i plan. Dane pochodzą bezpośrednio z APP_FEED.
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="orbit-core">C</span>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="DZISIAJ" title="Sygnały organizmu" aside="APP_FEED" />
        {feed.length ? (
          <div className="rings-grid">
            <MetricRing label="Recovery" value={recovery} note="Gotowość do pracy" />
            <MetricRing label="Strain" value={strain} max={21} suffix="" note="Obciążenie dnia · skala 0–21" />
            <MetricRing label="Sleep" value={sleep} note="Jakość / realizacja snu" />
          </div>
        ) : (
          <EmptyState title="Brak danych APP_FEED">
            Po udostępnieniu arkusza wartości regeneracji, obciążenia i snu pojawią się tutaj automatycznie.
          </EmptyState>
        )}
      </section>

      <section>
        <SectionTitle eyebrow="BAZA" title="Kluczowe parametry" />
        <div className="stats-grid">
          <StatCard label="HRV" value={displayValue(hrv, ' ms')} meta="zmienność rytmu serca" />
          <StatCard label="RHR" value={displayValue(rhr, ' bpm')} meta="tętno spoczynkowe" />
          <StatCard label="Waga" value={displayValue(weight, ' kg')} meta="ostatni odczyt" />
          <StatCard label="Kroki" value={displayValue(steps)} meta="aktywność dzienna" />
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="NASTĘPNE" title="Najbliższe sesje" aside={`${plan.length} pozycji w Plan`} />
        {upcoming.length ? (
          <div className="plan-stack compact">
            {upcoming.map((row, index) => (
              <PlanItem key={index} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState title="Plan jest pusty">Dodaj sesje w arkuszu Plan, a aplikacja pokaże najbliższe treningi.</EmptyState>
        )}
      </section>
    </div>
  );
}

const ZONES = [
  { id: 1, label: 'Z1', name: 'Recovery', hint: 'bardzo lekko' },
  { id: 2, label: 'Z2', name: 'Aerobic', hint: 'baza tlenowa' },
  { id: 3, label: 'Z3', name: 'Tempo', hint: 'kontrolowana praca' },
  { id: 4, label: 'Z4', name: 'Threshold', hint: 'próg' },
  { id: 5, label: 'Z5', name: 'Peak', hint: 'wysoka intensywność' },
];

function Zones({ feed, log }) {
  const latestFeed = useMemo(() => latestRow(feed), [feed]);
  const latestLog = useMemo(() => latestRow(log), [log]);

  const zoneValues = ZONES.map((zone) => {
    const candidates = [
      `zone ${zone.id}`,
      `zone${zone.id}`,
      `z${zone.id}`,
      `strefa ${zone.id}`,
      `strefa${zone.id}`,
      `time zone ${zone.id}`,
      `czas z${zone.id}`,
    ];
    return getFeedValue(feed, latestFeed, candidates, getValue(latestLog, candidates, ''));
  });

  const numeric = zoneValues.map(parseNumber);
  const numericTotal = numeric.reduce((sum, value) => sum + (value ?? 0), 0);
  const hasNumericTotal = numericTotal > 0;

  return (
    <div className="page-grid">
      <section className="zone-hero">
        <span className="eyebrow">INTENSYWNOŚĆ</span>
        <h1>Strefy wysiłku</h1>
        <p>Rozkład ostatnich dostępnych wartości strefowych z APP_FEED, z fallbackiem do Training Log.</p>
      </section>

      <section className="zones-list">
        {ZONES.map((zone, index) => {
          const value = zoneValues[index];
          const amount = numeric[index];
          const width = hasNumericTotal && amount !== null ? Math.max(2, (amount / numericTotal) * 100) : 0;
          return (
            <article className={`zone-card zone-${zone.id}`} key={zone.id}>
              <div className="zone-index">{zone.label}</div>
              <div className="zone-content">
                <div className="zone-copy">
                  <div>
                    <strong>{zone.name}</strong>
                    <span>{zone.hint}</span>
                  </div>
                  <b>{value || '—'}</b>
                </div>
                <div className="zone-track" aria-hidden="true">
                  <span style={{ width: `${width}%` }} />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <aside className="info-panel">
        <span>Źródło</span>
        <p>
          Aplikacja rozpoznaje popularne warianty nagłówków, m.in. <code>Z1</code>, <code>Zone 1</code> i <code>Strefa 1</code>.
          Dzięki temu arkusz może pozostać czytelny dla człowieka bez sztywnego schematu API.
        </p>
      </aside>
    </div>
  );
}

function Log({ rows }) {
  const sorted = useMemo(() => sortByDate(rows, 'desc').slice(0, 30), [rows]);
  const columns = [
    { label: 'Data', keys: ['date', 'data', 'day', 'dzien', 'timestamp'], format: (value) => formatDate(value) },
    { label: 'Trening', keys: ['workout', 'activity', 'training', 'trening', 'session', 'type', 'typ'] },
    { label: 'Czas', keys: ['duration', 'czas', 'time', 'minutes', 'min'] },
    { label: 'Strain', keys: ['strain', 'load', 'obciazenie'] },
    { label: 'Kalorie', keys: ['calories', 'kcal', 'kalorie'] },
  ];

  return (
    <div className="page-grid">
      <section className="section-hero split">
        <div>
          <span className="eyebrow">HISTORIA</span>
          <h1>Training Log</h1>
          <p>Ostatnie sesje, posortowane od najnowszej daty.</p>
        </div>
        <div className="count-pill">
          <strong>{rows.length}</strong>
          <span>wpisów</span>
        </div>
      </section>

      <section>
        <DataTable
          rows={sorted}
          columns={columns}
          emptyTitle="Brak wpisów w Training Log"
          emptyText="Gdy arkusz zawiera dane, historia treningów pojawi się tutaj automatycznie."
        />
      </section>
    </div>
  );
}

function PlanItem({ row }) {
  const date = rowDate(row);
  const title = getValue(row, ['session', 'workout', 'training', 'trening', 'name', 'nazwa', 'title', 'zadanie'], 'Sesja');
  const target = getValue(row, ['target', 'cel', 'focus', 'intensity', 'intensywnosc', 'zone', 'strefa'], 'Plan treningowy');
  const notes = getValue(row, ['notes', 'note', 'uwagi', 'opis', 'description'], '');

  return (
    <article className="plan-item">
      <div className="plan-date">
        <strong>{date ? formatDate(date, { day: '2-digit' }) : '—'}</strong>
        <span>{date ? formatDate(date, { month: 'short' }) : ''}</span>
      </div>
      <div className="plan-copy">
        <span>{target}</span>
        <h3>{title}</h3>
        {notes ? <p>{notes}</p> : null}
      </div>
      <span className="plan-arrow">↗</span>
    </article>
  );
}

function Plan({ rows }) {
  const sorted = useMemo(() => sortByDate(rows, 'asc'), [rows]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const future = sorted.filter((row) => {
    const date = rowDate(row);
    return !date || date >= now;
  });
  const shown = future.length ? future : sorted;

  return (
    <div className="page-grid">
      <section className="section-hero">
        <span className="eyebrow">DROGA DO CELU</span>
        <h1>Plan</h1>
        <p>Najbliższe jednostki i priorytety prowadzące do Málaga 2027.</p>
      </section>

      <section>
        {shown.length ? (
          <div className="plan-stack">
            {shown.slice(0, 40).map((row, index) => (
              <PlanItem key={index} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState title="Brak pozycji w Plan">Dodaj datę i nazwę sesji w arkuszu Plan, aby zobaczyć harmonogram.</EmptyState>
        )}
      </section>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState({ feed: [], log: [], plan: [] });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const entries = Object.entries(SHEETS);
    const results = await Promise.allSettled(entries.map(([, sheetName]) => fetchSheet(sheetName)));

    const nextErrors = {};
    setData((previous) => {
      const next = { ...previous };
      results.forEach((result, index) => {
        const [key, sheetName] = entries[index];
        if (result.status === 'fulfilled') {
          next[key] = result.value;
        } else {
          nextErrors[key] = result.reason?.message || `${sheetName}: błąd pobierania`;
        }
      });
      return next;
    });

    setErrors(nextErrors);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refresh]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  const errorCount = Object.keys(errors).length;
  const totalRows = data.feed.length + data.log.length + data.plan.length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('dashboard')} aria-label="Przejdź do Dashboard">
          <span className="brand-mark">C</span>
          <span>
            <strong>CARLOS</strong>
            <small>MÁLAGA 2027</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="Główna nawigacja">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="refresh-button" onClick={refresh} disabled={loading}>
          <span className={loading ? 'spin' : ''}>↻</span>
          <b>{loading ? 'Sync' : 'Refresh'}</b>
        </button>
      </header>

      <div className={`sync-strip ${errorCount ? 'warning' : ''}`}>
        <span className="live-dot" />
        <span>{loading ? 'Pobieranie danych…' : `${totalRows} rekordów · ${formatUpdated(lastUpdated)}`}</span>
        {errorCount ? <strong>{errorCount} źródło(a) niedostępne</strong> : <strong>Google Sheets live</strong>}
      </div>

      {errorCount ? (
        <div className="error-banner" role="status">
          <strong>Nie wszystkie arkusze zostały odświeżone.</strong>
          <span>{Object.values(errors).join(' · ')}</span>
        </div>
      ) : null}

      <main>
        {tab === 'dashboard' && <Dashboard feed={data.feed} plan={data.plan} />}
        {tab === 'zones' && <Zones feed={data.feed} log={data.log} />}
        {tab === 'log' && <Log rows={data.log} />}
        {tab === 'plan' && <Plan rows={data.plan} />}
      </main>

      <nav className="mobile-nav" aria-label="Dolna nawigacja">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
