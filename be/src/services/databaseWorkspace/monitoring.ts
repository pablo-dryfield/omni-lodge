import { catalogQuery } from './catalog.js';
import type { Credential, Target } from './types.js';

export async function activitySnapshot(target: Target, credential: Credential) {
  const identity = await catalogQuery(
    target,
    credential,
    `SELECT now()::text AS measured_at,version() AS version,current_user AS role,
    current_setting('max_connections') AS max_connections,
    pg_has_role(current_user,'pg_read_all_stats','MEMBER') AS full_statistics,
    pg_is_in_recovery() AS in_recovery,pg_database_size(current_database())::text AS database_bytes,
    age(datfrozenxid)::text AS transaction_id_age FROM pg_database WHERE datname=current_database()`,
  );
  const sessions = await catalogQuery(
    target,
    credential,
    `SELECT pid,backend_start::text,query_start::text,xact_start::text,usename,application_name,backend_type,
    state,wait_event_type,wait_event,EXTRACT(epoch FROM now()-xact_start)::text AS transaction_seconds,
    EXTRACT(epoch FROM now()-query_start)::text AS query_seconds,pg_blocking_pids(pid) AS blockers,left(query,2000) AS query
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY xact_start NULLS LAST LIMIT 200`,
  );
  const locks = await catalogQuery(
    target,
    credential,
    `SELECT l.pid,l.locktype,l.mode,l.granted,l.relation::regclass::text AS relation,
    pg_blocking_pids(l.pid) AS blockers FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE a.datname=current_database() AND NOT l.granted ORDER BY l.pid LIMIT 200`,
  );
  const database = await catalogQuery(
    target,
    credential,
    `SELECT numbackends,xact_commit::text,xact_rollback::text,blks_read::text,blks_hit::text,
    tup_returned::text,tup_fetched::text,deadlocks::text,temp_bytes::text,stats_reset::text
    FROM pg_stat_database WHERE datname=current_database()`,
  );
  const tables = await catalogQuery(
    target,
    credential,
    `SELECT relid::text,schemaname,relname,n_live_tup::text,n_dead_tup::text,
    last_vacuum::text,last_autovacuum::text,last_analyze::text,last_autoanalyze::text,seq_scan::text,idx_scan::text,
    pg_total_relation_size(relid)::text AS total_bytes FROM pg_stat_user_tables
    WHERE schemaname=ANY($1::text[]) ORDER BY pg_total_relation_size(relid) DESC LIMIT 100`,
    [target.schemas],
  );
  const indexes = await catalogQuery(
    target,
    credential,
    `SELECT s.relid::text,s.indexrelid::text,s.schemaname,s.relname,s.indexrelname,s.idx_scan::text,
    pg_relation_size(s.indexrelid)::text AS bytes,i.indisvalid AS valid,i.indisready AS ready FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid=s.indexrelid WHERE s.schemaname=ANY($1::text[]) ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 100`,
    [target.schemas],
  );
  const progress: Record<string, unknown[]> = {};
  for (const view of [
    'pg_stat_progress_vacuum',
    'pg_stat_progress_analyze',
    'pg_stat_progress_create_index',
    'pg_stat_progress_cluster',
  ])
    progress[view] = await catalogQuery(
      target,
      credential,
      `SELECT * FROM pg_catalog.${view} WHERE datname=current_database() LIMIT 50`,
    );
  const extensions = await catalogQuery(
    target,
    credential,
    "SELECT n.nspname AS schema,e.extversion FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements'",
  );
  let workload: {
    available: boolean;
    reason?: string;
    rows: Record<string, unknown>[];
    reset?: unknown;
  } = {
    available: false,
    reason:
      'pg_stat_statements is not installed. Configure preload and extension through infrastructure maintenance.',
    rows: [],
  };
  if (extensions.length) {
    const schema = String(extensions[0].schema).replace(/"/g, '""');
    try {
      const rows = await catalogQuery(
        target,
        credential,
        `SELECT queryid::text,calls::text,total_exec_time::text,mean_exec_time::text,rows::text,
        shared_blks_hit::text,shared_blks_read::text,temp_blks_written::text,left(query,2000) AS query
        FROM "${schema}".pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) ORDER BY total_exec_time DESC LIMIT 100`,
      );
      const info = await catalogQuery(
        target,
        credential,
        `SELECT stats_reset::text FROM "${schema}".pg_stat_statements_info`,
      );
      workload = { available: true, rows, reset: info[0]?.stats_reset };
    } catch {
      workload = {
        available: false,
        reason:
          'The extension is installed but workload statistics are unavailable or not permitted.',
        rows: [],
      };
    }
  }
  return {
    identity: identity[0],
    sessions,
    locks,
    database: database[0],
    tables,
    indexes,
    progress,
    workload,
    semantics:
      'Cumulative counters since stats_reset; tuple counts are estimates. Host CPU, disk headroom and memory are not measured by this SQL snapshot.',
  };
}
