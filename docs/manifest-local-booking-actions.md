# Manifest local booking corrections

Open a booking's **Actions** menu and choose **Force amend** or **Force cancel** for an externally managed channel, including GetYourGuide, Viator, Rezdy, Airbnb, FareHarbor, FreeTour, Civitatis, XperiencePoland and Ecwid. Newly configured external channel names use the same controls. Direct and OmniLodge bookings keep their existing payment-aware workflows; Ecwid also retains its integrated actions.

These force actions update OmniLodge only. They never call the booking platform or process a payment or refund. Force amendment changes the experience date and time in Europe/Warsaw, preserving the recorded duration. Neither action changes guest quantities, add-ons, attendance history or financial amounts. Complete any external platform changes and refunds separately.

Owners, Administrators and Managers need Booking Management update permission. Food Tour Owners and Managers can act only on bookings belonging to their permitted Food Tour product type. Ordinary users and Assistant Managers receive no new force-action privilege.

A reason is required. The booking event and audit history record the actor, reason, previous and new values, and notification results. Saving rechecks permission and the latest booking version under a row lock; a stale form must be refreshed. Older replayed provider emails cannot overwrite the local correction. Genuinely newer provider updates remain eligible for ingestion.

Customer notification is selected by default and can be disabled when the platform has already notified them. An internal notification is also attempted. Food Tour bookings use the existing **Direct Bookings email from address/name** and **Direct Bookings notification email** in Settings / Control Panel; other bookings use the **Storefront email from address/name** and **Storefront notification email**. These settings refresh for each action without a restart. Customer messages are linked to the booking mailbox, and only the internal message includes the management reason.

The result shows whether each email was sent, skipped or failed. Missing customer email does not block a correction. A notification or mailbox-history failure does not undo a saved booking change. Do not repeat a force action to resend an email; use the booking mailbox to follow up after checking the recorded result.
