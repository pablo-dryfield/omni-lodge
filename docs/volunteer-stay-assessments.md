# Volunteer stay cleaning and management assessment

Review, guiding, promotion and social-media targets retain the existing prorated
monthly defaults unless management explicitly edits a target from its milestone
card. Such edits set exact whole-stay totals in `target_overrides`, not monthly
rates. Unedited targets stay automatic; the editor can restore prorated defaults
for the selected target group. Expected-to-date progress scales the exact total
by the elapsed portion of the stay. Attendance and on-time percentages retain
their existing shared threshold, editable from their card. Edits require a reason
and the expected stay revision and are included in snapshots/audit history.

The current `/volunteer-progress` stay view uses published schedule assignments,
not a monthly cleaning quota. Arrival is inclusive; departure is exclusive.
Each physical cleaning shift counts once. Future published assignments count
toward the requirement; unexcused missed shifts remain outstanding after the
stay ends. Removed assignments and manager-excused shifts are excluded.
Photo-managed cleaning requires approved, identity-matched submissions; ordinary
cleaning shifts require manager-confirmed attendance. Standalone task logs cannot
inflate the number of completed shifts. No assigned cleaning is not an automatic
star: management may record a reasoned waiver, valid only for that stay window
and while the assignment count remains zero.

Progress is live: 0/1 -> 1/1 -> 1/2 -> 2/2. An earned cleaning star can return to
in progress after another assignment is published. Historical monthly target
values are retained for compatibility; `monthlyTargets.cleaningTasks` no longer
controls stay cleaning progress. The legacy explicit-calendar-period API is
retained separately and is not the current stay UI.

The management star is independent of the other four stars. Reviewers are people
assigned the Manager/Assistant Manager shift role on the same physical shifts
that the volunteer attended (including late attendance), within the saved stay.
Account role alone, same-day shifts and matching template names are not enough.
Roles/assignments are deduplicated; each reviewer gets one vote regardless of
shared-shift count. The roster and counts update from the published schedule.

Every non-waived reviewer must submit written feedback and thumbs up/down.
Only that reviewer can submit/edit their vote. Pending feedback blocks the
decision, not as a negative vote. Once complete, up >= down earns the star
(ties are positive). Votes and reviewer waivers are bound to the saved stay's
exact date window. Changing those boundaries requires fresh decisions; previous
evidence remains in the revision history.

Only owner/admin may waive an unavailable reviewer, with a required reason.
Waived reviewers are excluded, not converted to positive votes. If no actual
votes can be collected (no reviewers, or all waived), owner/admin must provide
an explicit written thumbs-up/down assessment. This fallback cannot bypass
active reviewers and is invalidated by a reviewer-waiver change. Neither a
volunteer nor a manager can assess their own stay.

Writes require volunteer-progress update access and authorized management roles,
an expected stay revision, and an atomic repeatable-read transaction. Every edit
creates a new stay snapshot and audit entry containing actor, reason, and time.
Old generic feedback remains visible as history, never fabricated into a vote.
The previous stay direct-approval endpoint cannot bypass automatic voting.
Reviewer photos use a private, authenticated route scoped to the volunteer's
actual reviewer roster; storage paths are never returned in progress JSON.

This release does not extend saved stays to profile departure dates, submit any
manager votes/waivers, alter staff payments, or mark attendance on anyone's behalf.
