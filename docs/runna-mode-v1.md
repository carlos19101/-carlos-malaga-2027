# Runna mode — 24 September 2026

User-approved prospective policy: Runna alone prescribes running. CARLOS records execution, feedback, boxing and recovery; it must not issue a competing current running verdict.

- The Warsaw calendar cutoff is 2026-09-24, not the date of import. Earlier sessions retain their original targets and scoring.
- Dziś shows the local Runna copy with explicit provenance. Missing copy/date coverage is not a rest day, zero or GO. A day without a run is labelled only as absence in the copy.
- The copy is manually imported JSON. There is no Runna account/API sync. Tempo, repetitions, rest and HR targets are not present; full instructions remain in Runna.
- Current CARLOS coach/EPA recommendations are retired. EPA is an explicitly dated historical archive through 23 September, not a current prescription. Current factual activity data and Strava remain in Log.
- The old sheet remains unchanged and available as archive/boxing context. JointPlanner move proposals are disabled after cutoff. No activity is automatically matched by date.
- Data freshness, transport failures, daily validation (including recent weight fallback), aggregate Verifier and activity timestamp checks remain visible. Runna's plan is not proof of physical readiness.
- Running Execution after cutoff returns no-target, not OVER/UNDER against legacy sheet targets. The target-scored TCX picker excludes these sessions; scalar, staged and direct server reconciliation reject them based on the stored session date. Client-provided target provenance cannot bypass this.
- Feedback remains usable; the UI does not call new sessions fully reconciled when the Runna target link is absent. Historical TCX imports remain supported.

## Recurring boxing and factual summary — follow-up

Tuesday and Thursday 20:00–22:00 Europe/Warsaw are standing user-confirmed appointments, independent of Runna/local JSON. They remain visible after removing the copy. A daily boxing card is displayed even when running coverage is missing. Runna-mode settings no longer hide these fixed anchors. Same-day runs are shown alongside boxing without rescheduling or assuming time overlap (Runna copy has no start time).

Appointments never generate DONE, recorded duration, sRPE or attendance. The current seven-day factual Training Log summary remains available under a disclosure. Downloading Strava activities without saving them does not populate this summary. Missing history remains explicitly missing, not two completed boxing sessions inferred from the calendar.

## Remaining integration boundary

A server-verifiable Runna session identity plus the full prescribed target is needed before new target-scored TCX writes can resume. Implementing that contract is a separate follow-up, not a hidden substitution with the old Plan. Objective Strava results remain viewable; the existing Strava running-to-Training-Log importer is still not implemented. No external sheet data were rewritten by this release.

## Checks

Unit tests cover cutoff/timezone, history, absent copy vs empty day, no legacy scoring and all TCX reconciliation paths. Browser tests cover current screen, import/removal, archive, missing data and mobile width. Existing pre-cutover tests continue to run.
