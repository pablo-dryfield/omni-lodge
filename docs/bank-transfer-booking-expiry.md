# Bank transfer bookings

Bank transfer bookings created from **Bookings → Payment Links → Bank transfers** have no expiry. They remain awaiting transfer until staff record payment or manually cancel them. This also applies to past-date bookings and does not mark an unpaid booking as paid.

The payment instructions and active-booking list show **No expiry**. Customer confirmations are still sent only after payment is recorded, according to the booking's existing notification preferences.

Deployment clears payment deadlines on existing pending, unpaid backoffice bank-transfer orders and records the old deadlines in the audit log. Cancelled and paid orders are not reopened or changed. The old automatic-expiry job is removed; its legacy service entry point is a no-op. The former Control Panel deadline setting is retained read-only for configuration history and no longer controls these bookings.

Live stock and limited-promotion holds also become non-expiring while payment is pending. Holds that already elapsed are not silently restored, because the stock or promotion may have been claimed elsewhere; payment settlement uses the existing availability recheck. Paid stock commitments still follow the experience schedule and counter reconciliation. Manual cancellation releases pending holds as before.

Counter reconciliation releases both unpaid stock holds and paid stock commitments when it records physical usage, preventing the same stock from being reserved and deducted twice. This does not mark the transfer as paid or redeem its promotion. If an unpaid booking is later moved to a future experience, its released stock hold is reacquired under the inventory lock and the amendment fails if stock is unavailable.
