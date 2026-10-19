# Review platform choices

Open **Settings → Integrations → Review Platforms** (`/settings/review-platforms`) to maintain the configured names, source keys, aliases, and active status. The Settings overview also has a Review Platforms card. Both remain subject to the existing page/module permissions; adding the sidebar link does not grant administration rights.

The Reviews overview receives platform metadata in `/reviews/archive/summary`, under its existing review-view authorization. It does not require Settings access to populate the add/edit manual-credit dropdowns. No platform write permissions are added.

New manual entries offer all active configured platforms plus **Manual / Other**. Inactive platforms are hidden for new entries, but an existing entry retains its original value when edited, even if that platform was deactivated or removed.

Configured source keys are used when provided. Otherwise the existing Google, TripAdvisor, Airbnb, and GetYourGuide archive IDs are preserved when the configured name/slug/alias identifies them; other platforms use their configured slug. In particular, the configured `reviews-from-getyourguide` slug still selects the existing `getyourguide` archive source. Existing credits are not migrated or relabeled.
