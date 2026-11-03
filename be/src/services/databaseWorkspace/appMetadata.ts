import type pg from 'pg';
import { performance } from 'node:perf_hooks';
import { queryDiagnosticsService } from '../queryDiagnosticsService.js';

// Only fixed authentication/authorization metadata uses the application pool.
// User SQL never reaches this helper. PostgreSQL caches plans, never permission
// rows: every request and execution reauthorization reads current primary data.
export const WORKSPACE_ACCOUNT_SQL = `SELECT u.id,u.status,u.approved,u."userTypeId",u."firstName",u."lastName",
  json_build_object('id',r.id,'slug',r.slug,'name',r.name,'status',r.status) AS role
  FROM public.users u LEFT JOIN public."userTypes" r ON r.id=u."userTypeId" WHERE u.id=$1`;
export const WORKSPACE_AUTHORITY_SQL = `SELECT EXISTS(
  SELECT 1 FROM public."rolePagePermissions" permission JOIN public.pages page ON page.id=permission."pageId"
  WHERE permission."userTypeId"=$1 AND permission."canView" AND permission.status AND page.status AND page.slug='settings-sql-helper') AS page,
  ARRAY(SELECT DISTINCT action.key::text FROM public."roleModulePermissions" permission
    JOIN public.modules module ON module.id=permission."moduleId" AND module.status AND module.slug='database-workspace'
    JOIN public.actions action ON action.id=permission."actionId" AND action.status
    JOIN public."moduleActions" active ON active."moduleId"=module.id AND active."actionId"=action.id AND active.enabled
    WHERE permission."userTypeId"=$1 AND permission.allowed AND permission.status) AS actions`;
export type WorkspaceAccount = {
  id: number;
  status: boolean;
  approved: boolean;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  role: { id: number; slug: string; name: string; status: boolean } | null;
};
type Authority = { page: boolean; actions: string[] };
type Manager = {
  getConnection: (options: Record<string, unknown>) => Promise<pg.Client>;
  releaseConnection: (client: pg.Client) => Promise<void>;
  destroyConnection: (client: pg.Client) => Promise<void>;
};
async function metadata<T extends pg.QueryResultRow>(
  kind: 'account' | 'authority',
  id: number,
): Promise<T | undefined> {
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  const { default: sequelize } = await import('../../config/database.js');
  const manager = sequelize.connectionManager as unknown as Manager,
    client = await manager.getConnection({ type: 'SELECT', useMaster: true });
  const sql =
    kind === 'account' ? WORKSPACE_ACCOUNT_SQL : WORKSPACE_AUTHORITY_SQL;
  let clean = false,
    inTransaction = false;
  try {
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    await client.query(
      "SET LOCAL statement_timeout='5000'; SET LOCAL plan_cache_mode='force_generic_plan'",
    );
    const started = performance.now();
    const result = await client.query<T>({
      name: `omnilodge-workspace-${kind}-v1`,
      text: sql,
      values: [id],
    });
    queryDiagnosticsService.recordQuery(sql, performance.now() - started);
    await client.query('COMMIT');
    inTransaction = false;
    clean = true;
    return result.rows[0];
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
        clean = true;
      } catch {
        /* Destroy an uncertain application connection. */
      }
    }
    throw error;
  } finally {
    if (clean) await manager.releaseConnection(client);
    else
      await manager
        .destroyConnection(client)
        .catch(() => client.end().catch(() => {}));
  }
}
export const loadWorkspaceAccount = (id: number) =>
  metadata<WorkspaceAccount>('account', id);
export const loadWorkspaceAuthority = async (id: number): Promise<Authority> =>
  (await metadata<Authority>('authority', id)) || { page: false, actions: [] };
