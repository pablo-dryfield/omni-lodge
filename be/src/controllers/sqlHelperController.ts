import type { Response } from 'express';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

type StatementType = 'read' | 'write';

const MAX_RESULT_ROWS = 500;
const MAX_STATEMENTS_PER_REQUEST = 100;

type StatementExecutionResult = {
  statement: string;
  statementType: StatementType;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  affectedCount: number;
  truncated: boolean;
  columns: string[];
};

type RawSqlQueryResult = {
  rows?: unknown;
  rowCount?: unknown;
  affectedRows?: unknown;
};

type RawSqlConnection = {
  query: (sql: string) => Promise<unknown>;
};

type RawSqlConnectionManager = {
  getConnection: (options?: unknown) => Promise<RawSqlConnection>;
  releaseConnection: (connection: RawSqlConnection) => Promise<void> | void;
};

function sanitizeQuery(raw: string | undefined): string {
  if (!raw) {
    return '';
  }
  return raw.trim();
}

function splitTopLevelStatements(query: string): string[] {
  const statements: string[] = [];
  let index = 0;
  let statementStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | null = null;

  while (index < query.length) {
    const current = query[index] ?? '';
    const next = query[index + 1] ?? '';

    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
      }
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (current === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (current === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarQuoteTag) {
      if (query.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      if (current === '\'' && next === '\'') {
        index += 2;
        continue;
      }
      if (current === '\'') {
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      if (current === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (current === '"') {
        inDoubleQuote = false;
      }
      index += 1;
      continue;
    }

    if (current === '-' && next === '-') {
      lineComment = true;
      index += 2;
      continue;
    }

    if (current === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    if (current === '\'') {
      inSingleQuote = true;
      index += 1;
      continue;
    }

    if (current === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }

    if (current === '$') {
      const dollarMatch = query.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/u) ?? query.slice(index).match(/^\$\$/u);
      if (dollarMatch) {
        dollarQuoteTag = dollarMatch[0];
        index += dollarQuoteTag.length;
        continue;
      }
    }

    if (current === ';') {
      const candidate = query.slice(statementStart, index).trim();
      if (candidate.length > 0) {
        statements.push(candidate);
      }
      statementStart = index + 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  const tail = query.slice(statementStart).trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

function parseStatements(rawQuery: string): string[] {
  if (!rawQuery) {
    throw new HttpError(400, 'SQL query is required');
  }

  const statements = splitTopLevelStatements(rawQuery);
  if (statements.length === 0) {
    throw new HttpError(400, 'SQL query is required');
  }
  if (statements.length > MAX_STATEMENTS_PER_REQUEST) {
    throw new HttpError(400, `Too many statements. Maximum allowed is ${MAX_STATEMENTS_PER_REQUEST}`);
  }
  return statements;
}

function determineStatementType(query: string): StatementType {
  const withoutLeadingComments = query
    .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/u, '')
    .trimStart();

  const firstToken = withoutLeadingComments.match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? '';
  if (['select', 'with', 'show', 'explain', 'describe', 'values', 'table'].includes(firstToken)) {
    return 'read';
  }
  return 'write';
}

function detectTransactionControl(
  statement: string,
): 'begin' | 'commit' | 'rollback' | null {
  const normalized = statement
    .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/u, '')
    .trimStart();
  if (!normalized) {
    return null;
  }

  const first = normalized.match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? '';
  const second = normalized
    .slice(first.length)
    .trimStart()
    .match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? '';

  if (first === 'begin') {
    return 'begin';
  }
  if (first === 'start' && second === 'transaction') {
    return 'begin';
  }
  if (first === 'commit' || first === 'end') {
    return 'commit';
  }
  if (first === 'rollback') {
    return 'rollback';
  }

  return null;
}

function getRawSqlConnectionManager(): RawSqlConnectionManager {
  const candidate = (
    sequelize as unknown as { connectionManager?: RawSqlConnectionManager }
  ).connectionManager;
  if (!candidate || typeof candidate.getConnection !== 'function' || typeof candidate.releaseConnection !== 'function') {
    throw new HttpError(500, 'Database connection manager is not available');
  }
  return candidate;
}

function extractRows(rawResult: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawResult)) {
    return [];
  }
  if (rawResult.length === 0) {
    return [];
  }
  const firstRow = rawResult[0];
  if (!firstRow || typeof firstRow !== 'object' || Array.isArray(firstRow)) {
    return [];
  }
  return rawResult as Array<Record<string, unknown>>;
}

function extractRowsFromRawQueryResult(rawResult: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(rawResult)) {
    if (rawResult.length === 2 && Array.isArray(rawResult[0])) {
      return extractRows(rawResult[0]);
    }
    return extractRows(rawResult);
  }
  if (rawResult && typeof rawResult === 'object' && 'rows' in rawResult) {
    const rowsCandidate = (rawResult as RawSqlQueryResult).rows;
    return extractRows(rowsCandidate);
  }
  return [];
}

function extractAffectedRows(
  metadata: unknown,
  rows: Array<Record<string, unknown>>,
  statementType: StatementType,
): number {
  if (typeof metadata === 'number') {
    return metadata;
  }

  if (metadata && typeof metadata === 'object' && 'rowCount' in metadata) {
    const rawCount = (metadata as { rowCount?: unknown }).rowCount;
    if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
      return rawCount;
    }
  }

  if (statementType === 'read') {
    return rows.length;
  }

  return rows.length;
}

function extractAffectedRowsFromRawQueryResult(
  rawResult: unknown,
  rows: Array<Record<string, unknown>>,
  statementType: StatementType,
): number {
  if (rawResult && typeof rawResult === 'object') {
    const typed = rawResult as RawSqlQueryResult;
    if (typeof typed.rowCount === 'number' && Number.isFinite(typed.rowCount)) {
      return typed.rowCount;
    }
    if (typeof typed.affectedRows === 'number' && Number.isFinite(typed.affectedRows)) {
      return typed.affectedRows;
    }
  }
  return extractAffectedRows(undefined, rows, statementType);
}

function extractColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => columns.add(key));
  });
  return Array.from(columns);
}

async function executeSingleStatement(
  connection: RawSqlConnection,
  statement: string,
  statementType: StatementType,
): Promise<StatementExecutionResult> {
  const rawResult = await connection.query(statement);
  const rows = extractRowsFromRawQueryResult(rawResult);
  const affectedRows = extractAffectedRowsFromRawQueryResult(rawResult, rows, statementType);
  const limitedRows =
    rows.length > MAX_RESULT_ROWS ? rows.slice(0, MAX_RESULT_ROWS) : rows;
  return {
    statement,
    statementType,
    rows: limitedRows,
    rowCount: rows.length,
    affectedCount: affectedRows,
    truncated: rows.length > limitedRows.length,
    columns: extractColumns(limitedRows),
  };
}

export async function executeSql(req: AuthenticatedRequest, res: Response): Promise<void> {
  const sql = sanitizeQuery((req.body as { query?: string })?.query);
  const startedAt = Date.now();
  const connectionManager = getRawSqlConnectionManager();
  let connection: RawSqlConnection | null = null;
  let transactionOpen = false;
  let autoRollbackWarning: string | null = null;

  try {
    const statements = parseStatements(sql);
    const results: StatementExecutionResult[] = [];
    connection = await connectionManager.getConnection({});

    for (const statement of statements) {
      const statementType = determineStatementType(statement);
      const transactionControl = detectTransactionControl(statement);
      const result = await executeSingleStatement(connection, statement, statementType);
      results.push(result);

      if (transactionControl === 'begin') {
        transactionOpen = true;
      } else if (transactionControl === 'commit' || transactionControl === 'rollback') {
        transactionOpen = false;
      }
    }

    if (transactionOpen) {
      await connection.query('ROLLBACK');
      transactionOpen = false;
      autoRollbackWarning = 'Transaction was left open and has been rolled back automatically.';
    }

    const lastResult = results[results.length - 1];
    if (!lastResult) {
      throw new HttpError(400, 'No executable SQL statements were found');
    }

    res.status(200).json({
      statementType: lastResult.statementType,
      rows: lastResult.rows,
      rowCount: lastResult.rowCount,
      affectedCount: lastResult.affectedCount,
      truncated: lastResult.truncated,
      columns: lastResult.columns,
      statementCount: results.length,
      results: results.map((result, index) => ({
        index: index + 1,
        statement: result.statement,
        statementType: result.statementType,
        rows: result.rows,
        rowCount: result.rowCount,
        affectedCount: result.affectedCount,
        truncated: result.truncated,
        columns: result.columns,
      })),
      warning: autoRollbackWarning,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (connection && transactionOpen) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        // Ignore rollback failure and return original error.
      }
    }
    const message = error instanceof Error ? error.message : 'SQL execution failed';
    res.status(error instanceof HttpError ? error.status : 400).json({ message });
  } finally {
    if (connection) {
      try {
        await connectionManager.releaseConnection(connection);
      } catch {
        // Ignore release failures.
      }
    }
  }
}
