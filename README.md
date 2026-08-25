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

## Ważne

Ta wersja realizuje pakiet poprawek integralności danych, offline, iOS safe-area, touch targets, WCAG i service workera. Migracja z publicznego CSV do prywatnego Google Sheet przez uwierzytelnione Vercel API jest kolejnym etapem i nie jest częścią tego patcha.
