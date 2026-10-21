import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    const [types] = await context.sequelize.query(`
      SELECT id FROM "productTypes" WHERE LOWER(TRIM(name)) ~ '^food tour($|[ -])' ORDER BY id;
    `, { transaction });
    const foodTours = types as Array<{ id: number }>;
    if (foodTours.length > 1) throw new Error('Food Tour product type is ambiguous; configure role scopes explicitly.');
    if (foodTours.length === 0) return;
    // Serialize with the role editor. Never overwrite an explicit scope, even
    // a shared one: shared roles remain unavailable to delegated owners.
    await context.sequelize.query(`
      SELECT id FROM "userTypes" WHERE slug LIKE 'food-tour-%' ORDER BY id FOR UPDATE;
    `, { transaction });
    await context.sequelize.query(`
      INSERT INTO user_type_product_types (user_type_id, product_type_id, created_at, updated_at)
      SELECT r.id, :foodTourId, NOW(), NOW() FROM "userTypes" r
      WHERE r.slug LIKE 'food-tour-%'
        AND NOT EXISTS (SELECT 1 FROM user_type_product_types s WHERE s.user_type_id = r.id)
      ON CONFLICT (user_type_id, product_type_id) DO NOTHING;
    `, { replacements: { foodTourId: foodTours[0].id }, transaction });
  });
}

export async function down(): Promise<void> {
  // Removing a product scope grants company-wide access. Keep this security
  // restriction on rollback; an administrator can explicitly reconfigure it.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT
    (SELECT COUNT(*) FROM "productTypes" WHERE LOWER(TRIM(name)) ~ '^food tour($|[ -])') <= 1
    AND (NOT EXISTS (SELECT 1 FROM "productTypes" WHERE LOWER(TRIM(name)) ~ '^food tour($|[ -])')
      OR NOT EXISTS (SELECT 1 FROM "userTypes" r WHERE r.slug LIKE 'food-tour-%'
        AND NOT EXISTS (SELECT 1 FROM user_type_product_types s WHERE s.user_type_id = r.id))) AS ready;`);
  const details = (rows as Array<{ ready: boolean }>)[0];
  return { ok: Boolean(details?.ready), details };
}
