import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, where, fn, col } from 'sequelize';
import sequelize from '../../config/database.js';
import FinanceRecurringRule from '../models/FinanceRecurringRule.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import { createFinanceTransaction, FinanceTransactionInput } from './transactionService.js';
import { recordFinanceAuditLog } from './auditLogService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

function resolveDateInTimezone(date: string | Date | null, tz: string): dayjs.Dayjs | null {
  if (!date) {
    return null;
  }
  const value = typeof date === 'string' ? date : date.toISOString();
  try {
    return dayjs.utc(value).tz(tz);
  } catch {
    return dayjs(value);
  }
}

function computeNextRun(rule: FinanceRecurringRule, previousRun: dayjs.Dayjs): dayjs.Dayjs {
  const interval = rule.interval ?? 1;
  switch (rule.frequency) {
    case 'daily':
      return previousRun.add(interval, 'day');
    case 'weekly':
      return previousRun.add(interval, 'week');
    case 'monthly': {
      const base = previousRun.add(interval, 'month');
      const day = rule.byMonthDay ?? previousRun.date();
      return base.date(Math.min(day, base.daysInMonth()));
    }
    case 'quarterly': {
      const base = previousRun.add(3 * interval, 'month');
      const day = rule.byMonthDay ?? previousRun.date();
      return base.date(Math.min(day, base.daysInMonth()));
    }
    case 'yearly': {
      const base = previousRun.add(interval, 'year');
      const day = rule.byMonthDay ?? previousRun.date();
      return base.date(Math.min(day, base.daysInMonth()));
    }
    default:
      return previousRun.add(interval, 'day');
  }
}

function shouldStop(rule: FinanceRecurringRule, date: dayjs.Dayjs): boolean {
  if (!rule.endDate) {
    return false;
  }
  const end = dayjs(rule.endDate);
  return date.isAfter(end, 'day');
}

export async function executeRecurringRules(userId: number): Promise<{
  processed: number;
  createdTransactions: number;
  skipped: number;
}> {
  const now = dayjs();
  const rules = await FinanceRecurringRule.findAll({
    where: {
      status: 'active',
      [Op.or]: [
        { nextRunDate: { [Op.lte]: now.toDate() } },
        { nextRunDate: null },
      ],
    },
  });

  let processed = 0;
  let createdTransactions = 0;
  let skipped = 0;

  for (const rule of rules) {
    processed += 1;
    const tz = rule.timezone || 'UTC';
    const start = resolveDateInTimezone(rule.startDate, tz);
    let nextRun = resolveDateInTimezone(rule.nextRunDate, tz) ?? start;

    if (!start || !nextRun) {
      skipped += 1;
      continue;
    }

    if (shouldStop(rule, nextRun)) {
      skipped += 1;
      continue;
    }

    const runDate = nextRun.format('YYYY-MM-DD');

    const existing = await FinanceTransaction.findOne({
      where: {
        date: runDate,
        [Op.and]: [
          where(fn("jsonb_extract_path_text", col('meta'), 'recurring_rule_id'), String(rule.id)),
        ],
      },
    });

    if (existing) {
      skipped += 1;
      rule.nextRunDate = computeNextRun(rule, nextRun).toDate();
      rule.lastRunAt = now.toDate();
      await rule.save();
      continue;
    }

    const template = rule.templateJson as FinanceTransactionInput;
    const meta = {
      ...(template.meta ?? {}),
      recurring_rule_id: rule.id,
      recurring_scheduled_for: runDate,
    };

    await sequelize.transaction(async (transaction) => {
      await createFinanceTransaction(
        {
          ...template,
          date: runDate,
          status: template.status ?? 'planned',
          meta,
        },
        userId,
        { transaction },
      );
    });

    createdTransactions += 1;
    rule.lastRunAt = now.toDate();
    const upcoming = computeNextRun(rule, nextRun);
    rule.nextRunDate = upcoming.toDate();
    await rule.save();

    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: rule.id,
      action: 'execute',
      performedBy: userId,
      metadata: {
        runDate,
      },
    });
  }

  return { processed, createdTransactions, skipped };
}

