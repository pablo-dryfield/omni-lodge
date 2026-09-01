import dayjs from "dayjs";
import type {
  FinanceRecurringFrequency,
  FinanceRecurringExecutionResult,
  FinanceRecurringRule,
  FinanceRecurringStatus,
  FinanceRecurringTemplate,
} from "../../types/finance";

export type RecurringRuleDraft = {
  kind: "income" | "expense";
  frequency: FinanceRecurringFrequency;
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  accountId: number | null;
  categoryId: number | null;
  counterpartyId: number | null;
  amountMinor: number;
  currency: string;
  description: string;
};

export type RecurringRulePayload = {
  kind: "income" | "expense";
  frequency: FinanceRecurringFrequency;
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  templateJson: FinanceRecurringTemplate;
};

export type RecurringRuleLifecycle = {
  label: "Active" | "Paused" | "Due" | "Ended" | "Needs attention";
  color: "teal" | "gray" | "orange" | "blue" | "red";
};

export type MonthlyProjection = Record<string, { incomeMinor: number; expenseMinor: number }>;

export type RecurringExecutionPresentation = {
  color: "teal" | "orange" | "red";
  title: "Recurring run complete" | "More catch-up remains" | "Run finished with errors";
};

const asPositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const asString = (value: unknown): string => typeof value === "string" ? value : "";

export const usesMonthDay = (frequency: FinanceRecurringFrequency): boolean =>
  frequency === "monthly" || frequency === "quarterly" || frequency === "yearly";

export const recurringFrequencyUnit = (
  frequency: FinanceRecurringFrequency,
  interval: number,
): string => {
  const plural = interval !== 1;
  const units: Record<FinanceRecurringFrequency, [string, string]> = {
    daily: ["day", "days"],
    weekly: ["week", "weeks"],
    monthly: ["month", "months"],
    quarterly: ["quarter", "quarters"],
    yearly: ["year", "years"],
  };
  return units[frequency][plural ? 1 : 0];
};

export const createRecurringRuleDraft = (
  rule?: FinanceRecurringRule | null,
  fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Warsaw",
): RecurringRuleDraft => {
  if (!rule) {
    const startDate = dayjs().format("YYYY-MM-DD");
    return {
      kind: "expense",
      frequency: "monthly",
      interval: 1,
      byMonthDay: dayjs(startDate).date(),
      startDate,
      endDate: null,
      timezone: fallbackTimezone,
      accountId: null,
      categoryId: null,
      counterpartyId: null,
      amountMinor: 0,
      currency: "PLN",
      description: "",
    };
  }

  const template = rule.templateJson as Record<string, unknown>;
  return {
    kind: rule.kind,
    frequency: rule.frequency,
    interval: rule.interval,
    byMonthDay: usesMonthDay(rule.frequency)
      ? rule.byMonthDay ?? dayjs(rule.startDate).date()
      : null,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timezone: rule.timezone || fallbackTimezone,
    accountId: asPositiveInteger(template.accountId),
    categoryId: asPositiveInteger(template.categoryId),
    counterpartyId: asPositiveInteger(template.counterpartyId),
    amountMinor: asPositiveInteger(template.amountMinor) ?? 0,
    currency: asString(template.currency).trim().toUpperCase() || "PLN",
    description: asString(template.description),
  };
};

export const buildRecurringRulePayload = (
  draft: RecurringRuleDraft,
  existingTemplate: Record<string, unknown> = {},
): RecurringRulePayload => {
  const normalizedCurrency = draft.currency.trim().toUpperCase();
  const monthDay = usesMonthDay(draft.frequency)
    ? draft.byMonthDay ?? dayjs(draft.startDate).date()
    : null;

  return {
    kind: draft.kind,
    frequency: draft.frequency,
    interval: draft.interval,
    byMonthDay: monthDay,
    startDate: draft.startDate,
    endDate: draft.endDate,
    timezone: draft.timezone.trim(),
    templateJson: {
      ...existingTemplate,
      kind: draft.kind,
      accountId: draft.accountId as number,
      currency: normalizedCurrency,
      amountMinor: draft.amountMinor,
      categoryId: draft.categoryId as number,
      counterpartyType: draft.kind === "expense" ? "vendor" : "client",
      counterpartyId: draft.counterpartyId as number,
      status: "planned",
      description: draft.description.trim() || null,
    },
  };
};

export const isValidTimezone = (timezone: string): boolean => {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: timezone.trim() }).format(new Date());
    return Boolean(timezone.trim());
  } catch {
    return false;
  }
};

export const validateRecurringRuleDraft = (draft: RecurringRuleDraft): string | null => {
  if (!draft.accountId || !draft.categoryId || !draft.counterpartyId) {
    return `Select an account, category, and ${draft.kind === "expense" ? "vendor" : "client"}.`;
  }
  if (!Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    return "Amount must be greater than zero.";
  }
  if (!Number.isSafeInteger(draft.interval) || draft.interval <= 0) {
    return "Repeat interval must be a positive whole number.";
  }
  if (usesMonthDay(draft.frequency)) {
    if (!Number.isSafeInteger(draft.byMonthDay) || (draft.byMonthDay ?? 0) < 1 || (draft.byMonthDay ?? 0) > 31) {
      return "Month day must be between 1 and 31.";
    }
  }
  if (!dayjs(draft.startDate, "YYYY-MM-DD", true).isValid()) {
    return "Select a valid start date.";
  }
  if (
    draft.endDate
    && (
      !dayjs(draft.endDate, "YYYY-MM-DD", true).isValid()
      || dayjs(draft.endDate).isBefore(draft.startDate, "day")
    )
  ) {
    return "End date must be on or after the start date.";
  }
  if (!/^[A-Z]{3}$/.test(draft.currency.trim().toUpperCase())) {
    return "Currency must be a three-letter code, such as PLN or EUR.";
  }
  if (!isValidTimezone(draft.timezone)) {
    return "Enter a valid timezone, such as Europe/Warsaw.";
  }
  return null;
};

export const describeRecurringSchedule = (
  rule: Pick<FinanceRecurringRule, "frequency" | "interval" | "byMonthDay" | "startDate">,
): string => {
  const intervalPrefix = rule.interval === 1 ? "Every" : `Every ${rule.interval}`;
  const unit = recurringFrequencyUnit(rule.frequency, rule.interval);
  const start = dayjs(rule.startDate);

  if (rule.frequency === "weekly") {
    const weekday = start.isValid() ? start.format("dddd") : "start weekday";
    return `${intervalPrefix} ${unit} on ${weekday}`;
  }
  if (rule.frequency === "yearly") {
    const month = start.isValid() ? start.format("MMMM") : "the start month";
    const monthDay = rule.byMonthDay ?? (start.isValid() ? start.date() : null);
    return `${intervalPrefix} ${unit} in ${month}${monthDay ? ` on day ${monthDay}` : ""}`;
  }
  if (usesMonthDay(rule.frequency)) {
    const monthDay = rule.byMonthDay ?? (start.isValid() ? start.date() : null);
    return `${intervalPrefix} ${unit}${monthDay ? ` on day ${monthDay}` : ""}`;
  }
  return `${intervalPrefix} ${unit}`;
};

export const getRecurringRuleLifecycle = (
  rule: Pick<FinanceRecurringRule, "status" | "endDate" | "nextRunDate" | "lastError" | "consecutiveFailures">,
  now: dayjs.ConfigType = dayjs(),
): RecurringRuleLifecycle => {
  if (rule.status === "completed") {
    return { label: "Ended", color: "blue" };
  }
  if (rule.status === "paused") {
    return { label: "Paused", color: "gray" };
  }
  if (rule.lastError || (rule.consecutiveFailures ?? 0) > 0) {
    return { label: "Needs attention", color: "red" };
  }
  const today = dayjs(now);
  if (rule.endDate && dayjs(rule.endDate).isBefore(today, "day")) {
    return { label: "Ended", color: "blue" };
  }
  if (rule.nextRunDate && !dayjs(rule.nextRunDate).isAfter(today)) {
    return { label: "Due", color: "orange" };
  }
  return { label: "Active", color: "teal" };
};

export const changeDraftFrequency = (
  draft: RecurringRuleDraft,
  frequency: FinanceRecurringFrequency,
): RecurringRuleDraft => ({
  ...draft,
  frequency,
  byMonthDay: usesMonthDay(frequency)
    ? draft.byMonthDay ?? dayjs(draft.startDate).date()
    : null,
});

export const changeDraftStartDate = (
  draft: RecurringRuleDraft,
  startDate: string,
): RecurringRuleDraft => ({
  ...draft,
  startDate,
  byMonthDay: usesMonthDay(draft.frequency)
    ? dayjs(startDate).date()
    : draft.byMonthDay,
});

export const countRecurringLifecycle = (
  rules: FinanceRecurringRule[],
  now: dayjs.ConfigType = dayjs(),
): Record<"active" | "paused" | "due" | "ended" | "needsAttention", number> =>
  rules.reduce(
    (counts, rule) => {
      const label = getRecurringRuleLifecycle(rule, now).label;
      const key = label === "Needs attention"
        ? "needsAttention"
        : label.toLowerCase() as Exclude<keyof typeof counts, "needsAttention">;
      counts[key] += 1;
      return counts;
    },
    { active: 0, paused: 0, due: 0, ended: 0, needsAttention: 0 },
  );

const monthlyFrequencyMultiplier = (rule: FinanceRecurringRule): number => {
  const safeInterval = Math.max(1, rule.interval || 1);
  switch (rule.frequency) {
    case "daily":
      return (365.2425 / 12) / safeInterval;
    case "weekly":
      return (365.2425 / 7 / 12) / safeInterval;
    case "monthly":
      return 1 / safeInterval;
    case "quarterly":
      return 1 / (3 * safeInterval);
    case "yearly":
      return 1 / (12 * safeInterval);
    default:
      return 0;
  }
};

export const projectRecurringRulesMonthly = (rules: FinanceRecurringRule[]): MonthlyProjection =>
  rules.reduce<MonthlyProjection>((projection, rule) => {
    if (rule.status !== "active" || (rule.endDate && dayjs(rule.endDate).isBefore(dayjs(), "day"))) {
      return projection;
    }
    const template = rule.templateJson as Record<string, unknown>;
    const amountMinor = Number(template.amountMinor);
    const currency = String(template.currency ?? "").trim().toUpperCase();
    if (!Number.isFinite(amountMinor) || amountMinor <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      return projection;
    }
    const monthlyMinor = Math.round(amountMinor * monthlyFrequencyMultiplier(rule));
    const bucket = projection[currency] ?? { incomeMinor: 0, expenseMinor: 0 };
    bucket[rule.kind === "income" ? "incomeMinor" : "expenseMinor"] += monthlyMinor;
    projection[currency] = bucket;
    return projection;
  }, {});

export const isEditableOccurrenceStatus = (status: string): boolean =>
  status === "planned" || status === "approved";

export const canToggleRecurringRuleStatus = (status: FinanceRecurringStatus): boolean =>
  status === "active" || status === "paused";

export const normalizeRecurringStatus = (value: unknown): FinanceRecurringStatus =>
  value === "paused" || value === "completed" ? value : "active";

export const getRecurringExecutionPresentation = (
  result: FinanceRecurringExecutionResult,
): RecurringExecutionPresentation => {
  if (result.failed > 0) {
    return {
      color: result.failed >= result.processed ? "red" : "orange",
      title: "Run finished with errors",
    };
  }
  if (result.deferred > 0) {
    return { color: "orange", title: "More catch-up remains" };
  }
  return { color: "teal", title: "Recurring run complete" };
};
