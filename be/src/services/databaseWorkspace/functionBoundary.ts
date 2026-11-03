import type pg from 'pg';
import { quoteIdentifier } from './filters.js';
// Authorization invariant: network extension entry points must not be inherited
// through PUBLIC by restricted workspace credentials (including view/routine paths).
export const NETWORK_FUNCTION_PATTERN = '^(dblink|http|curl|pg_net)';
export async function publicFunctionHazards(
  client: pg.Client,
  schemas: string[],
) {
  const result = await client.query(
    `SELECT p.oid::text,n.nspname,p.proname,p.prokind,
    format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS address
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
    AND (p.proname~$2 OR (n.nspname=ANY($1) AND p.prosecdef))
    AND EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') ORDER BY n.nspname,p.proname,p.oid`,
    [schemas, NETWORK_FUNCTION_PATTERN],
  );
  return result.rows as Array<{
    oid: string;
    nspname: string;
    proname: string;
    prokind: string;
    address: string;
  }>;
}
export async function restrictPublicFunctions(
  client: pg.Client,
  applicationRole: string,
  hazards: Awaited<ReturnType<typeof publicFunctionHazards>>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const routine of hazards) {
      const kind = routine.prokind === 'p' ? 'PROCEDURE' : 'FUNCTION';
      // Retain explicit application access; existing named grants remain intact.
      await client.query(
        `GRANT EXECUTE ON ${kind} ${routine.address} TO ${quoteIdentifier(applicationRole)}`,
      );
      await client.query(
        `REVOKE EXECUTE ON ${kind} ${routine.address} FROM PUBLIC`,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
