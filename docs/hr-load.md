# HR load — 2026-11-18

## Scope

The Progress gauge now uses male Banister TRIMP, not sRPE. It is descriptive;
it does not change Runna prescriptions or the day-rule decision. The user
authorized deployment after initially requesting branch-only review.

## Calculation

- HRmax = 210 in `src/hrLoad.js`; resting HR from the session date:
  HR_lying_bpm, then RHR_bpm, then 50. Conflicting same-day source values use
  a visibly flagged 50 fallback rather than depending on row order.
- Per interval: dt_minutes × HRr × 0.64 × exp(1.92 × HRr),
  HRr = max(0, (HR − HRrest)/(210 − HRrest)). No premature rounding.
- Earlier trackpoint owns the interval. Last point has no duration.
  Gaps >30 s, nonpositive intervals, invalid timestamps and absent HR are
  excluded. HR must be an integer 20–250; readings >210 are retained and flagged.
  Pauses with valid HR are included; this is not movement time.
- Missing-HR points stay in the timeline: filtering them first would bridge gaps.
- A sorted histogram [HR, summed seconds] preserves the exact interval integral
  for this formula without retaining GPS. SHA256 links it to the supplied file.
  This is not authentication of the sensor or proof that a client has not edited
  measurements: the endpoint validates structure, bounds and source consistency.
- Existing Execution analysis keeps its separate 5-second gap policy unchanged.
- Without this evidence, average HR and recorded duration enter the same formula
  as an explicitly labelled estimate. Average HR is not equivalent to integrating
  the nonlinear formula. Existing zone totals cannot reconstruct TRIMP.
- Strength is exclusively sRPE (RPE × minutes), even if HR exists. Other sessions
  without HR also use sRPE, separately. Zero RPE is valid; absent RPE is not zero.

## Persistence and safety

Browser TCX preparation adds `hrLoadEvidence`. Older envelopes still work.
After ordinary TCX validation/session matching, the server reads Raw_Data and
selects HRrest. A failed source read fails closed; it must not silently select 50.
The TCX start date is checked in Europe/Warsaw against the selected session date;
a mismatch blocks the write rather than using another day's resting HR.
Only the existing Coach_Load_AU / Coach_Load_Method / Coach_Load_Notes cells are
added to the existing Training Log batch. No header migration or Raw_Data writes.
The method is BANISTER_MALE_INTERVALS_V1; notes store the histogram, TRIMP,
HRmax, selected HRrest/source/date and excluded-time diagnostics.
Existing unrelated coach-load contents are protected with a conflict, not replaced.
An identical histogram is idempotent and retains the original HRrest snapshot.
Later check-ins do not rewrite that snapshot. Average-HR estimates are calculated
from currently available same-day raw data, with source shown per session.
The offline CLI remains a target/atomic-data diagnostic, not a server-authorized
TRIMP writer. Browser import is the supported persistence path in this release.

## Windows and missingness

Today is Europe/Warsaw. Windows include today: 7 and 28 calendar days.
Acute = 7-day TRIMP sum; chronic = 28-day TRIMP sum / 4 (coupled windows).
The ratio is available from 21 calendar days of history, as explicitly requested;
21–27 days are labelled partial. Under 21: “Kalibracja X z 28 dni”. History is
elapsed time from the earliest completed logged session, capped at 28, not the
number of training days. Missing logged endurance HR blocks the ratio, while
separate strength/sRPE does not. A zero chronic denominator never yields a ratio.
No entries are assumed to mean no session; the app cannot prove import completeness.
Session HR coverage = sessions with measured/estimated TRIMP / all recorded
sessions in 28 days (including strength). It is distinct from sample-time coverage.

Bands: <0.8 low; 0.8–1.3 optimal; >1.3–1.5 warning; >1.5 high.
These are user-defined display bands, not injury probabilities or clearance to
train. Heat, hydration and stress in boxing affect HR; TRIMP cannot measure
impacts, muscle loading or technical quality.

Reference for this limitation: [Impellizzeri et al., ACWR conceptual pitfalls](https://pubmed.ncbi.nlm.nih.gov/32502973/).

## Verification

- Unit/integration tests cover a fixed numerical oracle (one minute at HR 130,
  HRrest 50, HRmax 210 → 0.8357428715 TRIMP), interval boundaries, missingness,
  source priority, conflict protection, server-selected HRrest, failed Raw_Data,
  calendar calibration, exact ratio bands and mixed sources.
- Mobile 390 px test uses synthetic data and intercepts all API requests; screenshot
  bears a visible test-data label. No real training/check-in writes in verification.
- Full test suite: 690/690 Vitest; 57/57 browser tests; production build passed.
- One initial browser fixture had duplicate normalized HR headers (empty `HR avg`
  and populated `HR_avg`); corrected the fixture, not the production parser.
- Browser screenshot: `test-results/hr-load-390.png` (excluded from git).
- Deployment verification is reported separately after release.
