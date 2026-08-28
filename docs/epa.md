# Elite Performance Academy (EPA)

EPA jest warstwą interpretacji dowodów, a nie drugim Głównym Trenerem.

## Źródła danych

- Strava: dystans, czas ruchu oraz HR, jeśli aktywność je udostępnia.
- `Training Log`: opis sesji, RPE, ból i zmęczenie nóg.
- TCX / Execution: atomowy czas poniżej, w i powyżej zapisanego celu HR.
- `APP_FEED`: faza przygotowań i bieżący werdykt Głównego Trenera.

Odczyt Stravy jest wykonywany po wejściu do zakładki EPA i niczego nie zapisuje. Aktywność musi zostać dopasowana do sesji `Training Log` przez istniejący kontrakt rekonsyliacji.

## Granice

1. Brak wartości pozostaje brakiem danych; interfejs nie rysuje `0%`.
2. Nazwiska trenerów są perspektywami roboczymi. Bez zweryfikowanej karty źródłowej EPA pokazuje `BRAK PODSTAW` i nie przypisuje trenerowi opinii.
3. Zawodnicy są wyłącznie potencjalnymi studiami przypadku. Nie głosują i nie oceniają CARLOS.
4. EPA nie zwraca decyzji treningowej, nie zmienia kierunku Sztabu i nie nadpisuje Głównego Trenera.
5. Kotwice i strefy CARLOS pozostają źródłem Execution i są dostępne w rozwijanym panelu na dole EPA.

## Warunek dalszego rozwoju

Perspektywa może przejść z `BRAK PODSTAW` do oceny dopiero po dodaniu wersjonowanej karty źródłowej z opisem metody, pasującym problemem i kryteriami transferowalności do CARLOS. Sama rozpoznawalność nazwiska nie jest dowodem.
