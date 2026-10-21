import type { QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS product_type_id INTEGER
      REFERENCES "productTypes"(id) ON DELETE RESTRICT;
      CREATE INDEX IF NOT EXISTS email_templates_product_type_idx ON email_templates(product_type_id);
      ALTER TABLE booking_emails ADD COLUMN IF NOT EXISTS booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS booking_emails_booking_idx ON booking_emails(booking_id);
      INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
      SELECT r.id, m.id, a.id, TRUE, TRUE, NOW(), NOW()
      FROM "userTypes" r CROSS JOIN modules m CROSS JOIN actions a
      WHERE r.slug = 'food-tour-owner' AND r.status = TRUE AND m.slug = 'booking-management'
        AND a.key IN ('create', 'update')
        AND (SELECT COUNT(*) FROM user_type_product_types s WHERE s.user_type_id = r.id) = 1
        AND EXISTS (SELECT 1 FROM user_type_product_types s JOIN "productTypes" p ON p.id=s.product_type_id
          WHERE s.user_type_id=r.id AND LOWER(TRIM(p.name)) ~ '^food tour($|[ -])')
        AND EXISTS (SELECT 1 FROM "moduleActions" ma WHERE ma."moduleId"=m.id AND ma."actionId"=a.id AND ma.enabled=TRUE)
      ON CONFLICT ("userTypeId", "moduleId", "actionId") DO UPDATE SET allowed=TRUE, status=TRUE, "updatedAt"=NOW();`, { transaction });
  });
}
export async function down(): Promise<void> {
  // Do not discard product-owned templates or revoke subsequently edited permissions.
}
export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const columns = await context.describeTable('email_templates');
  const emails = await context.describeTable('booking_emails');
  return { ok: Boolean(columns.product_type_id && emails.booking_id), details: { productScopeColumn: Boolean(columns.product_type_id), bookingEmailLink: Boolean(emails.booking_id) } };
}
