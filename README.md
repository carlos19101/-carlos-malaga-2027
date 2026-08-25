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

## Ważne

Ta wersja realizuje pakiet poprawek integralności danych, offline, iOS safe-area, touch targets, WCAG i service workera. Migracja z publicznego CSV do prywatnego Google Sheet przez uwierzytelnione Vercel API jest kolejnym etapem i nie jest częścią tego patcha.
