import FinanceAuditLog from '../models/FinanceAuditLog.js';
import type { Transaction as SequelizeTransaction } from 'sequelize';

type AuditLogParams = {
  entity: string;
  entityId: number;
  action: string;
  performedBy?: number | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  transaction?: SequelizeTransaction;
};

export async function recordFinanceAuditLog({
  entity,
  entityId,
  action,
  performedBy = null,
  changes = null,
  metadata = null,
  transaction,
}: AuditLogParams): Promise<FinanceAuditLog> {
  return FinanceAuditLog.create(
    {
      entity,
      entityId,
      action,
      performedBy,
      changes,
      metadata,
    },
    { transaction },
  );
}
