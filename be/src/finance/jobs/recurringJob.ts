import logger from '../../utils/logger.js';
import { executeRecurringRules } from '../services/recurringRuleService.js';

let timerHandle: NodeJS.Timer | null = null;

function resolveAutomationUserId(): number {
  const raw = process.env.FINANCE_AUTOMATION_USER_ID;
  if (!raw) {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

export function startFinanceRecurringJob(): void {
  const pollIntervalMs = Number(process.env.FINANCE_RECURRING_POLL_MS ?? 15 * 60 * 1000);
  if (timerHandle) {
    clearInterval(timerHandle);
  }

  const runner = async () => {
    try {
      const userId = resolveAutomationUserId();
      const result = await executeRecurringRules(userId);
      if (result.createdTransactions > 0) {
        logger.info(`Finance recurring job created ${result.createdTransactions} transactions (processed=${result.processed}, skipped=${result.skipped})`);
      }
    } catch (error) {
      logger.error(`Finance recurring job failed: ${(error as Error).message}`);
    }
  };

  void runner();
  timerHandle = setInterval(() => {
    void runner();
  }, pollIntervalMs);
}

