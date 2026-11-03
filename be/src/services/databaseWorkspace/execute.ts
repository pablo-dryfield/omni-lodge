import pg from 'pg';
import Cursor from 'pg-cursor';
import type { WorkspaceStore } from './store.js';
import { writeResult } from './artifacts.js';
import {
  errorInfo,
  WorkspaceError,
  type Field,
  type JobPayload,
  type JobRecord,
  type StatementOutcome,
  type WireValue,
} from './types.js';
const rawTypes = {
  getTypeParser: (_oid: number, _format?: string) => (value: string) => value,
};
export async function executeStatements(
  store: WorkspaceStore,
  client: pg.Client,
  job: JobRecord,
  payload: JobPayload,
  outcomes: StatementOutcome[],
  hooks: {
    beforeStatement?: () => Promise<void>;
    affected?: (count: number) => Promise<void>;
  } = {},
): Promise<void> {
  const types = await client.query(
    'SELECT t.oid,t.typname,n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace',
  );
  const typeNames = new Map(
    types.rows.map((t) => [
      Number(t.oid),
      { name: String(t.typname), schema: String(t.nspname) },
    ]),
  );
  let affected = 0;
  for (let index = 0; index < payload.statements.length; index++) {
    await hooks.beforeStatement?.();
    const statement = payload.statements[index],
      started = Date.now();
    const bound =
      statement.parameters ??
      payload.parameters.slice(0, statement.parameterCount || 0);
    if (bound.length < (statement.parameterCount || 0))
      throw new WorkspaceError(
        400,
        'PARAMETER_REQUIRED',
        'This statement is missing a bound parameter.',
      );
    const captured: WireValue[][] = [];
    const messages: NonNullable<StatementOutcome['messages']> = [];
    const notice = (n: {
      severity?: string;
      code?: string;
      message?: string;
    }) => {
      if (messages.length < 50)
        messages.push({
          severity: n.severity || 'NOTICE',
          code: n.code,
          message: (n.message || '').slice(0, 4000),
        });
    };
    client.on('notice', notice);
    let fields: Field[] = [],
      bytes = 0,
      complete = true,
      capReason: string | undefined,
      command = '',
      rowCount = 0;
    const describe = (input: pg.FieldDef[]) =>
      input.map((f, n) => ({
        id: `c${n}`,
        name: f.name,
        oid: f.dataTypeID,
        pgType: typeNames.get(f.dataTypeID)?.name || String(f.dataTypeID),
        pgTypeSchema: typeNames.get(f.dataTypeID)?.schema,
        encoding: 'pg-text' as const,
        tableOid: f.tableID,
        column: f.columnID,
      }));
    const capture = (row: WireValue[]) => {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (
        captured.length >= payload.limits.resultMaxRows ||
        bytes + size > payload.limits.resultMaxBytes
      ) {
        complete = false;
        capReason =
          captured.length >= payload.limits.resultMaxRows
            ? 'row_limit'
            : 'byte_limit';
        return false;
      }
      bytes += size;
      captured.push(row);
      return true;
    };
    try {
      if (!statement.mutating) {
        const cursor = client.query(
          new Cursor(statement.sql, bound, {
            rowMode: 'array',
            types: rawTypes,
          }),
        );
        try {
          while (true) {
            const batch = await new Promise<pg.QueryResult>((resolve, reject) =>
              cursor.read(128, (error, rows, result) =>
                error
                  ? reject(error)
                  : resolve(
                      result || {
                        rows,
                        fields: [],
                        command: 'SELECT',
                        rowCount: rows.length,
                        oid: 0,
                      },
                    ),
              ),
            );
            if (!fields.length) fields = describe(batch.fields);
            if (!batch.rows.length) break;
            let full = false;
            for (const row of batch.rows as WireValue[][])
              if (!capture(row)) {
                full = true;
                break;
              }
            if (full) break;
          }
        } finally {
          await cursor.close();
        }
        command = statement.kind === 'ExplainStmt' ? 'EXPLAIN' : 'SELECT';
        rowCount = captured.length;
      } else {
        const result = await new Promise<pg.QueryResult>((resolve, reject) => {
          const queryConfig: pg.QueryArrayConfig = {
            text: statement.sql,
            values: bound,
            rowMode: 'array',
            types: rawTypes,
          };
          const query = new pg.Query(queryConfig);
          query.on('row', (row: WireValue[]) => {
            capture(row);
          });
          query.on('error', reject);
          query.on('end', resolve);
          client.query(query);
        });
        fields = describe(result.fields);
        command = result.command;
        rowCount = result.rowCount || 0;
        if (statement.rollbackPlan) {
          // RETURNING makes ModifyTable's root Actual Rows authoritative; without
          // it PostgreSQL reports zero even when the command changed rows.
          let plan: { Plan?: Record<string, unknown> };
          try {
            plan = JSON.parse(captured[0]?.[0] || '')[0];
          } catch {
            throw new WorkspaceError(
              400,
              'PLAN_JSON_REQUIRED',
              'Use FORMAT JSON for an actual write plan. The transaction was rolled back.',
            );
          }
          const root = plan?.Plan;
          if (
            !root ||
            root['Node Type'] !== 'ModifyTable' ||
            !Number.isFinite(Number(root['Actual Rows'])) ||
            !Number.isFinite(Number(root['Actual Loops']))
          )
            throw new WorkspaceError(
              409,
              'PLAN_ROW_BUDGET',
              'The actual write plan did not report a reliable modified-row count. The transaction was rolled back.',
            );
          rowCount = Number(root['Actual Rows']) * Number(root['Actual Loops']);
        }
        affected += rowCount;
        await hooks.affected?.(rowCount);
        if (
          statement.expectedAffected !== undefined &&
          rowCount !== statement.expectedAffected
        )
          throw new WorkspaceError(
            409,
            'ROW_CONFLICT',
            'A selected row changed or was removed. The entire transaction was rolled back; reload its current values before saving.',
          );
        if (affected > payload.limits.writeMaxRows)
          throw new WorkspaceError(
            409,
            'WRITE_ROW_LIMIT',
            `The transaction affected more than ${payload.limits.writeMaxRows} rows and has been rolled back.`,
          );
        if (capReason === 'byte_limit')
          throw new WorkspaceError(
            413,
            'RESULT_BYTE_LIMIT',
            'The write result exceeded its byte budget. The transaction was rolled back.',
          );
      }
      const result = fields.length
        ? await writeResult(store, job, index, fields, captured, complete, {
            directory: payload.limits.artifactDirectory,
            ttlMinutes: payload.limits.resultTtlMinutes,
            storageBudget: payload.limits.storageBudgetBytes,
            capReason,
          })
        : undefined;
      outcomes.push({
        index,
        sql: statement.sql,
        sourceStart: statement.start,
        sourceEnd: statement.end,
        kind: statement.kind,
        command,
        affectedRows: statement.mutating ? rowCount : undefined,
        durationMs: Date.now() - started,
        result,
        messages,
      });
      await store.progress(job, outcomes);
    } catch (error) {
      outcomes.push({
        index,
        sql: statement.sql,
        sourceStart: statement.start,
        sourceEnd: statement.end,
        kind: statement.kind,
        durationMs: Date.now() - started,
        error: errorInfo(error),
        messages,
      });
      throw error;
    } finally {
      client.off('notice', notice);
    }
  }
}
