# Customer Enquiries

The Customer Enquiries page collects new KTK staging website submissions in OmniLodge and links each enquiry to its notification email. The website still uses the dedicated signed staging receiver and the existing Gmail transport. KTK website production integration remains a separate release scope.

## Staff workflow

Open **Customer Enquiries** from navigation or the Operations home cards. Search by customer name, email or subject, and filter by form, handling status or email delivery. The inbox initially shows submissions with saved contents. **Include earlier delivery records** exposes retained metadata from before this feature; their missing contents are never invented or fetched from Gmail.

Open an enquiry to see its submitted fields and the exact notification snapshot. **Open notification in Gmail** links to the stored provider message in the sending mailbox. This does not send a reply or change handling status.

Handling status is separate from delivery status:

- **New / In progress / Replied / Closed** describe the team's follow-up.
- **Sending / Sent / Uncertain** describe notification delivery. An uncertain send retains the enquiry and cannot be automatically retried.

Assign an active team member and keep internal notes. Mark **Replied** after the team answers the customer. Saves use a version check; a conflict preserves the operator's draft until they explicitly reload. Follow-up and template changes have actor/time audit records. New records retain submitted fields, field labels, sender/recipient details, rendered notification and the existing immutable delivery identity. Visitor IP addresses are not added to enquiry records.

## Email templates

The page's **Email templates** tab manages a notification template for each of the seven staging forms. Existing wording and plain text layouts remain the defaults until an authorised editor saves a change. This does not change booking templates or send customer acknowledgements.

Use the displayed `%%field-id%%` placeholders to choose the subject, body and field order. Inserted customer values are substituted once and remain literal. Unknown placeholders, header line breaks, oversized templates and excessive repeated field references are rejected. The page link and enquiry reference are appended automatically.

Choose **Plain text** or **Branded HTML with plain text fallback**. The branded layout escapes customer text and provides a fixed styled wrapper. Preview uses example details, renders HTML in a sandboxed iframe and sends nothing. A saved template is read on the next enquiry; it does not rewrite earlier notification snapshots or trigger a resend. Enquiry-specific template content is stored separately from booking email templates to preserve their existing permissions and behaviour. Integration switches, recipients, rate and secret remain in the existing Control Panel system.

## Access and retention

The page and its two modules (`customer-enquiries-inbox`, `customer-enquiry-templates`) use existing page/module permissions. Administrator, legacy Administrator and Owner receive initial view/update access. Other roles receive no automatic grant. Product-scoped accounts cannot use this company-wide inbox, including through direct API requests. Ordinary staff access can be assigned through the existing permission administration.

The migration preserves old delivery identities and adds nullable contents plus follow-up fields, a template table and an audit table. Old rows retain null contents. Rollback refuses to discard any saved enquiry contents, templates or audit events; it never deletes delivery identities or administrator-edited permissions. There is no automatic purge or historical Gmail import. Historical import is deferred by the owner's explicit decision.

## Verification and release scope

Local verification uses a fresh task-owned PostgreSQL database, synthetic users and seven captured notifications, including one simulated uncertain send. The actual local runtime keeps outbound email and background jobs disabled. Authenticated HTTP checks cover all seven snapshots, anonymous/guide denial, literal wildcard search, saved notes/assignment, stale edits, template preview/save and the mail block. Desktop and phone UI checks cover the actual page, detail dialog, save flows, history toggle, rendered HTML preview, viewport fit and keyboard Escape. Initial transient screenshots and the failed close-button probe are retained; the close button now has an explicit accessible name and settled views were rechecked.

Local commands/results:

- `npm --prefix be run check`: passed.
- `npm --prefix be test -- --runInBand`: 379 suites passed; 3,899 tests passed and one existing test skipped. An earlier run with a global mail-disable flag blocked nine existing mocked Gmail-client cases; the normal unit-test environment passed without changing those tests. The actual application runtime remains mail-disabled locally.
- Focused backend receiver/inbox/template contracts: 52 passed.
- `node --import tsx --test integration-tests/website-enquiry-delivery.test.mjs`: passed against local PostgreSQL, including the actual migration, uniqueness, content retention, uncertain delivery and rollback guards. The dedicated migrations CI job runs this file on PostgreSQL 16.10. The separate backend unit-test matrix covers PostgreSQL 16 and 17.
- `npm --prefix ui run check`: passed; current local development bundle also compiles cleanly.
- Complete UI discovery independently matches all191 current source test files, retaining all190 originals. The Windows CRA matcher contained mixed path separators; a CLI-only normalised equivalent selected the complete source set. CI configuration is unchanged.
- The first full local UI run passed189/191 suites (1,336/1,338 tests), with async-content failures in unchanged PaymentLinksPage and OngoingCartsPanel suites. Those unchanged suites plus the enquiry screen passed21/21 in a separate serial run. The final enquiry screen passes5/5 after the history-filter/accessible-close follow-up. These retained local failures are not relabelled as a full pass; complete current GitHub CI is required before merge.

Private task evidence and source originals are retained outside the repository. No real email, historical mailbox import, customer reply, order/payment, sender/provider/account, website production, consent/GTM or unrelated Competitors change is part of the local verification. Immutable CI release and managed deployment remain required before describing the feature as live.

## Verified delivery — 23 November 2026

[PR270](https://github.com/pablo-dryfield/omni-lodge/pull/270) merged as `a31cccaad90e` with the reviewed tree `4871177a`. [All nine current PR CI jobs](https://github.com/pablo-dryfield/omni-lodge/actions/runs/45162287139) passed, including both backend matrix jobs and all 191 UI suites / 1,339 tests. The earlier local failures remain retained as scoped evidence.

[Immutable Release45164022398](https://github.com/pablo-dryfield/omni-lodge/actions/runs/45164022398) and its [automatic managed deployment45166121877](https://github.com/pablo-dryfield/omni-lodge/actions/runs/45166121877) succeeded. Independent verification checked all 2,961 packaged files, the terminal host request, public backend/UI release identities, companion smoke checks, the main JavaScript asset and the actual Customer Enquiries lazy chunk. Read-only before/after checks preserve the all-Gmail/no-Cc configuration and seven original approved delivery identities. Old rows retain null contents. Anonymous inbox access and invalid receiver inputs were rejected; no additional valid enquiry or real email was sent.

The new-submissions inbox is available at [Customer Enquiries](https://omni-lodge.com/customer-enquiries). Actual signed-in owner access is a separate account check. Historical Gmail import remains deferred, and KTK website production integration remains outside this delivery.
