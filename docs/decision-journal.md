# Dziennik decyzji — metodologia

Dziennik jest widokiem tylko do odczytu. Buduje chronologię z `Coach_Status` i `Coach_Decision` w `Raw_Data`, nie tworzy nowej opinii i nie modyfikuje werdyktu sztabu.

## DOWODY

Do decyzji dołączane są tylko prawidłowe pomiary z tego samego dnia, których `Timestamp` nie jest późniejszy niż czas decyzji. Dzięki temu późniejszy pomiar nie poprawia wstecz uzasadnienia. Przy jednakowym czasie źródło Garmin ma pierwszeństwo dla fizjologii, a `User` dla bólu, DOMS i zmęczenia. Sprzeczny remis o tym samym priorytecie jest pomijany i raportowany.

Obecny kontrakt obejmuje sen, HRV, RHR, Readiness, Body Battery, ból, DOMS i zmęczenie. Brak wartości pozostaje brakiem danych.

## REKOMENDACJA

Tekst jest cytatem z `Coach_Decision`. Aplikacja nie rozdziela go sztucznie na interpretację i rekomendację, ponieważ obecny schemat źródła nie posiada dwóch osobnych pól.

## Integralność decyzji

`Coach_Status` jest znacznikiem decyzji dnia. Wpis z tekstem w `Coach_Decision`, ale bez statusu, jest notatką (np. post-run) i nie trafia do dziennika decyzji. Gdy status istnieje, ale brakuje `Coach_Decision`, aplikacja zachowuje ten zapis historyczny i pokazuje ostrzeżenie `DZIENNIK DECYZJI — wpis sztabu wymaga uzupełnienia`. Jest to sygnał integralności danych, nie automatyczna zmiana decyzji treningowej.

## Chronologia wykonania

Sesję traktujemy jako wykonanie po decyzji tylko wtedy, gdy `Training Log.Time` jest czytelne i wypada po `Raw_Data.Timestamp` decyzji tego samego dnia. Sesja wcześniejsza albo bez godziny pozostaje widoczna, ale nie zasila kalibracji reakcji decyzji. Dzięki temu aplikacja nie myli zwykłej zbieżności dat z następstwem decyzji.

Dashboard raportuje też brakującą lub nieczytelną godzinę `Time` dla sesji biegowych w `Training Log`, aby problem dało się poprawić w źródle danych, zanim zacznie blokować kolejne obserwacje. Wpis regeneracyjny albo siłowy nie jest błędem wyłącznie dlatego, że nie ma godziny startu.

## Audyt

```bash
npm run journal:audit -- --sheet-id <SPREADSHEET_ID> --limit 4
```
