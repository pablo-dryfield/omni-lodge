import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };
// Only the legacy, exclusively Food Tour role. Preserve custom names and every
// identity/permission/membership link; its internal slug is intentionally stable.
const legacyRole = `r.slug = 'food-tour-owner-member'
  AND r.name LIKE 'Food Tour Owner%Team member'
  AND (SELECT COUNT(*) FROM user_type_product_types s WHERE s.user_type_id = r.id) = 1
  AND EXISTS (SELECT 1 FROM user_type_product_types s JOIN "productTypes" p ON p.id = s.product_type_id
    WHERE s.user_type_id = r.id AND LOWER(TRIM(p.name)) ~ '^food tour($|[ -])')`;

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`UPDATE "userTypes" r SET name = 'Food Tour Guide', "updatedAt" = NOW()
      WHERE ${legacyRole};`, { transaction });
  });
}

export async function down(): Promise<void> {
  // A rollback must not overwrite names subsequently edited by an owner.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT NOT EXISTS (SELECT 1 FROM "userTypes" r WHERE ${legacyRole}) AS ready;`);
  const details = (rows as Array<{ ready: boolean }>)[0];
  return { ok: Boolean(details?.ready), details };
}
