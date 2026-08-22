# CARLOS — MÁLAGA 2027

React + Vite PWA w stylistyce premium dark inspirowanej aplikacjami treningowymi klasy Whoop / Apple Fitness. Aplikacja agreguje dane treningowe z Google Sheets i pokazuje je w czterech zakładkach: **Dashboard**, **Strefy**, **Log** i **Plan**.

## Dane

Źródło danych:

- Google Sheets ID: `1FoExswYMSy5Ou2HwyzPd3bWgnplWgfPGCd5scC0lCXM`
- główny arkusz: `APP_FEED`
- dodatkowe arkusze: `Training Log`, `Plan`

Aplikacja pobiera każdy arkusz jako CSV przez publiczny endpoint Google Visualization (`gviz`). Każde żądanie używa parametru cache-busting oraz `cache: no-store`.

Arkusz musi być dostępny do odczytu przez link / publicznie. Projekt nie wymaga i nie zawiera haseł, tokenów, kluczy API ani innych sekretów.

## Odświeżanie

Dane są odświeżane:

1. po pierwszym otwarciu aplikacji,
2. po powrocie aplikacji na pierwszy plan (`visibilitychange`),
3. po kliknięciu przycisku **Refresh**.

Błędy pojedynczego arkusza nie blokują pozostałych sekcji — aplikacja zachowuje i wyświetla dane z arkuszy, które udało się pobrać.

## PWA

Projekt zawiera manifest, ikonę SVG i service workera. Service worker buforuje shell aplikacji i statyczne zasoby, ale celowo nie buforuje odpowiedzi Google Sheets, aby dane treningowe mogły pozostać świeże.

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

## Build produkcyjny

```bash
npm run build
npm run preview
```

Build używa `--base=./`, dzięki czemu statyczne pliki mogą działać również po wdrożeniu pod ścieżką repozytorium (np. GitHub Pages).

## Struktura

```text
.
├── package.json
├── index.html
├── README.md
├── public/
│   ├── manifest.webmanifest
│   ├── icon.svg
│   └── sw.js
└── src/
    ├── main.jsx
    └── styles.css
```
