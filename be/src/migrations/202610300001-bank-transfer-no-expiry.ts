import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };
const source = '202610300001-bank-transfer-no-expiry';

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`ALTER TABLE storefront_order_resource_reservations
      ALTER COLUMN expires_at DROP NOT NULL;`, { transaction });
    await context.sequelize.query(`SELECT id FROM storefront_orders
      WHERE order_source = 'backoffice' AND payment_method = 'bank_transfer'
        AND status = 'pending_payment' AND payment_status = 'unpaid'
      ORDER BY id FOR UPDATE;`, { transaction });
    // Only extend holds still owned by these orders. Already elapsed holds may
    // have been claimed elsewhere and must be reacquired when payment is recorded.
    await context.sequelize.query(`WITH candidates AS (
      SELECT r.id, r.expires_at FROM storefront_order_resource_reservations r
      JOIN storefront_orders o ON o.id = r.order_id
      WHERE o.order_source = 'backoffice' AND o.payment_method = 'bank_transfer'
        AND o.status = 'pending_payment' AND o.payment_status = 'unpaid'
        AND r.status = 'held' AND r.expires_at > NOW()
      FOR UPDATE OF r
    ), changed AS (
      UPDATE storefront_order_resource_reservations r SET expires_at = NULL, updated_at = NOW()
      FROM candidates c WHERE r.id = c.id RETURNING r.id, r.order_id, c.expires_at AS previous_expiry
    ) INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
      SELECT NULL, 'storefront.bank_transfer_hold_expiry_removed', 'storefront_order_resource_reservation', id::text,
        jsonb_build_object('source', :source, 'orderId', order_id, 'previousExpiresAt', previous_expiry, 'expiresAt', NULL), NOW()
      FROM changed;`, { transaction, replacements: { source } });
    await context.sequelize.query(`WITH candidates AS (
      SELECT id, payment_due_at FROM storefront_orders
      WHERE order_source = 'backoffice' AND payment_method = 'bank_transfer'
        AND status = 'pending_payment' AND payment_status = 'unpaid' AND payment_due_at IS NOT NULL
      FOR UPDATE
    ), changed AS (
      UPDATE storefront_orders o SET payment_due_at = NULL, updated_at = NOW()
      FROM candidates c WHERE o.id = c.id RETURNING o.id, o.public_id, c.payment_due_at AS previous_due_at
    ) INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
      SELECT NULL, 'storefront.bank_transfer_expiry_removed', 'storefront_order', id::text,
        jsonb_build_object('source', :source, 'publicId', public_id, 'previousPaymentDueAt', previous_due_at,
          'paymentDueAt', NULL, 'reason', 'Staff-created bank transfer bookings do not expire'), NOW()
      FROM changed;`, { transaction, replacements: { source } });
  });
}

export async function down(): Promise<void> {
  // Preserve no-expiry reservations and their audit history during a code rollback.
  // Restoring deadlines could silently cancel existing customer bookings.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [columns] = await context.sequelize.query(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'storefront_order_resource_reservations' AND column_name = 'expires_at';`);
  const [counts] = await context.sequelize.query(`SELECT COUNT(*)::integer AS remaining FROM storefront_orders
    WHERE order_source = 'backoffice' AND payment_method = 'bank_transfer'
      AND status = 'pending_payment' AND payment_status = 'unpaid' AND payment_due_at IS NOT NULL;`);
  const nullable = (columns as Array<{ is_nullable: string }>)[0]?.is_nullable === 'YES';
  const remaining = Number((counts as Array<{ remaining: number }>)[0]?.remaining ?? -1);
  return { ok: nullable && remaining === 0, details: { nullableReservationExpiry: nullable, remainingPaymentDeadlines: remaining } };
}
