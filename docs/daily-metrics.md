# Daily Metrics — metodologia

Daily Metrics normalizuje wiele wpisów `Raw_Data` do jednego rekordu dziennego dla HRV, RHR, snu i wagi. Moduł nie wykonuje dodatkowego zapytania w aplikacji: istniejący odczyt `Raw_Data` pobiera kolumny `Date`, `Timestamp`, `Weight_kg`, `RHR_bpm`, `HRV_night_ms`, `Sleep_min`, `Sleep_score` i `Source`.

## Reguła wyboru

Każde pole jest rozstrzygane osobno. Wygrywa najnowszy prawidłowy `Timestamp`. Priorytet źródła działa wyłącznie przy identycznym czasie: dla fizjologii preferowany jest `Agent Garmin`, a dla wagi `User`. Sprzeczne wartości o tym samym czasie i priorytecie są błędem integralności i nie są wybierane arbitralnie.

## Baseline

- okno: 30 dni poprzedzających oceniany dzień;
- oceniany dzień nigdy nie zanieczyszcza własnego punktu odniesienia;
- minimum: 28 dni historii i 14 prawidłowych próbek danej metryki;
- rozproszenie: odchylenie standardowe próby;
- przed spełnieniem obu minimów aplikacja pokazuje `KALIBRACJA`, nie z-score;
- coverage historii wynika z rozpiętości kalendarzowej, a nie liczby dni treningowych lub liczby wpisów.

## Reguła pomostowa przed kalibracją

Dopóki baseline HRV i RHR nie jest gotowy, trzy kolejne dni z rosnącym RHR i spadającym HRV tworzą tymczasowy sygnał do rozważenia `MODIFY`. Reguła jest jawnie oznaczona jako podatna na szum, wymaga samopoczucia i rozgrzewki jako potwierdzenia oraz nigdy samodzielnie nie wydaje `STOP`. Luka dnia albo brak HRV/RHR wyłącza sygnał. Po kalibracji obu baseline'ów reguła pomostowa przestaje działać.

## Integralność

Jawnie raportowane są: wiersze bez daty, nieczytelny czas, rozjazd `Date`/`Timestamp`, wartości poza zakresem, sprzeczny remis i co najmniej dwudniowa luka w `Raw_Data`. Zwykła aktualizacja odczytu w ciągu dnia jest informacją, a nie alarmem.

## Audyt z danymi na żywo

```bash
npm run metrics:daily -- --sheet-id <SPREADSHEET_ID> --date 2026-08-25
```

Raport nie publikuje niedojrzałej średniej ani odchylenia. Przed zakończeniem kalibracji pokazuje wyłącznie stan, liczebność próby i coverage.
