# Controlled Strava running import — 25 September 2026

Extends the existing authenticated import to source types Run, TrailRun and VirtualRun. The server fetches the selected activity again from Strava; client distance, duration and HR are not accepted.

## Evidence and missing values

- Local start date/time from `start_date_local` is required for runs. UTC start is not silently relabelled local. Hour 24+ is invalid.
- Positive distance, positive duration <=24 hours. Prefer elapsed_time (whole activity including stops); otherwise moving_time is explicitly recorded as a proxy in Notes. UI shows both durations.
- Existing HR avg / HR max columns (underscore aliases accepted) hold disclosed plausible HR. Missing, zero or withheld HR remains blank. Inverted average/max or implausible values block import.
- RPE may be absent for a run; RPE and sRPE stay blank. Supplied RPE must be an integer 1–10. sRPE uses the stored duration in minutes, with duration source in Notes. Pain and fatigue remain blank.
- No HR target, time-in-zone, Runna identity or target compliance is invented. DONE means activity recorded, not target achieved or feedback complete. Pace is left blank rather than silently mixing moving and elapsed semantics.

## Writes and duplicate protection

Explicit user confirmation per activity. No automatic bulk write. Existing auth/origin guards and RAW Sheets writes remain unchanged.

Deterministic Session_ID = strava-{activityId}. Repeated sequential import is a noop; multiple existing same IDs block. A run of the same date under another ID (e.g. TCX), or an undated run, blocks append for review. No existing objective evidence or feedback is overwritten. Two genuinely distinct runs on the same day need a later explicit disambiguation workflow, not bypassing this guard.

The browser prevents concurrent submissions in its component. **Google Sheets read-then-append is not a transaction**: concurrent calls from separate tabs/instances can still race. This release does not claim globally exactly-once writes. A durable transactional idempotency store is required before unattended/background or multi-client import. On an unknown network result the UI asks for a refresh, not falsely stating that no write occurred.

Existing schema is required; missing/duplicate headers fail closed without creating columns. The daily Runna policy and Tuesday/Thursday boxing calendar are unchanged.

## Verification boundary

Unit/API/browser tests use synthetic activities and mocked writes. Production verification reads deployed assets and UI only; no training entry is fabricated to smoke-test the write path. Actual activity save remains user-confirmed.
