# CARLOS — MÁLAGA 2027

PWA React/Vite do monitorowania treningu i regeneracji zasilana Google Sheets.

## Dane

- `APP_FEED`
- `Training Log`
- `Plan`

Aplikacja pobiera CSV przez Google `gviz`, używa `cache: no-store`, parametru cache-busting, timeoutu `AbortController`, last-known-good w `localStorage` i jawnego mapowania pól exact-match.

## Uruchomienie

```bash
npm install
npm run dev
```

## Testy

```bash
npm test
npm run build
```

## Analiza TCX

Wersjonowany analizator TCX oblicza atomowe czasy wykonania na podstawie rzeczywistych odstępów między próbkami HR. Metodologia, komenda i oczyszczony przypadek kontrolny są opisane w [`docs/tcx-methodology.md`](docs/tcx-methodology.md).

Idempotentny importer dopasowuje sesję po `Session_ID`, blokuje konflikty i generuje precyzyjny zapis atomów do Training Log. Instrukcja: [`docs/tcx-import.md`](docs/tcx-import.md).

## Daily Metrics

Silnik normalizuje wiele wpisów `Raw_Data` do wartości dziennych, wyklucza oceniany dzień z baseline'u i pozostaje w stanie `KALIBRACJA` do zebrania 28 dni historii oraz minimum 14 próbek metryki. Metodologia i audyt danych na żywo: [`docs/daily-metrics.md`](docs/daily-metrics.md).

## Dziennik decyzji

Dashboard pokazuje chronologię werdyktów Head Coacha wraz z dowodami, które faktycznie istniały w chwili decyzji. Reguły czasowe i komenda audytowa: [`docs/decision-journal.md`](docs/decision-journal.md).

## Oceń bieg

Ścieżka zapisu aktualizuje istniejącą sesję po `Session_ID`, przelicza sRPE, ma idempotencję, kolejkę offline oraz siedmiodniową sesję HttpOnly. Kontrakt, zachowanie błędów i konfiguracja endpointu: [`docs/training-feedback.md`](docs/training-feedback.md).

## Panel Sztabu

Dashboard rozdziela dowody, interpretację i rekomendację czterech ról CORE. Specjaliści warunkowi pojawiają się tylko po spełnieniu jawnego warunku, a `SPÓR` tylko przy rzeczywiście różnych kierunkach domeny i Head Coacha. Metodologia i granice: [`docs/staff-panel.md`](docs/staff-panel.md).

## Prywatny odczyt

Po konfiguracji service account i sekretów globalna sesja HttpOnly zastępuje publiczny `gviz` jednym uwierzytelnionym endpointem Vercela dla czterech arkuszy. Zasady bezpiecznego przełączenia, snapshotu i aktywacji produkcyjnej: [`docs/private-data.md`](docs/private-data.md).

## Ważne

Kod prywatnego transportu jest wdrożony kompatybilnie wstecz. Dopóki produkcja raportuje `configured:false`, aplikacja używa publicznego `gviz`. Pełne zamknięcie wymaga ustawienia sekretów, pozytywnego smoke-checku i ręcznego odebrania publicznego dostępu do Google Sheet.
