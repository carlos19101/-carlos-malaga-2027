# Dziennik decyzji — metodologia

Dziennik jest widokiem tylko do odczytu. Buduje chronologię z `Coach_Status` i `Coach_Decision` w `Raw_Data`, nie tworzy nowej opinii i nie modyfikuje werdyktu sztabu.

## DOWODY

Do decyzji dołączane są tylko prawidłowe pomiary z tego samego dnia, których `Timestamp` nie jest późniejszy niż czas decyzji. Dzięki temu późniejszy pomiar nie poprawia wstecz uzasadnienia. Przy jednakowym czasie źródło Garmin ma pierwszeństwo dla fizjologii, a `User` dla bólu, DOMS i zmęczenia. Sprzeczny remis o tym samym priorytecie jest pomijany i raportowany.

Obecny kontrakt obejmuje sen, HRV, RHR, Readiness, Body Battery, ból, DOMS i zmęczenie. Brak wartości pozostaje brakiem danych.

## REKOMENDACJA

Tekst jest cytatem z `Coach_Decision`. Aplikacja nie rozdziela go sztucznie na interpretację i rekomendację, ponieważ obecny schemat źródła nie posiada dwóch osobnych pól.

## Integralność decyzji

Prawidłowy wpis sztabu zawiera parę `Coach_Status` oraz `Coach_Decision`. Jeśli jedno z pól jest puste, aplikacja zachowuje dostępny fragment jako zapis historyczny, ale pokazuje ostrzeżenie `DZIENNIK DECYZJI — wpis sztabu wymaga uzupełnienia`. Jest to sygnał integralności danych, nie automatyczna zmiana decyzji treningowej.

## Audyt

```bash
npm run journal:audit -- --sheet-id <SPREADSHEET_ID> --limit 4
```
