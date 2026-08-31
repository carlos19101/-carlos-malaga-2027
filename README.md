# CARLOS — MÁLAGA 2027

PWA React/Vite do monitorowania treningu i regeneracji zasilana Google Sheets.

## Dane

- `APP_FEED`
- `Training Log`
- `Plan`
- `Raw_Data`

Produkcja działa na arkuszu `Restricted`. Po zalogowaniu siedmiodniową sesją HttpOnly aplikacja pobiera cztery tabele przez prywatny endpoint Vercela i Google Sheets API. Transport używa `cache: no-store`, timeoutu `AbortController`, prywatnego last-known-good w `localStorage` i jawnego mapowania pól exact-match.

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

Importer jest dostępny w zakładce Log. Analizuje TCX lokalnie, pokazuje podgląd, dopasowuje sesję po `Session_ID` i sprawdza konflikty. Obsługuje pojedynczy cel HR (v1) oraz cel etapowy weryfikowany z Planem (v2); może też uzupełnić brakującą godzinę sesji. Zakres zapisu i granice idempotencji: [`docs/tcx-import.md`](docs/tcx-import.md).

## Daily Metrics

Silnik normalizuje wiele wpisów `Raw_Data` do wartości dziennych, wyklucza oceniany dzień z baseline'u i pozostaje w stanie `KALIBRACJA` do zebrania 28 dni historii oraz minimum 14 próbek metryki. Metodologia i audyt danych na żywo: [`docs/daily-metrics.md`](docs/daily-metrics.md).

## Dziennik decyzji

Dashboard pokazuje chronologię werdyktów Head Coacha wraz z dowodami, które faktycznie istniały w chwili decyzji. Reguły czasowe i komenda audytowa: [`docs/decision-journal.md`](docs/decision-journal.md).

## Oceń bieg

Ścieżka zapisu aktualizuje istniejącą sesję po `Session_ID`, przelicza sRPE, ma idempotencję, kolejkę offline oraz siedmiodniową sesję HttpOnly. Kontrakt, zachowanie błędów i konfiguracja endpointu: [`docs/training-feedback.md`](docs/training-feedback.md).

## Strava

Opcjonalne połączenie OAuth odczytuje prywatne podsumowania ostatnich aktywności wyłącznie po zatwierdzeniu przez użytkownika. Odświeżalny token pozostaje zaszyfrowany w cookie `HttpOnly`; aktywności nie są automatycznie zapisywane ani łączone z `Training Log`. Konfiguracja wymaga `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` i `STRAVA_TOKEN_SECRET`, a w panelu Stravy callback domain `carlos-malaga-2027.vercel.app`. Pełna instrukcja: [`docs/strava.md`](docs/strava.md).

## Panel Sztabu

Dashboard rozdziela dowody, interpretację i rekomendację czterech ról CORE. Specjaliści warunkowi pojawiają się tylko po spełnieniu jawnego warunku, a `SPÓR` tylko przy rzeczywiście różnych kierunkach domeny i Head Coacha. Metodologia i granice: [`docs/staff-panel.md`](docs/staff-panel.md).

## Elite Performance Academy

Zakładka EPA łączy dopasowaną aktywność Stravy, `Training Log`, atomowe dane TCX/Execution i odczucia zawodnika. Pokazuje pełny katalog 10 trenerów oraz 8 case studies zawodników, ale bez zweryfikowanej karty źródłowej jawnie zwraca `BRAK PODSTAW` zamiast tworzyć przypisaną nazwisku opinię. EPA nie nadpisuje Głównego Trenera, a strefy CARLOS pozostają dostępne w rozwijanym panelu. Kontrakt i granice: [`docs/epa.md`](docs/epa.md).

## Prywatny odczyt

Globalna sesja HttpOnly udostępnia cztery tabele wyłącznie przez uwierzytelniony endpoint Vercela i Google Sheets API. Aplikacja nie ma publicznego fallbacku `gviz`. Zasady snapshotu oraz konfiguracji: [`docs/private-data.md`](docs/private-data.md).

## Ważne

Produkcja raportuje `configured:true`, a publiczny dostęp do arkusza jest wyłączony. Jeśli prywatny endpoint nie jest skonfigurowany, aplikacja nie wyświetla danych.
