# Reviewed removal of enquiry contents

This workflow removes contents from **one KTK staging enquiry in the active OmniLodge database**. It does not promise anonymous records or complete erasure across Gmail, backups and exports. It changes no bookings, payments, website forms, notification templates or retained recovery material.

## Preview and execution

Open Customer Enquiries and the exact enquiry. Company-wide page/inbox view access and the separate inbox **delete** permission are required, including on direct API requests. Ordinary follow-up update access is insufficient. The migration/seed gives the additional permission only to the existing administrator/owner roles; existing explicit permission decisions are preserved.

Choose **Preview contents removal**. The preview is read-only and works while execution is disabled. It lists the removed and retained categories, field/activity counts, blockers and the exact enquiry reference. Save or discard an unsaved follow-up draft first. The server binds the preview to the current contents, delivery state, version and activity details; it does not send the contents back in the preview.

Execution is disabled by default through the existing Control Panel key `STAGING_CUSTOMER_ENQUIRY_REMOVAL_ENABLED`. No deployment or preview enables it. Keep it disabled until the owner has approved the real-data removal process. The value is refreshed on each removal/preview request; a refresh failure cannot use a stale enabled value. The setting affects neither the staging form receiver nor order email.

An enabled operation additionally requires **Closed** handling, confirmed **Sent** delivery, an unremoved staging record, a reviewed reason, both retention/other-copy acknowledgements and the full typed enquiry reference. An active or uncertain-delivery record cannot be removed through this workflow. Review any actual ongoing purpose, obligation, claim or individual request before confirming. The control supplies no legal decision or automatic expiry.

The server locks the enquiry and activity rows, verifies the preview again, clears the contents and writes a minimal receipt in one transaction. A stale preview returns a conflict and requires a new review. Concurrent confirmations produce one removal. After an uncertain transport result, close/reopen the record and read its current state; the UI will not automatically retry. [Sequelize transaction and lock contract](https://sequelize.org/docs/v6/other-topics/transactions/).

## Removed and retained scope

Removed from the active enquiry row:

- Submitted field values and labels, including the saved notification snapshot and addresses.
- Customer name, email and search subject.
- Internal notes and assignment.
- Previous activity `changes` details, replaced with a content-free marker. Actor, action, reference and time remain.

Retained:

- The enquiry reference, form/environment and original delivery fingerprint/message identifiers.
- Delivery state/times, Closed handling state, version and minimal staff/action audit.
- Removal time/actor and a fixed-category reason, with an explicit `crossSystemComplete: false` receipt.

Delivery identity remains necessary to keep an earlier enquiry from being sent again under the same reference. This retained identifier/hash is **not a claim of complete anonymisation**. The receiver's reservation and duplicate-send behavior are unchanged. No original approval to remove real records is implied by the feature or synthetic tests.

Removed contents are visibly labelled **Contents removed**, distinct from older metadata-only rows whose contents were never captured. Use **Include earlier delivery records** to find the retained tombstone. Follow-up updates cannot repopulate it. A database constraint rejects repopulated content; a trigger retains the removal timestamp and original duplicate-send identity. The migration rollback refuses to discard a populated removal receipt. There is no undo or automated purge.

## Gmail, exports, backups and restoration

The workflow calls no Gmail send, trash or delete API. Its link identifies the original message for a separate authorised review in the correct KTK mailbox. A link opening is not a removal. Do not default to whole-thread deletion; a thread can contain unrelated material. Record any independently approved action and its verification in the restricted review register. Historical Gmail import stays deferred.

Known exports and backup copies need their own scoped decision, applicable exceptions and reviewed technical method. Do not claim them removed because the active enquiry contents were cleared. Protected booking/payment records and B03 originals, signed metadata, markers and archives remain outside this feature's authority. Owner-discarded provider, contract and hosting-account investigations stay closed.

Before restoring an older backup, the responsible operator must review retained removal receipts/private case records and prevent removed personal contents from becoming available again. This feature does not install a backup-restoration filter or prove disposal of offline copies. A restore exercise must use isolated synthetic data and a reviewed method; real restoration/disposal requires its separately scoped approval. Keep wider removal requests open until their actual known-copy scope has been assessed and verified.

## Verification and release status

Development uses a fresh task-owned local PostgreSQL database and synthetic accounts/records only. Outbound mail and background jobs stay disabled in the actual local application. Local tests cover permissions, default-disabled execution, exact confirmations, stale/same-version edits, transaction rollback, concurrent confirmation, unchanged duplicate-send behavior and tombstone/rollback guards. Desktop/phone verification and the complete relevant source checks are required before source publication. No real enquiry removal or Gmail mutation is part of this delivery.

Source CI, immutable release, actual managed deployment and independent live default-disabled/read-only preservation checks remain required before calling the feature deployed. The website production/D08 exclusions remain in effect.

### Completed local verification — 26 November 2026

- `npm --prefix be run check` and `npm --prefix be run build:prod`: passed.
- `npm --prefix be test -- --runInBand`: **380 suites passed, 3,922 tests passed, one existing skip**. The first run inherited the local app's mail-disable flag and failed nine mocked Gmail-client cases; that result is retained. The normal unit environment passes; the actual app runtime remains mail-disabled.
- Focused receiver/removal/route contracts: **57 passed**.
- `node --import tsx --test integration-tests/website-enquiry-delivery.test.mjs`: passed against loopback PostgreSQL in a task-owned schema, including actual migrations, rollback after a simulated failure, two concurrent confirmations, one retained receipt, no resend after removal, unchanged unrelated fixture and database restoration/rollback guards.
- `npm --prefix ui run check`: passed on the final source.
- Complete UI discovery matches **192 source test files**, with the Windows mixed-separator matcher corrected only in the local command. Full serial UI result: **191/192 suites and 1,346/1,347 tests pass**, with one retained async-content failure in unchanged `PaymentLinksPage.test.tsx`. That suite, unchanged Ongoing Carts and both enquiry suites subsequently pass **30/30 tests** together. The focused enquiry suites pass **13/13**. This is not relabelled as a complete local UI pass; current hosted CI remains required.
- Actual local-page verification passes **25 checks**, including one synthetic Contact contents removal, exact independent readback, unchanged delivery identity, all seven other synthetic rows and an unrelated protected fixture. Four settled preview layouts at **320, 390, 768 and 1,440px** fit their viewport, expose the confirmations and keep an unconfirmed action disabled. These later viewport screenshots supersede the transient full-page phone screenshot.

Initial UI test discovery/label assertions and a cold development-bundle browser timeout remain retained as failed observers; none triggered a real message or removal. The corrected probes use the actual controls without weakening the assertions. All test source data is synthetic and no real Gmail API is used. Local Node was 22.14.0; hosted checks must use the repository-pinned toolchain.
