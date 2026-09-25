# Weekly evidence and selectable run feedback — 25 September 2026

Scope: read-only weekly aggregation and selecting a run for the existing explicit feedback workflow. No schema migration, training-plan change, automated import or production record rewrite.

## Feedback selection

The selector uses all loaded Training Log rows, not only the 30 history cards. Only running rows with a valid, unique Session_ID are selectable. Duplicate IDs across any activity types are excluded to avoid editing an arbitrary row. Default is newest run; an explicit selection survives source refresh while its ID remains available. Existing per-session local drafts are preserved. Selection is disabled while the feedback form is submitting; each selected session mounts its own form instance.

This is not a new boxing feedback workflow. Existing RPE/pain/leg-fatigue validation and private write endpoints remain unchanged. A loaded record is not proof of full Runna target compliance.

## Rolling seven-day summary

This is the last seven calendar days, not a Monday–Sunday plan comparison. Only Training Log records are evidence. Scheduled boxing does not create 120 minutes of performed activity. A known activity type with missing metrics remains an incomplete session, not an absent session. Explicit type wins over a title; mobility named strength is not double counted. Recovery without any positive activity metrics remains excluded from active-session denominators.

Running distance and duration must be positive to count as available evidence. All missing values render as unavailable; partial distances remain labelled partial. Undated rows stay visible as a quality warning even when there is no dated activity in the window.

Boxing minutes are summed only from positive recorded durations, with a known-duration count and partial status. Duration is the existing stored duration; this change does not invent actual club duration or alter the recorded/moving provenance written by imports.

RPE coverage = sessions with RPE in [1,10] / active recorded sessions. Fractional historical RPE is retained, not rounded to a fabricated integer. Average RPE uses only that subset and is shown with coverage, not as a readiness verdict.

Usable sRPE requires positive duration, valid RPE, and nonnegative stored sRPE within 1 unit of duration-in-minutes × RPE (rounding tolerance). Invalid or inconsistent values are excluded, counted and not overwritten. The sum is null when no usable evidence exists; otherwise partial unless every active recorded session qualifies. Completeness is only among recorded sessions, never a claim that every real workout was logged. This display does not repair the sheet or change other decision-engine load calculations.

## Verification

Unit tests cover missing/invalid/partial RPE, rounded sRPE, contradictory totals, missing/negative distances, missing boxing durations, category separation, undated rows, duplicate feedback IDs and older candidates. Browser tests use the real values-table response shape with synthetic records, verify mobile layout, separate drafts and zero writes during selection.
