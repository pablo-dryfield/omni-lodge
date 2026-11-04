import type { QueryInterface } from "sequelize";
import { ensureSystemManagementAccess } from "../services/systemManagement/accessSeed.js";

type Params = { context: QueryInterface };

// Existing installations already ran the initial System Management migration.
// Add the new capability through the same scoped, idempotent access seed.
export async function up(_params: Params): Promise<void> {
  await ensureSystemManagementAccess();
}

export async function down({ context }: Params): Promise<void> {
  await context.sequelize.query(`UPDATE "roleModulePermissions" SET allowed=false
    WHERE "moduleId" IN (SELECT id FROM modules WHERE slug='system-management')
      AND "actionId" IN (SELECT id FROM actions WHERE key='rootFiles')`);
}
