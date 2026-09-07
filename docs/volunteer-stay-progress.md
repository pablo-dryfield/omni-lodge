# Volunteer Progress: stay-based targets

## Scope

The default Volunteer Progress report uses a manager-confirmed stay, not calendar-month resets. Explicit `period=YYYY-MM` reports retain the existing monthly calculations and feedback for historical inspection.

A stay stores its own arrival/departure dates, position, monthly target rates and eligible shift-type IDs. Changing the user's current staff profile or arrival/departure fields does not silently rewrite a saved stay. Profile dates are suggestions when a manager creates an agreement, not an automatic migration of existing people.

## Calculation

Date ranges are arrival-inclusive and departure-exclusive. For example, August 15 to September 30 covers work through September 29. Enter October 1 if September 30 must also count.

Every anniversary is calculated from the original arrival date, clamped to the destination month's last day. January 31 therefore progresses to February 28 (or 29), then March 31, without accumulating date drift.

```text
equivalent months = full arrival-anniversary months
                  + remaining days / days in the next anniversary interval
full-stay target = monthly target × equivalent months
```

August 15 to September 30 is 1 + 15/30 = 1.5 months. The default requirements are:

| Requirement | Monthly | 1.5 months |
| --- | ---: | ---: |
| Review credits | 15 | 22.5 |
| Guide: Pub Crawl shifts | 12 | 18 |
| Guide: Promotion shifts | 12 | 18 |
| Social Media shifts | 16 | 24 |
| Cleaning tasks (existing baseline) | 5 | 8 |

Review targets retain fractional credits. Shift and cleaning targets are rounded upward once, after multiplying the full stay, rather than rounding each day or month separately. The guide shift milestone requires both guiding and promotion targets; Social Media uses its separate shift requirement. Attendance remains a percentage, not a multiplied count.

Expected progress by today uses the same calculation capped at the stay boundaries. It is a pacing indicator, separate from the full-stay requirement and star eligibility. Future work cannot count as already completed.

## Configuration and history

- Managers confirm a stay and its shift mappings before targets become active.
- Seasonal/staffing adjustments use a fair blended monthly rate agreed for that individual stay rather than a global month calendar. Any custom initial target and every later edit require a recorded reason; an edit recalculates the whole stay.
- Overlapping stays are rejected. Updates use a revision check to prevent silently overwriting another manager's work.
- Saved revisions retain the agreement and feedback history. Material agreement edits invalidate approval so the edited goals can be reviewed again.
- Inactive former volunteers remain selectable for historical stay setup and people with saved stays remain available for management review. If the current profile has since changed to Long-Term, a manager can still record the missing stay when its dates overlap the preserved volunteer staff-type history; the system never guesses dates from that history.
- Monthly-only legacy review totals count when the entire closed calendar month is contained within the stay. Totals from overlapping partial or unfinished months are disclosed as unavailable; the system does not fabricate daily prorations or change payroll/review ledgers. Existing dated archive reviews use their actual Warsaw creation dates and respect locked-month inclusion rules.
- Approval evaluates the evidence in one consistent database snapshot and preserves that evidence in the revision history. Later corrections can still put the visible final star on hold; the historical approval record is not erased.

## Deployment

Apply `202609060004-volunteer-stays` before serving the new backend/UI. The original Volunteer Progress migrations `202609060001` and `202609060002` are prerequisites. The new migration adds stay/revision tables and Social Media view access, without creating volunteer stays or modifying existing financial/review records.

Rollback refuses to drop populated stay tables, preserving agreements and audit history. Take a normal database backup and deploy the backend and UI together.

## Photo-linked attendance

In Task Planner > Setup > Edit Template > Rules, enable **Confirm attendance from task photos** on the meeting-point or promotion-check template. Select the check kind, the actual shift types, a required image evidence rule, and the Warsaw check time (meeting point defaults to 20:45). Use separate templates for meeting-point and promotion checks.

On that day's task, upload the photo, then record each scheduled person's On time, Late, Absent, or Excused decision against that photo. Absence/excuse requires a reason. A manager cannot confirm their own attendance. The check time enables the check; photo upload time does not automatically determine punctuality. Only completed shifts contribute to progress. Both attendance and punctuality must meet the saved percentage target for the attendance star, and every past shift must have a decision. An unexcused absence lowers the attendance percentage rather than automatically vetoing the stay star; excused shifts are excluded. Historical calendar-month reports retain their original stricter absence rule.

The original photo and audit history cannot be removed through ordinary task edits. Corrections retain their previous decisions in the audit log. Attendance stores the subject's user ID, preventing an in-place shift reassignment from transferring somebody else's attendance credit. Historical calendar-month calculations remain otherwise unchanged.

## Cleaning from the homepage

On the cleaning-check template, create a required image rule for each area/item to inspect. Map each rule to the cleaning shift type under Shift-Based Evidence, then enable **Cleaning photos from staff, with manager approval**. Generate/assign the assistant manager's task through the normal planner workflow. The published cleaning roster determines who must upload; no broad Task Planner access is granted to these staff members.

Set **Only create when these shift templates exist** to the relevant cleaning shift templates. This prevents a daily task from being generated on a day when cleaning is not scheduled.

- Each assigned person sees their cleaning photos on the homepage. No outstanding work means no section.
- Uploads create a nonblocking review request for another manager on an overlapping published shift. If no reviewer is scheduled, management can review with an explicit escalation reason.
- If the published on-shift manager changes while photos are pending, the existing popup is retargeted to the new reviewer; unchanged refreshes do not create duplicates or reopen a deferred popup.
- A reviewer approves each photo or requests a retake with a reason. Approved photos stay locked; only missing or rejected slots can be uploaded. Earlier versions remain in the audit history.
- All current participants and all required photo slots must be approved before the assistant manager's task completes automatically. Confirmed attendance alone does not satisfy a cleaning shift managed by this workflow.
- **Review later** dismisses only this version of a nonblocking cleaning request for the current session. The homepage review queue remains available; a changed submission can show the request again.
- Ownership, published schedule, reviewer authority and optimistic revisions are rechecked before saving. Canceled/reassigned work cannot inherit another person's photographs.
- Temporary network or server refresh failures keep unsent photo selections and review notes on screen with a retry action. Authentication, permission and missing-resource responses hide cached protected data until a successful authorized refresh.
- If every cleaning assignment is canceled after a workflow started, the task stays open and management sees an issue on the homepage. **Waive canceled cleaning** requires a reason, records an audit entry, preserves all photo history, awards no cleaning credit and is refused while any matching cleaner remains scheduled.

An active workflow snapshots its original photo requirements. It cannot be combined with attendance or Social Media completion requirements on the same template. Already-settled compensation blocks retroactive task completion until the affected settlement is reconciled in Staff Payments; no payment is silently rewritten.

## Evidence workflow deployment

Apply `202609060005-volunteer-evidence-workflows` after the stay migrations, followed by `202609070006-volunteer-attendance-shift-identity`, and install the updated backend dependencies before deploying both backend and UI. Production must run the repository-standard Node.js 22.x LTS runtime; `sharp` cannot load on the former Node.js 19 runtime. Normal deployment migrations are recorded in `sequelize_meta`. These migrations add photo/version history and bind photo-based attendance to its original physical shift; they do not enable templates, create stays, generate assignments, or record payments.

Existing attendance rows receive their currently assigned subject ID as an identity snapshot; historical statuses are not changed. Existing photo-linked rows without a trustworthy physical-shift snapshot remain visible but no longer count until a manager reconfirms them from the original task. Rollback refuses to discard saved submissions or photo-linked attendance. Uploaded cleaning images are decoded and normalized on the backend, with 10 MiB and 24-megapixel limits. Authenticated, assignment-scoped preview endpoints serve the evidence.

Local work status: stay migrations and `202609060005` have been applied and verified on the loopback development database only. No production deployment or production configuration change has been performed. Template opt-ins and shift mappings still need manager confirmation before real staff use the new workflows.
