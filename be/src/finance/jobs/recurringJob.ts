import logger from '../../utils/logger.js';
import { executeRecurringRules } from '../services/recurringRuleService.js';
import { getConfigValue } from '../../services/configService.js';

let timerHandle: ReturnType<typeof setInterval> | null = null;
let runnerInFlight = false;

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 60 * 1000;
const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

function resolveAutomationUserId(): number {
  const raw = getConfigValue('FINANCE_AUTOMATION_USER_ID');
  if (!raw) {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function resolvePollIntervalMs(): number {
  const parsed = Number(getConfigValue('FINANCE_RECURRING_POLL_MS'));
  if (!Number.isSafeInteger(parsed) || parsed < MIN_POLL_INTERVAL_MS) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.min(parsed, MAX_POLL_INTERVAL_MS);
}

function isRecurringAutomationEnabled(): boolean {
  return getConfigValue('FINANCE_RECURRING_ENABLED') === true;
}

export function startFinanceRecurringJob(): void {
  const pollIntervalMs = resolvePollIntervalMs();
  if (timerHandle) {
    clearInterval(timerHandle);
  }

  const runner = async () => {
    // The setting is read on every tick so the control-panel switch takes
    // effect immediately after the shared configuration cache refreshes.
    if (!isRecurringAutomationEnabled() || runnerInFlight) {
      return;
    }
    runnerInFlight = true;
    try {
      const userId = resolveAutomationUserId();
      const result = await executeRecurringRules(userId);
      if (result.createdTransactions > 0 || result.failed > 0 || result.completed > 0) {
        logger.info(
          `Finance recurring job result: created=${result.createdTransactions}, processed=${result.processed}, skipped=${result.skipped}, failed=${result.failed}, completed=${result.completed}, deferred=${result.deferred}`,
        );
      }
    } catch (error) {
      logger.error(`Finance recurring job failed: ${(error as Error).message}`);
    } finally {
      runnerInFlight = false;
    }
  };

  void runner();
  timerHandle = setInterval(() => {
    void runner();
  }, pollIntervalMs);
}

export function stopFinanceRecurringJob(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}
