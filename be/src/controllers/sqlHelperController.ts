import type { Response } from 'express';
import { QueryTypes } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

type StatementType = 'read' | 'update' | 'delete';

const MAX_RESULT_ROWS = 500;

function sanitizeQuery(raw: string | undefined): string {
  if (!raw) {
    return '';
  }
  return raw.trim().replace(/;+$/u, '').trim();
}

function determineStatementType(query: string): StatementType {
  if (!query) {
    throw new HttpError(400, 'SQL query is required');
  }

  if (query.includes(';')) {
    throw new HttpError(400, 'Provide a single SQL statement without additional semicolons');
  }

  const firstToken = query.split(/\s+/u)[0]?.toLowerCase() ?? '';
  if (['select', 'with', 'show', 'explain'].includes(firstToken)) {
    return 'read';
  }
  if (firstToken === 'update') {
    return 'update';
  }
  if (firstToken === 'delete') {
    return 'delete';
  }

  throw new HttpError(
    400,
    'Only SELECT, WITH, SHOW, EXPLAIN, UPDATE, or DELETE statements are permitted',
  );
}

function extractColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => columns.add(key));
  });
  return Array.from(columns);
}

export async function executeSql(req: AuthenticatedRequest, res: Response): Promise<void> {
  const sql = sanitizeQuery((req.body as { query?: string })?.query);
  const statementType = determineStatementType(sql);

  const startedAt = Date.now();

  try {
    const outcome = await sequelize.transaction(async (transaction) => {
      await sequelize.query('SET LOCAL statement_timeout = 5000', { transaction });

      if (statementType === 'read') {
        const rows = await sequelize.query<Record<string, unknown>>(sql, {
          type: QueryTypes.SELECT,
          raw: true,
          transaction,
        });
        return { rows, affectedRows: rows.length };
      }

      const [maybeRows, metadata] = await sequelize.query(sql, { transaction });

      const rows =
        Array.isArray(maybeRows) && maybeRows.length > 0 && typeof maybeRows[0] === 'object'
          ? (maybeRows as Array<Record<string, unknown>>)
          : [];

      let affectedRows = 0;
      if (typeof metadata === 'number') {
        affectedRows = metadata;
      } else if (metadata && typeof metadata === 'object' && 'rowCount' in metadata) {
        const rawCount = (metadata as { rowCount?: number }).rowCount;
        affectedRows = typeof rawCount === 'number' ? rawCount : 0;
      } else if (!rows.length && Array.isArray(maybeRows)) {
        affectedRows = maybeRows.length;
      }

      return { rows, affectedRows };
    });

    const rows = outcome.rows ?? [];
    const affectedRows = outcome.affectedRows ?? rows.length;
    const limitedRows =
      rows.length > MAX_RESULT_ROWS ? rows.slice(0, MAX_RESULT_ROWS) : rows;
    const truncated = rows.length > limitedRows.length;

    res.status(200).json({
      statementType,
      rows: limitedRows,
      rowCount: rows.length,
      affectedCount: affectedRows,
      truncated,
      columns: extractColumns(limitedRows),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SQL execution failed';
    res.status(error instanceof HttpError ? error.status : 400).json({ message });
  }
}
