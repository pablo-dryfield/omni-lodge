import { PgParser, type SupportedVersion } from '@supabase/pg-parser';
import { WorkspaceError, type ExecutionMode, type Statement } from './types.js';

const parsers = new Map<number, PgParser<SupportedVersion>>();
const readKinds = new Set(['SelectStmt', 'VariableShowStmt', 'ExplainStmt']);
const writeKinds = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt']);
const forbiddenKinds = new Set(['VariableSetStmt', 'AlterSystemStmt', 'CopyStmt', 'DoStmt', 'CallStmt', 'ListenStmt', 'UnlistenStmt', 'NotifyStmt', 'LoadStmt', 'CreateExtensionStmt', 'AlterExtensionStmt', 'CreateRoleStmt', 'AlterRoleStmt', 'GrantRoleStmt', 'DropRoleStmt', 'CreatedbStmt', 'DropdbStmt', 'CreateTableSpaceStmt', 'DropTableSpaceStmt', 'PrepareStmt', 'ExecuteStmt', 'DeallocateStmt', 'DiscardStmt', 'LockStmt']);
const forbiddenFunctions = /^(set_config|nextval|setval|lo_.*|dblink.*|pg_(?:cancel|terminate|reload|rotate|read|write|ls|stat|logical|create|drop|export|import|advisory|try_advisory|switch|promote|replication|backup|start_backup|stop_backup).*)$/i;
const safeFunctions = new Set(('abs acos asin atan atan2 avg bit_length bool_and bool_or btrim cardinality ceil ceiling char_length character_length coalesce concat concat_ws count current_database current_schema current_schemas current_setting current_user date_part date_trunc decode dense_rank encode extract floor format format_type greatest least lag lead left length ln log lower lpad ltrim max md5 min mod now nullif octet_length overlay percent_rank pg_backend_pid pg_column_size pg_database_size pg_get_constraintdef pg_get_expr pg_get_functiondef pg_get_indexdef pg_get_viewdef pg_indexes_size pg_relation_size pg_size_pretty pg_table_size pg_total_relation_size position power quote_ident quote_literal rank regexp_match regexp_matches regexp_replace regexp_split_to_array repeat replace reverse right round row_number rpad rtrim split_part sqrt string_agg string_to_array strpos substr substring sum to_char to_date to_json to_jsonb to_timestamp translate trim trunc unnest upper version json_agg jsonb_agg json_array_elements jsonb_array_elements json_array_elements_text jsonb_array_elements_text json_build_object jsonb_build_object json_object_agg jsonb_object_agg json_typeof jsonb_typeof json_extract_path jsonb_extract_path json_extract_path_text jsonb_extract_path_text array_agg array_length array_lower array_upper array_to_string generate_series greatest least').split(' '));

export function walkTree(value: unknown, visit: (key: string, node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { value.forEach(v => walkTree(v, visit)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) visit(key, child as Record<string, unknown>);
    walkTree(child, visit);
  }
}
const names = (input: unknown): string[] => Array.isArray(input) ? input.map(v => (v as { String?: { sval?: string } }).String?.sval || '') : [];
const utf8Offset = (buffer: Buffer, offset: number) => buffer.subarray(0, offset).toString('utf8').length;

export async function parseSql(sql: unknown, major: number, options: { maxBytes: number; maxStatements: number; mode?: ExecutionMode; schemas?: string[]; protectedObjects?: string[]; session?: boolean }): Promise<Statement[]> {
  if (typeof sql !== 'string' || !sql.trim()) throw new WorkspaceError(400, 'INVALID_SQL', 'Enter SQL to execute.');
  if (Buffer.byteLength(sql, 'utf8') > options.maxBytes) throw new WorkspaceError(413, 'SQL_TOO_LARGE', 'The script exceeds the configured SQL size limit.');
  if (![15, 16, 17].includes(major)) throw new WorkspaceError(409, 'UNSUPPORTED_SERVER_VERSION', `PostgreSQL ${major} grammar is not supported by this release.`);
  let parser = parsers.get(major);
  if (!parser) { parser = new PgParser({ version: major as SupportedVersion }); parsers.set(major, parser); }
  const parsed = await parser.parse(sql);
  if (parsed.error) throw new WorkspaceError(400, 'SQL_SYNTAX', parsed.error.message, { position: parsed.error.position });
  const rawStatements = (parsed.tree.stmts || []) as Array<{ stmt: Record<string, unknown>; stmt_location?: number; stmt_len?: number }>;
  if (!rawStatements.length || rawStatements.length > options.maxStatements) throw new WorkspaceError(400, 'STATEMENT_LIMIT', `Use between 1 and ${options.maxStatements} statements.`);
  const bytes = Buffer.from(sql, 'utf8');
  const result: Statement[] = [];
  for (const raw of rawStatements) {
    const begin = raw.stmt_location || 0;
    const end = raw.stmt_len ? begin + raw.stmt_len : bytes.length;
    const kind = Object.keys(raw.stmt)[0];
    let mutating = !readKinds.has(kind);
    let complexWrite = false;
    let parameterCount = 0;
    const relations: Statement['relations'] = [];
    walkTree(raw.stmt, (key, node) => {
      if(key==='ParamRef')parameterCount=Math.max(parameterCount,Number(node.number)||0);
      if (writeKinds.has(key) || key === 'IntoClause' || key === 'intoClause') { if (key !== kind) complexWrite = true; mutating = true; }
      if (forbiddenKinds.has(key)) throw new WorkspaceError(403, 'COMMAND_NOT_ALLOWED', `${key.replace(/Stmt$/, '')} requires a dedicated administration workflow.`);
      if (key === 'TransactionStmt' && !options.session) throw new WorkspaceError(400, 'TRANSACTION_CONTROL', 'Use an expert session for explicit transaction controls. Ordinary jobs manage their own transaction.');
      if (key === 'TransactionStmt' && (node.chain || !['TRANS_STMT_BEGIN', 'TRANS_STMT_START', 'TRANS_STMT_COMMIT', 'TRANS_STMT_ROLLBACK', 'TRANS_STMT_SAVEPOINT', 'TRANS_STMT_RELEASE', 'TRANS_STMT_ROLLBACK_TO'].includes(String(node.kind)))) throw new WorkspaceError(400, 'TRANSACTION_CONTROL', 'This transaction-control variant is not supported.');
      if (key === 'RangeVar') {
        const schema = String(node.schemaname || 'public');
        const name = String(node.relname || '');
        if (node.catalogname) throw new WorkspaceError(403, 'CROSS_DATABASE_REFERENCE', 'Cross-database references are not allowed.');
        if (options.schemas && !options.schemas.includes(schema) && !['pg_catalog', 'information_schema'].includes(schema)) throw new WorkspaceError(403, 'SCHEMA_NOT_ALLOWED', `Schema ${schema} is outside this connection policy.`);
        if (/^(pg_authid|pg_auth_members|pg_shadow|pg_user_mapping|pg_subscription)$/i.test(name) || options.protectedObjects?.some(p => p === name || p === `${schema}.${name}`)) throw new WorkspaceError(403, 'PROTECTED_OBJECT', `Access to ${schema}.${name} is protected.`);
        relations.push({ schema, name });
      }
      if (key === 'FuncCall') {
        const parts = names(node.funcname);
        const fn = parts[parts.length - 1]?.toLowerCase() || '';
        if (forbiddenFunctions.test(fn) || (parts.length > 1 && parts[0] !== 'pg_catalog') || !safeFunctions.has(fn)) throw new WorkspaceError(403, 'FUNCTION_NOT_ALLOWED', `Function ${parts.join('.')} is not approved for ad hoc SQL. Use a reviewed administration operation.`);
      }
      if (key === 'SelectStmt' && Array.isArray(node.lockingClause) && node.lockingClause.length) mutating = true;
    });
    if (!readKinds.has(kind) && !writeKinds.has(kind) && !(options.session && kind === 'TransactionStmt')) throw new WorkspaceError(403, 'COMMAND_NOT_ALLOWED', 'Use the dedicated schema or maintenance workflow for this statement.');
    if (options.mode === 'read' && mutating) throw new WorkspaceError(403, 'READ_ONLY', 'This statement can change data or acquire write locks. Select write mode and review it first.');
    if (complexWrite) throw new WorkspaceError(403, 'UNBOUNDED_WRITE_SHAPE', 'This write shape has no reliable affected-row budget. Use a separately reviewed administration operation.');
    result.push({ sql: bytes.subarray(begin, end).toString('utf8').trim(), start: utf8Offset(bytes, begin), end: utf8Offset(bytes, end), kind, mutating, complexWrite, tree: raw.stmt, relations,parameterCount });
  }
  return result;
}
