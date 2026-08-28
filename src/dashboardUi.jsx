import { Component, useEffect, useState } from 'react';

export function loginFailureMessage(result = {}) {
  if (result.status === 401) return 'Nieprawidłowy passcode.';
  if (result.status === 429) {
    const seconds = Number(result.retryAfterSeconds);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null;
    return minutes ? `Zbyt wiele prób. Spróbuj ponownie za około ${minutes} min.` : 'Zbyt wiele prób. Spróbuj ponownie później.';
  }
  if (result.status === 0) return 'Brak połączenia z serwerem.';
  if (result.status === 503) return 'Ochrona logowania jest chwilowo niedostępna. Spróbuj ponownie później.';
  return 'Nie udało się rozpocząć sesji.';
}

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-recovery-shell" role="alert">
        <section className="app-recovery-card">
          <span className="brand-mark">C</span>
          <span className="eyebrow">CARLOS · MÁLAGA 2027</span>
          <h1>Widok wymaga ponowienia</h1>
          <p>Nie udało się bezpiecznie wyświetlić części aplikacji. Dane źródłowe nie zostały zmienione.</p>
          <button type="button" onClick={() => this.setState({ failed: false })}>Spróbuj ponownie</button>
        </section>
      </div>
    );
  }
}

export function DashboardDisclosure({ eyebrow, title, summary, children, defaultOpen = false }) {
  return (
    <details className="dashboard-disclosure" open={defaultOpen || undefined}>
      <summary>
        <span className="disclosure-copy"><small>{eyebrow}</small><strong>{title}</strong><em>{summary}</em></span>
        <span className="disclosure-toggle" aria-hidden="true" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function DashboardSignal({ label, value, unit = '', note = '', tone = '' }) {
  const shown = value !== null && value !== undefined && !/^(?:|—|–|-)$/.test(String(value).trim());
  return (
    <details className={`dashboard-contributor ${tone ? `contributor-${tone}` : ''}`}>
      <summary>
        <span>{label}</span>
        <strong>{shown ? value : '—'}{shown && unit ? <small>{unit}</small> : null}<i aria-hidden="true">⌄</i></strong>
      </summary>
      <p>{shown ? note : 'Brak danych — aplikacja nie zastępuje brakującej wartości zerem.'}</p>
    </details>
  );
}

export function DashboardDrawer({ open, onClose, eyebrow, title, id, className = '', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dashboard-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`dashboard-drawer ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="dashboard-drawer-header">
          <div><span className="eyebrow">{eyebrow}</span><h2 id={id}>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Zamknij panel">×</button>
        </header>
        <div className="dashboard-drawer-scroll">{children}</div>
      </section>
    </div>
  );
}

export function DetailMetric({ label, value, tone = '' }) {
  return (
    <div className={`dashboard-detail-metric ${tone ? `detail-${tone}` : ''}`}>
      <small>{label}</small><strong>{value || '—'}</strong>
    </div>
  );
}

export function AccessGate({ access, onLogin, onRetry, appVersion }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await onLogin(passcode);
    if (!result.ok) {
      setMessage(loginFailureMessage(result));
    } else {
      setPasscode('');
    }
    setBusy(false);
  };

  const checking = !access.checked;
  const unavailable = access.checked && access.configured === null;
  const unconfigured = access.checked && access.configured === false;
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <span className="brand-mark">C</span>
        <div><span className="eyebrow">CARLOS · MÁLAGA 2027</span><h1>{checking ? 'Sprawdzam dostęp' : unavailable ? 'Nie można sprawdzić sesji' : unconfigured ? 'Prywatny endpoint nie jest skonfigurowany' : 'Prywatny dostęp'}</h1></div>
        {checking ? <p>Łączę aplikację z bezpiecznym endpointem danych.</p> : unavailable ? (
          <>
            <p>Nie przełączam się awaryjnie na publiczny odczyt, dopóki stan prywatnego endpointu jest nieznany.</p>
            <button type="button" onClick={onRetry}>Spróbuj ponownie</button>
          </>
        ) : unconfigured ? (
          <p>Ta aplikacja nie ma publicznego fallbacku. Skonfiguruj prywatny endpoint oraz sekrety środowiska, aby otworzyć dashboard.</p>
        ) : (
          <form onSubmit={submit}>
            <p>Passcode tworzy siedmiodniową sesję HttpOnly. Nie trafia do bundla ani pamięci aplikacji.</p>
            <label><span>PASSCODE</span><input type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" required /></label>
            <button type="submit" disabled={busy}>{busy ? 'Otwieram…' : 'Otwórz dashboard'}</button>
            {message ? <small role="status">{message}</small> : null}
          </form>
        )}
        <footer>{appVersion}</footer>
      </section>
    </div>
  );
}
