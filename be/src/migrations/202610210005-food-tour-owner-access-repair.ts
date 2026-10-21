import type { QueryInterface, Transaction } from 'sequelize';

type Params = { context: QueryInterface };
type EligibleRole = { id: number; product_type_id: number };

// Snapshot of the product-isolated permissions already used by the local Food Tour Owner.
// Never copy the global Owner role or grant raw role/permission administration.
export const PAGE_GRANTS = [
  'dashboard', 'bookings', 'bookings-manifest', 'settings', 'settings-users',
  'settings-products', 'settings-product-prices', 'settings-product-addons', 'finance',
];
export const MODULE_GRANTS = Object.entries({
  'booking-management': ['view', 'create', 'update'],
  'booking-manifest': ['view'],
  'user-directory': ['view', 'create', 'update'],
  'product-catalog': ['view', 'create', 'update', 'delete'],
  'product-price-management': ['view', 'create', 'update', 'delete'],
  'product-addon-management': ['view', 'create', 'update', 'delete'],
  'finance-reports': ['view'],
}).flatMap(([module_slug, actions]) => actions.map(action_key => ({ module_slug, action_key })));

const requiredGrants = `WITH required_grants AS (
  SELECT * FROM jsonb_to_recordset(CAST(:moduleGrants AS JSONB)) AS g(module_slug TEXT, action_key TEXT)
)`;
const bindings = {
  pageSlugs: PAGE_GRANTS, moduleGrants: JSON.stringify(MODULE_GRANTS),
  expectedPages: PAGE_GRANTS.length, expectedModules: MODULE_GRANTS.length,
};
const eligibleRoles = async (context: QueryInterface, transaction?: Transaction): Promise<EligibleRole[]> => {
  const [rows] = await context.sequelize.query(`
    SELECT r.id, s.product_type_id FROM "userTypes" r
      JOIN user_type_product_types s ON s.user_type_id = r.id
      JOIN "productTypes" p ON p.id = s.product_type_id
    WHERE r.slug = 'food-tour-owner' AND r.status = TRUE
      AND LOWER(TRIM(p.name)) ~ '^food tour($|[ -])'
      AND (SELECT COUNT(*) FROM user_type_product_types scope WHERE scope.user_type_id = r.id) = 1;
  `, { transaction });
  return rows as EligibleRole[];
};

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    // The role/scope editor also locks this row. Read scope only after the lock is acquired.
    await context.sequelize.query(`SELECT id FROM "userTypes"
      WHERE slug = 'food-tour-owner' ORDER BY id FOR UPDATE;`, { transaction });
    for (const role of await eligibleRoles(context, transaction)) {
      const replacements = { ...bindings, roleId: role.id };
      const [pages] = await context.sequelize.query(`SELECT id FROM pages
        WHERE slug IN (:pageSlugs) AND status = TRUE FOR SHARE;`, { replacements, transaction });
      const [modules] = await context.sequelize.query(`${requiredGrants}
        SELECT m.id, a.id AS action_id FROM required_grants g
          JOIN modules m ON m.slug = g.module_slug AND m.status = TRUE
          JOIN actions a ON a.key = g.action_key AND a.status = TRUE
          JOIN "moduleActions" ma ON ma."moduleId" = m.id AND ma."actionId" = a.id AND ma.enabled = TRUE
        FOR SHARE OF m, a, ma;`, { replacements, transaction });
      if (pages.length !== PAGE_GRANTS.length || modules.length !== MODULE_GRANTS.length) {
        throw new Error('Food Tour Owner access repair requires all product-isolated pages and enabled module actions.');
      }
      // Preserve exact prior values for audit and serialize with existing permission edits.
      const [previousPages] = await context.sequelize.query(`SELECT id, "pageId", "canView", status
        FROM "rolePagePermissions" WHERE "userTypeId" = :roleId FOR UPDATE;`, { replacements, transaction });
      const [previousModules] = await context.sequelize.query(`SELECT id, "moduleId", "actionId", allowed, status
        FROM "roleModulePermissions" WHERE "userTypeId" = :roleId FOR UPDATE;`, { replacements, transaction });
      const [changedPages] = await context.sequelize.query(`
        INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
        SELECT :roleId, p.id, TRUE, TRUE, NOW(), NOW() FROM pages p WHERE p.slug IN (:pageSlugs)
        ON CONFLICT ("userTypeId", "pageId") DO UPDATE SET "canView" = TRUE, status = TRUE, "updatedAt" = NOW()
          WHERE "rolePagePermissions"."canView" IS DISTINCT FROM TRUE OR "rolePagePermissions".status IS DISTINCT FROM TRUE
        RETURNING id;`, { replacements, transaction });
      const [changedModules] = await context.sequelize.query(`${requiredGrants}
        INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
        SELECT :roleId, m.id, a.id, TRUE, TRUE, NOW(), NOW() FROM required_grants g
          JOIN modules m ON m.slug = g.module_slug JOIN actions a ON a.key = g.action_key
        ON CONFLICT ("userTypeId", "moduleId", "actionId") DO UPDATE SET allowed = TRUE, status = TRUE, "updatedAt" = NOW()
          WHERE "roleModulePermissions".allowed IS DISTINCT FROM TRUE OR "roleModulePermissions".status IS DISTINCT FROM TRUE
        RETURNING id;`, { replacements, transaction });
      if (changedPages.length || changedModules.length) {
        await context.sequelize.query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
          VALUES (NULL, 'access_control.food_tour_owner_access_repaired', 'user_type', :entityId, CAST(:meta AS JSONB), NOW());`, {
          transaction, replacements: { entityId: String(role.id), meta: JSON.stringify({
            source: '202610210005-food-tour-owner-access-repair', reason: 'Restore missing deployed Food Tour Owner permissions',
            productTypeIds: [role.product_type_id], previousPages, previousModules,
            pageGrants: PAGE_GRANTS, moduleGrants: MODULE_GRANTS,
            changedPagePermissionIds: changedPages, changedModulePermissionIds: changedModules,
          }) },
        });
      }
    }
  });
}

export async function down(): Promise<void> {
  // Permissions remain editable in the existing Access Control UI. Do not erase later edits,
  // the restoration audit record, or the product scope during a code rollback.
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const roles = await eligibleRoles(context);
  const checks = [];
  for (const role of roles) {
    const [rows] = await context.sequelize.query(`${requiredGrants}
      SELECT (SELECT COUNT(*) FROM pages p JOIN "rolePagePermissions" rp ON rp."pageId" = p.id
        WHERE p.slug IN (:pageSlugs) AND p.status = TRUE AND rp."userTypeId" = :roleId
          AND rp.status = TRUE AND rp."canView" = TRUE) = :expectedPages AS pages_ready,
        (SELECT COUNT(*) FROM required_grants g
          JOIN modules m ON m.slug = g.module_slug AND m.status = TRUE
          JOIN actions a ON a.key = g.action_key AND a.status = TRUE
          JOIN "moduleActions" ma ON ma."moduleId" = m.id AND ma."actionId" = a.id AND ma.enabled = TRUE
          JOIN "roleModulePermissions" rp ON rp."moduleId" = m.id AND rp."actionId" = a.id
            AND rp."userTypeId" = :roleId AND rp.allowed = TRUE AND rp.status = TRUE
        ) = :expectedModules AS modules_ready;`, { replacements: { ...bindings, roleId: role.id } });
    checks.push({ roleId: role.id, ...(rows as Array<{ pages_ready: boolean; modules_ready: boolean }>)[0] });
  }
  return { ok: checks.every(check => check.pages_ready === true && check.modules_ready === true),
    details: { applicableRoles: roles.length, checks } };
}
