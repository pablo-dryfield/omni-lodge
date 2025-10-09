import type {
  MetricCell,
  MetricKind,
  MetricPeriod,
  MetricTallyType,
} from '../types/counters/CounterRegistry';

type BuildMetricKeyParams = {
  channelId: number;
  kind: MetricKind;
  addonId: number | null;
  tallyType: MetricTallyType;
  period: MetricPeriod;
};

export const buildMetricKey = ({
  channelId,
  kind,
  addonId,
  tallyType,
  period,
}: BuildMetricKeyParams): string => {
  const normalizedPeriod =
    tallyType === 'booked' ? (period ?? 'before_cutoff') : tallyType === 'attended' ? null : period ?? null;
  return [channelId, kind, addonId ?? 'null', tallyType, normalizedPeriod ?? 'none'].join('|');
};

export const normalizeMetric = (metric: MetricCell): MetricCell => {
  const normalizedPeriod: MetricPeriod =
    metric.tallyType === 'booked'
      ? metric.period ?? 'before_cutoff'
      : metric.tallyType === 'attended'
      ? null
      : metric.period ?? null;

  return {
    ...metric,
    period: normalizedPeriod,
    qty: Number.isFinite(metric.qty) ? metric.qty : 0,
  };
};
