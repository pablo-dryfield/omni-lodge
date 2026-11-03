import { parse } from 'csv-parse';
import { relationDetails } from './catalog.js';
import { targetClient, assertRestrictedIdentity } from './connection.js';
import { quoteIdentifier } from './filters.js';
import { schemaFingerprint } from './schemaFingerprint.js';
import { parseSql } from './parser.js';
import {
  WorkspaceError,
  type Target,
  type Credential,
  type Limits,
  type WireValue,
  type Statement,
} from './types.js';

export type ImportData = { headers: string[]; rows: WireValue[][] };
export async function parseImport(
  content: unknown,
  format: unknown,
  options: {
    maxBytes: number;
    maxRows: number;
    delimiter?: string;
    nullToken?: string;
  },
): Promise<ImportData> {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content) > options.maxBytes
  )
    throw new WorkspaceError(
      413,
      'IMPORT_SIZE',
      'The import exceeds its configured byte budget.',
    );
  let headers: string[] = [],
    rows: WireValue[][] = [];
  if (format === 'csv') {
    const delimiter = options.delimiter || ',';
    if (![',', ';', '\t', '|'].includes(delimiter))
      throw new WorkspaceError(
        400,
        'IMPORT_DELIMITER',
        'Choose comma, semicolon, tab or pipe.',
      );
    const parser = parse(content, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      max_record_size: Math.min(options.maxBytes, 1048576),
      cast: (value, context) => ({ value, quoted: context.quoting }),
    });
    try {
      for await (const record of parser) {
        const cells = record as Array<{ value: string; quoted: boolean }>;
        if (!headers.length) headers = cells.map((cell) => cell.value);
        else {
          rows.push(
            cells.map(({ value, quoted }) =>
              options.nullToken !== undefined &&
              !quoted &&
              value === options.nullToken
                ? null
                : value,
            ),
          );
          if (rows.length > options.maxRows)
            throw new WorkspaceError(
              413,
              'IMPORT_ROWS',
              'This file exceeds the atomic row limit. Split it into explicitly reviewed imports.',
            );
        }
      }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError(
        400,
        'IMPORT_CSV',
        'CSV has inconsistent columns, invalid quoting or an oversized record.',
      );
    }
  } else if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new WorkspaceError(
        400,
        'IMPORT_JSON',
        'Use a valid JSON array of objects or an object containing headers and rows.',
      );
    }
    if (Array.isArray(parsed)) {
      if (!parsed.length)
        throw new WorkspaceError(
          400,
          'IMPORT_EMPTY',
          'The import has no rows.',
        );
      if (
        parsed.some(
          (row) => !row || typeof row !== 'object' || Array.isArray(row),
        )
      )
        throw new WorkspaceError(
          400,
          'IMPORT_JSON',
          'JSON rows must be objects with exact text or null values.',
        );
      headers = Object.keys(parsed[0]);
      if (
        parsed.some(
          (row) =>
            Object.keys(row).length !== headers.length ||
            headers.some((h) => !Object.hasOwn(row, h)),
        )
      )
        throw new WorkspaceError(
          400,
          'IMPORT_COLUMNS',
          'Every JSON row must have the same fields.',
        );
      rows = parsed.map((row) => headers.map((h) => row[h]));
    } else {
      const data = parsed as {
        headers?: unknown;
        fields?: Array<{ name: string }>;
        rows?: unknown;
      };
      headers = (data?.headers || data?.fields?.map((f) => f.name)) as string[];
      rows = data?.rows as WireValue[][];
    }
  } else
    throw new WorkspaceError(
      400,
      'IMPORT_FORMAT',
      'Choose CSV or JSON data. SQL files are not accepted as data imports.',
    );
  if (
    !Array.isArray(headers) ||
    !headers.length ||
    headers.length > 200 ||
    headers.some((h) => typeof h !== 'string' || !h || h.length > 200) ||
    new Set(headers).size !== headers.length
  )
    throw new WorkspaceError(
      400,
      'IMPORT_HEADERS',
      'Import headers must be nonempty and unique; at most 200 columns.',
    );
  if (!Array.isArray(rows) || !rows.length || rows.length > options.maxRows)
    throw new WorkspaceError(
      413,
      'IMPORT_ROWS',
      'Use a nonempty file within the atomic row limit.',
    );
  if (
    rows.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== headers.length ||
        row.some((v) => v !== null && typeof v !== 'string'),
    )
  )
    throw new WorkspaceError(
      400,
      'IMPORT_VALUES',
      'Use exact text strings or SQL null values. JSON numbers must be quoted to preserve precision; nested JSON must be a text value.',
    );
  return { headers, rows };
}
export async function prepareImport(
  target: Target,
  credential: Credential,
  protectedObjects: string[],
  limits: Limits,
  data: ImportData,
  request: Record<string, unknown>,
) {
  const details = await relationDetails(
    target,
    credential,
    String(request.objectId || ''),
    protectedObjects,
  );
  if (!['r', 'p'].includes(details.kind))
    throw new WorkspaceError(400, 'IMPORT_TABLE', 'Choose a base table.');
  type Column = {
    name: string;
    type: string;
    not_null: boolean;
    identity: string;
    generated: string;
    primary_key: boolean;
    default_value: string | null;
  };
  const columns = details.columns as unknown as Column[];
  const mapping = request.mapping as Record<string, string>;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new WorkspaceError(
      400,
      'IMPORT_MAPPING',
      'Map file columns to table columns.',
    );
  const selected = data.headers.filter((h) => mapping[h]);
  const mapped = selected.map((h) =>
    columns.find((c) => c.name === mapping[h]),
  );
  if (
    !mapped.length ||
    mapped.some((c) => !c || c.generated || c.identity) ||
    new Set(mapped.map((c) => c!.name)).size !== mapped.length
  )
    throw new WorkspaceError(
      400,
      'IMPORT_MAPPING',
      'Choose unique writable table columns. Generated and identity columns use their defaults.',
    );
  const chosen = mapped as Column[],
    names = chosen.map((c) => c.name),
    errors: Array<{ row: number; column: string; message: string }> = [];
  for (const c of columns)
    if (
      c.not_null &&
      !c.default_value &&
      !c.generated &&
      !c.identity &&
      !names.includes(c.name)
    )
      errors.push({
        row: 0,
        column: c.name,
        message: 'Required column is not mapped.',
      });
  const rows = data.rows.map((row) =>
    selected.map((h) => row[data.headers.indexOf(h)]),
  );
  const policy = String(request.duplicatePolicy || 'insert');
  if (!['insert', 'upsert', 'skip'].includes(policy))
    throw new WorkspaceError(
      400,
      'IMPORT_DUPLICATES',
      'Choose insert, upsert or skip existing keys.',
    );
  const keys = Array.isArray(request.keys) ? request.keys : [];
  const primary = columns.filter((c) => c.primary_key).map((c) => c.name);
  if (
    policy !== 'insert' &&
    (!primary.length ||
      keys.length !== primary.length ||
      primary.some((k) => !keys.includes(k) || !names.includes(k)))
  )
    throw new WorkspaceError(
      400,
      'IMPORT_KEY',
      'Select and map the complete primary key for duplicate handling.',
    );
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    chosen.forEach((c, j) => {
      if (c.not_null && row[j] === null && errors.length < 100)
        errors.push({
          row: i + 1,
          column: c.name,
          message: 'SQL NULL is not allowed.',
        });
    });
    if (keys.length) {
      const key = JSON.stringify(
        keys.map((k) => row[names.indexOf(String(k))]),
      );
      if (seen.has(key) && errors.length < 100)
        errors.push({
          row: i + 1,
          column: keys.join(', '),
          message:
            'Duplicate key inside this import. Resolve it explicitly before saving.',
        });
      seen.add(key);
    }
  });
  const client = targetClient(
    target,
    credential,
    'omnilodge-workspace-import-validation',
  );
  let fingerprint = '';
  try {
    await client.connect();
    await assertRestrictedIdentity(client, target);
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('statement_timeout',$1,true)", [
      String(limits.readTimeoutMs),
    ]);
    fingerprint = await schemaFingerprint(client, details.id);
    // Cast batches without invoking INSERT, defaults, sequences or data triggers.
    // Split failing batches to return row-specific conversion diagnostics.
    const validate = async (
      column: Column,
      j: number,
      indexes: number[],
    ): Promise<void> => {
      if (!indexes.length || errors.length >= 100) return;
      await client.query('SAVEPOINT import_cast');
      try {
        await client.query(
          `SELECT x::${column.type} FROM unnest($1::text[]) AS x`,
          [indexes.map((i) => rows[i][j])],
        );
        await client.query('RELEASE SAVEPOINT import_cast');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT import_cast');
        await client.query('RELEASE SAVEPOINT import_cast');
        if (indexes.length === 1)
          errors.push({
            row: indexes[0] + 1,
            column: column.name,
            message: `Value cannot be converted to ${column.type}.`,
          });
        else {
          const half = Math.ceil(indexes.length / 2);
          await validate(column, j, indexes.slice(0, half));
          await validate(column, j, indexes.slice(half));
        }
      }
    };
    for (let j = 0; j < chosen.length; j++)
      for (let offset = 0; offset < rows.length; offset += 200)
        await validate(
          chosen[j],
          j,
          Array.from(
            { length: Math.min(200, rows.length - offset) },
            (_, n) => offset + n,
          ),
        );
    await client.query('ROLLBACK');
  } finally {
    await client.end().catch(() => {});
  }
  if (errors.length)
    return {
      errors,
      rows: rows.length,
      columns: names,
      sample: rows.slice(0, 20),
      statements: [] as Statement[],
      schemaChecks: [],
    };
  const statements: Statement[] = [];
  const batchRows = Math.min(200, Math.floor(60000 / names.length));
  for (let offset = 0; offset < rows.length; offset += batchRows) {
    const values: WireValue[] = [],
      tuples = rows.slice(offset, offset + batchRows).map(
        (row) =>
          `(${row
            .map((v) => {
              values.push(v);
              return `$${values.length}`;
            })
            .join(',')})`,
      );
    const update = names
      .filter((n) => !keys.includes(n))
      .map((n) => `${quoteIdentifier(n)}=EXCLUDED.${quoteIdentifier(n)}`)
      .join(',');
    const conflict =
      policy === 'insert'
        ? ''
        : ` ON CONFLICT (${keys.map((k) => quoteIdentifier(String(k))).join(',')}) ${policy === 'skip' || !update ? 'DO NOTHING' : `DO UPDATE SET ${update}`}`;
    const sql = `INSERT INTO ${details.qualifiedName} (${names.map(quoteIdentifier).join(',')}) VALUES ${tuples.join(',')}${conflict}`;
    const [statement] = await parseSql(sql, target.major, {
      maxBytes: limits.queryMaxBytes,
      maxStatements: 1,
      mode: 'write',
      schemas: target.schemas,
      protectedObjects,
    });
    statement.parameters = values;
    statements.push(statement);
  }
  if (statements.length > limits.batchMaxStatements)
    throw new WorkspaceError(
      413,
      'IMPORT_STATEMENT_LIMIT',
      'Split this import into smaller explicitly reviewed files.',
    );
  return {
    errors,
    rows: rows.length,
    columns: names,
    sample: rows.slice(0, 20),
    statements,
    schemaChecks: [
      { oid: details.id, qualifiedName: details.qualifiedName, fingerprint },
    ],
  };
}
