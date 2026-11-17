# Poranny check-in — A / V1

Check-in zapisuje poranny pomiar i samopoczucie dla wybranej daty. Nie wydaje rekomendacji treningowej.

## Raw_Data contract

New columns appended after the existing `Health_status` column:

| Kolumna | Znaczenie |
| --- | --- |
| `HRV_orthostatic_rMSSD_ms` | Morning rMSSD from the orthostatic measurement, lying down |
| `HR_lying_bpm` | Heart rate while lying down; kept separate from legacy Garmin `RHR_bpm` |
| `HR_standing_bpm` | Heart rate while standing |
| `Wellbeing` | `GOOD`, `NORMAL`, or `BAD` |
| `Symptom_Dizziness` | `YES` or `NO` when a check-in was saved |
| `Symptom_Palpitations` | `YES` or `NO` when a check-in was saved |
| `Symptom_Chest_Pain` | `YES` or `NO` when a check-in was saved |
| `Symptom_Illness` | `YES` or `NO` when a check-in was saved |
| `Checkin_Saved_At` | Server-side ISO timestamp of the latest save |
| `Checkin_Source` | `MANUAL_MORNING_CHECKIN` |

Istniejące kolumny `Sleep_min`, `Weight_kg` oraz `HRV_night_ms` są używane dla odpowiadających im pól opcjonalnych. Nocne HRV Garmina nie jest łączone z ortostatycznym rMSSD. Puste pola liczbowe są pomijane przy zapisie, a nie zastępowane zerem. Istniejące `Timestamp`, `Source` i `RHR_bpm` nie są nadpisywane.

## Save path

`DailyCheckin` na ekranie „Dziś” → żądanie same-origin `POST /api/daily-checkin` → kontrola Origin, sesji, treści i trwałego limitu per klient → `validateDailyCheckin` → `updateDailyCheckin` → service account Google Sheets.

Endpoint aktualizuje wyłącznie przekazane pola check-inu w ostatnim istniejącym wierszu z daną datą ISO. Jeśli takiego wiersza nie ma, dopisuje jeden z pustymi, niezwiązanymi polami. Nie usuwa duplikatów ani nie przepisuje historii. Limit per klient wynosi 12 żądań w 10 minut; kolejne próby są blokowane na 10 minut.

## Out of scope

Poza zakresem: decyzja zielony/żółty/czerwony, obliczanie baseline'u, przeliczanie danych Garmina na ortostatyczne, ekran „Zamknij trening” i automatyczna modyfikacja treningu.
