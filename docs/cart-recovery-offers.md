# Cart recovery emails and coupon offers

## Configure automatic offers

In **Settings / Control Panel**, search for **Cart recovery discount rules**.
The form selects an existing storefront coupon; it does not create a coupon or
change its checkout conditions. Create/manage codes in Storefront Promotions.

- **Minimum guests** is inclusive: set **9** for "more than 8 people".
- By default, guest count is the **largest group on one experience**, so the same
  five guests selecting two tours count as five rather than ten.
- The email link applies the offered coupon automatically by default. This can
  be changed to displaying a code for manual entry.
- Rules are evaluated from top to bottom. The first matching, eligible coupon
  that improves the current total is selected. Unavailable/inapplicable codes
  are skipped; a better existing discount is retained. Coupons are not stacked.
- No rules are enabled by default. Saving a change takes effect on the next
  preview/send without restarting the application.

## Override one cart

In **Bookings / Payment Links / Ongoing carts**, open its recovery-email preview.
**Recovery offer** lets an administrator, owner or manager choose automatic
rules, a specific coupon, or no new coupon offer. A specific coupon bypasses the
group-size threshold but still must satisfy the coupon's checkout conditions
and improve the current total. Save and refresh the preview before sending.
Changes record actor, timestamp, previous/current settings and an optional reason.

Unsaved changes or an invalid manual coupon block sending. If the cart, rules or
effective offer change after preview, sending requires a fresh preview. Both
scheduled recovery emails and manual sends use the same offer evaluation.

## Recovery and checkout

The email records the exact offer advertised. Its recovery link includes a
version identifier; an older email does not silently pick up a different coupon
when rules change. Automatic application requires that original cart selection
and the matching recovery link. Opening the link does not overwrite the saved
cart; the existing version-checked quote/save flow persists customer edits.
Expiry, product scope, currency, minimum spend and redemption availability are
validated through the normal checkout quote. Emailing/previewing an offer does
not reserve a redemption or guarantee future availability. If an old offer is
no longer eligible, recovery falls back to the cart's current valid price.

## Development isolation

The ignored local `be/.env.dev` uses `DISABLE_OUTBOUND_EMAIL=true` and
`DISABLE_BACKGROUND_JOBS=true`. Both Gmail and SMTP delivery are blocked before
credentials/transports are used, including manual sends and SMTP fallbacks.
Sending fails explicitly rather than marking a message as delivered; previews
continue to work. In-app scheduling notifications still work without creating
an email-delivery record.

The outbound-email block is deliberately a process-level environment safeguard,
outside Control Panel: restoring production configuration must not enable sends
from a development process. It does not change production email configuration;
an unset/false flag preserves the normal production delivery policy. Never copy
the local environment file into a release or clear this flag just to test a
preview. Delivery tests use mocked transports.
