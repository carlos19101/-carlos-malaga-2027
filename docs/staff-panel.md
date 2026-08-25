# Panel Sztabu

Panel jest odczytową konsultacją domenową. Nie tworzy nowych pomiarów, nie głosuje nad treningiem i nie nadpisuje werdyktu Head Coacha z `APP_FEED`.

## Role CORE

1. `RUNNING COACH` — zestawia dzisiejszy Plan z atomowym statusem ostatniego Execution.
2. `PHYSIOLOGIST` — pokazuje HRV, RHR, stan baseline'u i jawną regułę pomostową.
3. `MUSCULOSKELETAL / RECOVERY` — oddziela deklaracje bólu, DOMS i zmęczenia od braku deklaracji.
4. `LOAD & INTEGRATION` — pokazuje obciążenie 7/28 dni i pozostawia load ratio w kalibracji do 28 dni dostępności.

Każda rola ma trzy osobne części: `DOWODY`, `INTERPRETACJA`, `REKOMENDACJA`.

## Specjaliści warunkowi

`DATA STEWARD` pojawia się tylko, gdy istnieje co najmniej jeden aktywny problem: brak lub podejrzana wartość wymagana, rozbieżność Verifiera, ostrzeżenie/błąd `Raw_Data`, nieświeże źródło albo `DATA ERROR` w Execution.

Brak specjalisty warunkowego nie oznacza opinii pozytywnej. Oznacza wyłącznie, że jego warunek uruchomienia nie wystąpił.

## SPÓR SZTABU

Kierunek Head Coacha jest mapowany jawnie: `GREEN → GO`, `YELLOW → MODIFY`, `RED → STOP`.

`SPÓR` pojawia się wyłącznie wtedy, gdy rola domenowa ma jawną rekomendację kierunkową inną niż Head Coach. Sam stan kalibracji, brak danych, status ostatniego Execution lub kontekst obciążenia nie są sztucznie zamieniane w głos `GO/MODIFY/STOP`.

Panel nie rozstrzyga sporu automatycznie. Wymaga jawnego uzasadnienia, a właścicielem końcowej decyzji pozostaje Head Coach.

## Granice

- panel nie diagnozuje objawów medycznych;
- nie szacuje czasu w HR na podstawie średniego tętna;
- nie pokazuje z-score przed gotowym baseline'em;
- brak deklaracji zawodnika nie jest interpretowany jako zero;
- ostatnie `OVER` jest kontekstem wykonania, a nie samodzielną zmianą dzisiejszego planu.
