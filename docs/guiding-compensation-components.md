# Guiding compensation components

Guiding rates and payment defaults are business configuration in **Settings / Compensation Components**. They are read on each staff-payment calculation, so editing them does not require a deployment. Do not put these values in environment variables or a separate settings store.

The Halloween component starts at **6 PLN per attendee**, copies the regular Pub Crawl Guiding account/category and assignment scopes, and uses the same review-target eligibility and monthly manager override. Its product ID is resolved by the release migration in each database. No new finance category is created.

An explicit guiding component uses its existing Config JSON:

```json
{
  "guideCommission": {
    "products": [{ "productId": 123, "rate": 6 }],
    "settlementComponent": true,
    "reviewTargetRequired": true
  }
}
```

Replace `123` with the configured product ID. `settlementComponent` attributes those earnings to this component so payment lines receive its name and finance defaults. `reviewTargetRequired` applies the existing review-target rule only to Long Term Pub Crawl Guides living in accommodation. The monthly review-payment override releases those earnings to the staff member. The normal settlement routing rules still apply to everyone else. Review thresholds use the existing `requiresReviewTarget` configuration and its current default.

The regular component named **Pub Crawl Guiding** retains both behaviors by default for compatibility. Other existing guiding components remain generic unless explicitly opted in. Each product earning is attributed once; if configured products overlap, the last component in the existing category/name order owns the source. Avoid overlapping product lists.

Introducing a component refreshes unpaid, unallocated periods through the existing ledger reconciliation mechanism. If a period already has a payment or net fund allocation, a new component identity is used only when already present in its saved snapshot. Otherwise that period keeps its historical generic source. This prevents a configuration change from moving recorded payments or allocations. Existing reconciliation controls still apply to changes in money or routing.

The release migration is idempotent, audits the new configuration, preserves existing administrator configuration, and never edits payment or allocation records. Its rollback deliberately preserves the component because financial history can reference it.
