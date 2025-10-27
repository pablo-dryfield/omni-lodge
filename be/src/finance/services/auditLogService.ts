import FinanceAuditLog from '../models/FinanceAuditLog.js';

type AuditLogParams = {
  entity: string;
  entityId: number;
  action: string;
  performedBy?: number | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordFinanceAuditLog({
  entity,
  entityId,
  action,
  performedBy = null,
  changes = null,
  metadata = null,
}: AuditLogParams): Promise<FinanceAuditLog> {
  return FinanceAuditLog.create({
    entity,
    entityId,
    action,
    performedBy,
    changes,
    metadata,
  });
}

