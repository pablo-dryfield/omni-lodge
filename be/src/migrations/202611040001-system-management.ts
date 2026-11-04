import type { QueryInterface } from "sequelize";
import { ensureSystemManagementAccess } from "../services/systemManagement/accessSeed.js";
export async function up({
  context,
}: {
  context: QueryInterface;
}): Promise<void> {
  await context.sequelize.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id uuid PRIMARY KEY,actor_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,password_fingerprint text);
    CREATE INDEX IF NOT EXISTS auth_sessions_actor ON auth_sessions(actor_id);
    REVOKE ALL ON auth_sessions FROM PUBLIC;`);
  await ensureSystemManagementAccess();
}
export async function down({
  context,
}: {
  context: QueryInterface;
}): Promise<void> {
  await context.sequelize.query(
    `UPDATE "rolePagePermissions" SET "canView"=false WHERE "pageId" IN (SELECT id FROM pages WHERE slug='settings-system-management')`,
  );
  // Preserve login and management journals across rollback.
}
