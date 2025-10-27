import sequelize from '../../config/database.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceBudget from '../models/FinanceBudget.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceClient from '../models/FinanceClient.js';
import FinanceManagementRequest from '../models/FinanceManagementRequest.js';
import FinanceRecurringRule from '../models/FinanceRecurringRule.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceVendor from '../models/FinanceVendor.js';
import { recordFinanceAuditLog } from './auditLogService.js';
import { createFinanceTransaction, updateFinanceTransaction, FinanceTransactionInput } from './transactionService.js';

type GenericPayload = Record<string, unknown>;

function ensureObject(payload: unknown): GenericPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload as GenericPayload;
}

export async function applyManagementRequest(request: FinanceManagementRequest, managerId: number): Promise<void> {
  const payload = ensureObject(request.payload);
  const target = request.targetEntity.toLowerCase();

  await sequelize.transaction(async (transaction) => {
    switch (target) {
      case 'transaction': {
        const data = payload as FinanceTransactionInput;
        if (request.targetId) {
          await updateFinanceTransaction(request.targetId, data, managerId, { transaction });
        } else {
          await createFinanceTransaction(data, managerId, { transaction });
        }
        break;
      }
      case 'recurring_rule': {
        if (request.targetId) {
          await FinanceRecurringRule.update(payload, {
            where: { id: request.targetId },
            transaction,
          });
        } else {
          await FinanceRecurringRule.create(
            {
              ...payload,
              createdBy: managerId,
            },
            { transaction },
          );
        }
        break;
      }
      case 'account': {
        if (request.targetId) {
          await FinanceAccount.update(payload, { where: { id: request.targetId }, transaction });
        } else {
          await FinanceAccount.create(payload, { transaction });
        }
        break;
      }
      case 'category': {
        if (request.targetId) {
          await FinanceCategory.update(payload, { where: { id: request.targetId }, transaction });
        } else {
          await FinanceCategory.create(payload, { transaction });
        }
        break;
      }
      case 'vendor': {
        if (request.targetId) {
          await FinanceVendor.update(payload, { where: { id: request.targetId }, transaction });
        } else {
          await FinanceVendor.create(payload, { transaction });
        }
        break;
      }
      case 'client': {
        if (request.targetId) {
          await FinanceClient.update(payload, { where: { id: request.targetId }, transaction });
        } else {
          await FinanceClient.create(payload, { transaction });
        }
        break;
      }
      case 'budget': {
        if (request.targetId) {
          await FinanceBudget.update(payload, { where: { id: request.targetId }, transaction });
        } else {
          await FinanceBudget.create(payload, { transaction });
        }
        break;
      }
      default:
        throw new Error(`Unsupported management request target: ${request.targetEntity}`);
    }

    await recordFinanceAuditLog({
      entity: `finance_management_request`,
      entityId: request.id,
      action: 'approved',
      performedBy: managerId,
      metadata: {
        target: request.targetEntity,
        targetId: request.targetId,
      },
    });
  });
}

