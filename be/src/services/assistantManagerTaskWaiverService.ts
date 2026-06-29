import dayjs from 'dayjs';
import { Op } from 'sequelize';
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import Counter from '../models/Counter.js';
import Product from '../models/Product.js';
import NightReport from '../models/NightReport.js';
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports.js';
import type { Transaction } from 'sequelize';

const NIGHT_REPORT_RULES_KEY = 'nightReportRules';
const DEFAULT_RULE_NOTE = DID_NOT_OPERATE_NOTE;
const DEFAULT_RULE_OFFSET_DAYS = 1;

type NightReportTaskWaiverRule = {
  action?: 'waive';
  noteEquals?: string;
  noteContains?: string;
  productIds?: number[];
  productNames?: string[];
  taskDateOffsetDays?: number;
};

type NightReportTaskWaiverSummary = {
  waivedCount: number;
  restoredCount: number;
  unchangedCount: number;
};

type SourceWaiverMeta = {
  autoWaived?: boolean;
  waiverPreviousStatus?: AssistantManagerTaskStatus | null;
  waiverAppliedAt?: string | null;
  waiverSource?: {
    kind: 'night_report';
    reportId: number;
    activityDate: string;
    counterId: number | null;
    productId: number | null;
    productName: string | null;
    note: string | null;
    taskDate: string;
    ruleIndex: number;
  };
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
};

const normalizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
};

const getNightReportRules = (template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null) => {
  const config = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const rawRules = config[NIGHT_REPORT_RULES_KEY];
  if (!Array.isArray(rawRules)) {
    return [];
  }

  return rawRules
    .map((entry): NightReportTaskWaiverRule | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const source = entry as Record<string, unknown>;
      const action = typeof source.action === 'string' ? source.action.trim().toLowerCase() : 'waive';
      if (action !== 'waive') {
        return null;
      }

      return {
        action: 'waive',
        noteEquals: typeof source.noteEquals === 'string' && source.noteEquals.trim()
          ? source.noteEquals.trim()
          : DEFAULT_RULE_NOTE,
        noteContains: typeof source.noteContains === 'string' && source.noteContains.trim()
          ? source.noteContains.trim()
          : undefined,
        productIds: normalizeNumberArray(source.productIds),
        productNames: normalizeStringArray(source.productNames),
        taskDateOffsetDays:
          typeof source.taskDateOffsetDays === 'number' && Number.isFinite(source.taskDateOffsetDays)
            ? Math.trunc(source.taskDateOffsetDays)
            : DEFAULT_RULE_OFFSET_DAYS,
      };
    })
    .filter((rule): rule is NightReportTaskWaiverRule => Boolean(rule));
};

const noteMatchesRule = (rule: NightReportTaskWaiverRule, note: string) => {
  const lowerNote = note.trim().toLowerCase();
  const expected = (rule.noteEquals ?? DEFAULT_RULE_NOTE).trim().toLowerCase();
  if (expected && lowerNote !== expected) {
    return false;
  }

  const contains = typeof rule.noteContains === 'string' ? rule.noteContains.trim().toLowerCase() : '';
  if (contains && !lowerNote.includes(contains)) {
    return false;
  }

  return true;
};

const productMatchesRule = (
  rule: NightReportTaskWaiverRule,
  productId: number | null,
  productName: string | null,
) => {
  const idRules = rule.productIds ?? [];
  const nameRules = rule.productNames ?? [];

  const idMatches =
    idRules.length === 0 ? true : productId != null && idRules.includes(productId);
  const nameMatches =
    nameRules.length === 0
      ? true
      : productName != null && nameRules.some((candidate) => candidate.toLowerCase() === productName.toLowerCase());

  return idMatches && nameMatches;
};

const toTaskDate = (activityDate: string, offsetDays: number | null | undefined) =>
  dayjs(activityDate).add(offsetDays ?? DEFAULT_RULE_OFFSET_DAYS, 'day').format('YYYY-MM-DD');

const readMeta = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const isAutoWaivedForReport = (meta: Record<string, unknown>, reportId: number): boolean => {
  if (meta.autoWaived !== true) {
    return false;
  }

  const source = meta.waiverSource;
  if (!source || typeof source !== 'object') {
    return false;
  }

  const sourceRecord = source as Record<string, unknown>;
  return Number(sourceRecord.reportId) === reportId && sourceRecord.kind === 'night_report';
};

const normalizeRestoredStatus = (value: unknown): AssistantManagerTaskStatus => {
  if (value === 'missed') {
    return value;
  }
  return 'pending';
};

const buildWaiverSource = (
  report: NightReport,
  taskDate: string,
  ruleIndex: number,
) => ({
  kind: 'night_report' as const,
  reportId: report.id,
  activityDate: report.activityDate,
  counterId: report.counterId ?? null,
  productId: report.counter?.productId ?? null,
  productName: report.counter?.product?.name ?? null,
  note: report.notes ?? null,
  taskDate,
  ruleIndex,
});

const getTemplatesWithRules = async () => {
  const templates = await AssistantManagerTaskTemplate.findAll({
    attributes: ['id', 'name', 'scheduleConfig'],
  });

  return templates
    .map((template) => ({
      template,
      rules: getNightReportRules(template),
    }))
    .filter(({ rules }) => rules.length > 0);
};

const reconcileReportTargetLogs = async (
  report: NightReport,
  mode: 'sync' | 'restore' = 'sync',
  transaction?: Transaction | null,
): Promise<NightReportTaskWaiverSummary> => {
  const note = (report.notes ?? '').trim();
  const productId = report.counter?.productId ?? null;
  const productName = report.counter?.product?.name ?? null;
  const templatesWithRules = await getTemplatesWithRules();
  const affectedTemplates = templatesWithRules.filter(({ rules }) =>
    rules.some((rule) => productMatchesRule(rule, productId, productName)),
  );

  if (affectedTemplates.length === 0) {
    return { waivedCount: 0, restoredCount: 0, unchangedCount: 0 };
  }

  let waivedCount = 0;
  let restoredCount = 0;
  let unchangedCount = 0;

  for (const { template, rules } of affectedTemplates) {
    for (const [ruleIndex, rule] of rules.entries()) {
      if (!productMatchesRule(rule, productId, productName)) {
        continue;
      }

      const targetTaskDate = toTaskDate(report.activityDate, rule.taskDateOffsetDays);
      const logs = await AssistantManagerTaskLog.findAll({
        where: {
          templateId: template.id,
          taskDate: targetTaskDate,
          status: { [Op.ne]: 'completed' },
        },
        transaction: transaction ?? undefined,
      });

      for (const log of logs) {
        const meta = readMeta(log.meta);
        if (meta.manual === true) {
          unchangedCount += 1;
          continue;
        }

        const shouldApply =
          mode !== 'restore' &&
          report.status === 'submitted' &&
          noteMatchesRule(rule, note);

        if (!shouldApply) {
          if (!isAutoWaivedForReport(meta, report.id)) {
            unchangedCount += 1;
            continue;
          }

          const restoredStatus = normalizeRestoredStatus(meta.waiverPreviousStatus);
          const nextMeta = { ...meta };
          delete nextMeta.autoWaived;
          delete nextMeta.waiverPreviousStatus;
          delete nextMeta.waiverAppliedAt;
          delete nextMeta.waiverSource;

          await AssistantManagerTaskLog.update(
            {
              status: restoredStatus,
              completedAt: restoredStatus === 'completed' ? log.completedAt ?? new Date() : null,
              meta: nextMeta,
            },
            { where: { id: log.id }, transaction: transaction ?? undefined },
          );
          restoredCount += 1;
          continue;
        }

        if (log.status === 'waived' && !isAutoWaivedForReport(meta, report.id)) {
          unchangedCount += 1;
          continue;
        }

        if (log.status === 'waived' && isAutoWaivedForReport(meta, report.id)) {
          unchangedCount += 1;
          continue;
        }

        const nextMeta: SourceWaiverMeta & Record<string, unknown> = {
          ...meta,
          autoWaived: true,
          waiverPreviousStatus: log.status,
          waiverAppliedAt: new Date().toISOString(),
          waiverSource: buildWaiverSource(report, targetTaskDate, ruleIndex),
        };

        await AssistantManagerTaskLog.update(
          {
            status: 'waived',
            completedAt: null,
            meta: nextMeta,
          },
          { where: { id: log.id }, transaction: transaction ?? undefined },
        );
        waivedCount += 1;
      }
    }
  }

  return { waivedCount, restoredCount, unchangedCount };
};

export const reconcileNightReportTaskWaiversForReport = async (
  report: NightReport,
  options?: { mode?: 'sync' | 'restore'; transaction?: Transaction | null },
): Promise<NightReportTaskWaiverSummary> =>
  reconcileReportTargetLogs(report, options?.mode ?? 'sync', options?.transaction ?? null);

export const reconcileNightReportTaskWaiversForRange = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  options?: { lookbackDays?: number; transaction?: Transaction | null },
): Promise<NightReportTaskWaiverSummary> => {
  const lookbackDays = options?.lookbackDays ?? 7;
  const reports = await NightReport.findAll({
    where: {
      activityDate: {
        [Op.between]: [rangeStart.subtract(lookbackDays, 'day').format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD')],
      },
      status: 'submitted',
    },
    include: [
      {
        model: Counter,
        as: 'counter',
        required: false,
        attributes: ['id', 'productId'],
        include: [{ model: Product, as: 'product', required: false, attributes: ['id', 'name'] }],
      },
    ],
  });

  const summary: NightReportTaskWaiverSummary = {
    waivedCount: 0,
    restoredCount: 0,
    unchangedCount: 0,
  };

  for (const report of reports) {
    const next = await reconcileReportTargetLogs(report, 'sync', options?.transaction ?? null);
    summary.waivedCount += next.waivedCount;
    summary.restoredCount += next.restoredCount;
    summary.unchangedCount += next.unchangedCount;
  }

  return summary;
};
