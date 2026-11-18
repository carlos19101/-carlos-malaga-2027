# Glass UI V1 — lokalny przegląd, 18.11.2026

## Status

Gałąź: `feat/glass-ui`. Bez scalenia, push i wdrożenia. Bez zapisów do produkcyjnego arkusza.

Krok B jest osobnym commitem `3e518ef`: czysta reguła dnia i 20 testów. Redesign korzysta z jej wyniku; nie dodaje nowych endpointów ani kolumn arkusza.

## Co wykonano

- React: Dziś, Postęp, pływająca nawigacja Dziś / Tydzień / Postęp / Log. EPA pozostaje dostępne przez Postęp jako archiwum.
- Wspólne tokeny, szkło, trzy tła, lokalne fonty z licencjami, animacje CSS, reduced-motion i fallback bez backdrop-filter.
- Decyzja: brak pomiaru, kalibracja, niepełny pomiar, kolory oraz dowody z reguły B. Norma nie zawiera ocenianego dnia.
- Istniejący check-in: przecinek dziesiętny, trzy stany samopoczucia, opcjonalna edycja zapisanego pomiaru. Nie dodano zapisu porannej bolesności ani skali 1–5.
- Zamknięcie treningu: istniejący feedback i kolejka, RPE 1–10, ból i nogi. Tylko rzeczywisty, jednoznaczny dzisiejszy bieg; przy braku importu przejście do Logu. Otwarcie niczego nie zapisuje.
- Tydzień: zapis aktywności odróżniony od planowanego terminu; stały boks we wtorki/czwartki nie staje się dowodem wykonania.
- Postęp: rzeczywiste biegi około 10 km (±50 m, bez przeliczania) i najdłuższy zapisany bieg tygodnia. Wybór punktów przez przyciski, cel opisany oddzielnie.
- Obciążenie korzysta z istniejących funkcji sRPE; brak kompletności oznacza brak wskaźnika. To nie Garmin Load ani prognoza urazu.
- Odstęp nad dolnym paskiem uwzględnia safe area. Kontrolowano szerokości 320, 390 i 1024 px.

## Świadome ograniczenia danych

- Nie dodano fikcyjnych godzin posiłków, suplementów ani snu z makiet. Są opisane jako nieustawione.
- Brak dostępnej trwałej analizy odcinków TCX dla dryfu tempa: karta jawnie pusta, bez wyliczania ze średniej HR.
- Cele 1:45, 4:58/km, 47:30 i 18 km są celami projektu, nie prognozami. Odliczanie 16 tygodni nie udaje numeru tygodnia Runny.
- Sygnały dnia mają paski obecności sygnału, nie pozorny procent gotowości.
- Zdjęcia przeglądu używają wyłącznie syntetycznych danych testowych. Nie opisują aktualnej formy użytkownika.

## Weryfikacja

- Krok B: 20/20 testów.
- Vitest: **658/658 PASS** po zatwierdzonej przez użytkownika stabilizacji zegara testowego. Podczas pierwszego przebiegu 18.11 istniejący test traktował 18.11 jako przyszłość i nie zamrażał zegara. W `test/api/dailyCheckin.test.js` ustawiono stały czas 17.11 oraz przywracanie prawdziwego zegara po teście. Asercje i kod API nie zostały zmienione.
- Nowy widok + istniejące testy dostępu i importu Stravy: 16/16 PASS, bez rzeczywistych zapisów. Test zapisu check-inu przechwytuje POST lokalną atrapą odpowiedzi.
- Pełny przebieg starszych scenariuszy E2E: 20/54 PASS, 34 błędy. Dawne scenariusze szukają `Plan`, `EPA`, wielkich nagłówków oraz sekcji obecnie zwiniętych. Nie usunięto ani nie osłabiono tych testów. Potrzebna zgoda na migrację ścieżek klikania, następnie ponowny pełny przebieg; nie traktować tego jako pełnej zielonej regresji.
- Build PASS: JS 435,12 kB / gzip 138,43 kB; CSS 118,67 kB / gzip 23,14 kB. Fonty lokalne, bez nowej biblioteki wykresów/animacji.
- Zrzuty 390 px: Dziś, Postęp, oba stany puste, dół formularza. Testy sprawdzają brak poziomego przepełnienia i dostęp do przycisku zapisu nad nawigacją.
- Sprawdzone Chromium; nie deklarujemy testu na fizycznym iPhonie ani pełnego audytu WCAG.

## Przed scaleniem

1. Po zgodzie: dostosować wyłącznie ścieżki UI w dotychczasowych E2E, zachowując asercje danych.
2. Zrobione po zgodzie: zamrożono zegar w istniejącym teście API check-inu; pełne 658 testów przechodzi.
3. Powtórzyć pełne testy i build oraz pokazać wyniki.
4. Dopiero po odrębnej zgodzie użytkownika scalić i wdrożyć. Teraz produkcja pozostaje bez zmian.

Lokalny QA bez uruchamiania drugiego serwera: ustaw `CARLOS_E2E_PORT` na port działającego Vite preview, uruchom Playwright z `--config=test/glass-playwright.config.cjs`. Konfiguracja ta nie zmienia zwykłego `playwright.config.cjs` i nie kieruje testów na produkcję.
