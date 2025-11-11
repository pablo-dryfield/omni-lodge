# Omni Lodge Staff Compensation Overhaul

Progress tracker for the end-to-end redesign of staff payments, review handling, and incentives.

## Completed

- [x] (1) Promote reviews to their own page with CRUD for platforms and counters.
- [x] (2) Auto-provision review counter entries (active users + special rows) server-side.
- [x] (3) Simplify entry editing UI with pending changes + save/reset controls.
- [x] (4) Cascade delete review counter entries when counters are removed.
- [x] (5) Enforce tier rule: first 15 reviews only paid once 15 are hit (manager/admin/owner override required for <15).
- [x] (6) Expand review platform metadata (weights, source mappings, aliases, URLs).
- [x] (7) Implement compensation component models (base, bonuses, commissions, incentives) end-to-end.
- [x] (8) Build task logging + base salary proration logic for assistant managers (planner-style to-do list with calendar support for daily/weekly/biweekly/every-two-weeks/monthly tasks).
- [x] (9) Integrate night report metrics for leader incentives & staff-of-month.
- [x] (10) Enhance reviews dashboard with historical analytics.

## In Progress / Next Steps

- [ ] (11) Replace legacy staff payment page with the new multi-bucket summary.

## Notes

- Keep backend responsible for entry provisioning to avoid noisy client traffic.
- Tier-1 payouts (1-15 reviews) auto-lock until the 15th review lands unless an admin/owner/manager records an under-minimum approval in the entries panel.
- Review platforms now capture weight, source key, base URL, and alias metadata so review counters and payout rules know how to treat each source.
- Compensation components now flow from settings › assignments › payout calculation › staff payments UI, adding multi-bucket totals beside commissions.
- Assistant-manager task planner now feeds payroll: staff-type/user assignments auto-create payout summaries and task_score base components pro-rate pay from completed/waived logs across the selected range.
- Night report incentives now run off submitted reports: leader metrics API exposes attendance/retention performance (daily/custom) and night_report compensation components pay per qualified day, retention hit, plus best-staff-of-period bonuses.
- Future API changes should be reflected here with a short summary + checklist updates.
