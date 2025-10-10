import slugify from '../utils/slugify.js';

export type MetricPeriod = 'before_cutoff' | 'after_cutoff' | null;
export type MetricTallyType = 'booked' | 'attended';
export type MetricKind = 'people' | 'addon' | 'cash_payment';

export type MetricCell = {
  id?: number;
  counterId: number;
  channelId: number;
  kind: MetricKind;
  addonId: number | null;
  tallyType: MetricTallyType;
  period: MetricPeriod;
  qty: number;
};

export type ChannelConfig = {
  id: number;
  name: string;
  sortOrder: number;
};

export type AddonConfig = {
  addonId: number;
  name: string;
  key: string;
  maxPerAttendee: number | null;
  sortOrder: number;
};

type CreateMetricGridParams = {
  counterId: number;
  channels: ChannelConfig[];
  addons: AddonConfig[];
  existingMetrics: MetricCell[];
};

type SummaryBucket = {
  bookedBefore: number;
  bookedAfter: number;
  attended: number;
  nonShow: number;
};

export type CounterSummaryAddonBucket = {
  addonId: number;
  name: string;
  key: string;
} & SummaryBucket;

export type CounterSummaryPeopleBucket = SummaryBucket;

export type CounterSummaryChannel = {
  channelId: number;
  channelName: string;
  people: CounterSummaryPeopleBucket;
  addons: Record<string, CounterSummaryAddonBucket>;
};

export type CounterSummary = {
  byChannel: CounterSummaryChannel[];
  totals: {
    people: CounterSummaryPeopleBucket;
    addons: Record<string, CounterSummaryAddonBucket>;
  };
};

export const PERIOD_BUCKETS: MetricPeriod[] = ['before_cutoff', 'after_cutoff', null];

type MetricBlueprint = {
  tallyType: MetricTallyType;
  period: MetricPeriod;
};

const METRIC_BLUEPRINT: MetricBlueprint[] = [
  { tallyType: 'booked', period: 'before_cutoff' },
  { tallyType: 'booked', period: 'after_cutoff' },
  { tallyType: 'attended', period: null },
];

const WALK_IN_CHANNEL_NAME = 'walk-in';

export function buildMetricKey({
  channelId,
  kind,
  addonId,
  tallyType,
  period,
}: {
  channelId: number;
  kind: MetricKind;
  addonId: number | null;
  tallyType: MetricTallyType;
  period: MetricPeriod;
}): string {
  return [channelId, kind, addonId ?? 'null', tallyType, period ?? 'attended'].join('|');
}

export function createMetricGrid(params: CreateMetricGridParams): MetricCell[] {
  const { counterId, channels, addons, existingMetrics } = params;
  const existingMap = new Map<string, MetricCell>();

  for (const metric of existingMetrics) {
    const key = buildMetricKey({
      channelId: metric.channelId,
      kind: metric.kind,
      addonId: metric.addonId ?? null,
      tallyType: metric.tallyType,
      period: metric.period ?? null,
    });
    existingMap.set(key, metric);
  }

  const sortedChannels = [...channels].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const sortedAddons = [...addons].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  const cells: MetricCell[] = [];

  for (const channel of sortedChannels) {
    const normalizedChannelName = channel.name?.toLowerCase() ?? '';

    for (const blueprint of METRIC_BLUEPRINT) {
      const key = buildMetricKey({
        channelId: channel.id,
        kind: 'people',
        addonId: null,
        tallyType: blueprint.tallyType,
        period: blueprint.period,
      });
      const existing = existingMap.get(key);
      cells.push({
        id: existing?.id,
        counterId: existing?.counterId ?? counterId,
        channelId: channel.id,
        kind: 'people',
        addonId: null,
        tallyType: blueprint.tallyType,
        period: blueprint.period,
        qty: Number(existing?.qty ?? 0),
      });
    }

    for (const addon of sortedAddons) {
      for (const blueprint of METRIC_BLUEPRINT) {
        const key = buildMetricKey({
          channelId: channel.id,
          kind: 'addon',
          addonId: addon.addonId,
          tallyType: blueprint.tallyType,
          period: blueprint.period,
        });
        const existing = existingMap.get(key);
        cells.push({
          id: existing?.id,
          counterId: existing?.counterId ?? counterId,
          channelId: channel.id,
          kind: 'addon',
          addonId: addon.addonId,
          tallyType: blueprint.tallyType,
          period: blueprint.period,
          qty: Number(existing?.qty ?? 0),
        });
      }
    }

    const cashKey = buildMetricKey({
      channelId: channel.id,
      kind: 'cash_payment',
      addonId: null,
      tallyType: 'attended',
      period: null,
    });
    const existingCashMetric = existingMap.get(cashKey);
    if (existingCashMetric || normalizedChannelName === WALK_IN_CHANNEL_NAME) {
      cells.push({
        id: existingCashMetric?.id,
        counterId: existingCashMetric?.counterId ?? counterId,
        channelId: channel.id,
        kind: 'cash_payment',
        addonId: null,
        tallyType: 'attended',
        period: null,
        qty: Number(existingCashMetric?.qty ?? 0),
      });
    }
  }

  return cells;
}

function createEmptyPeopleSummary(): CounterSummaryPeopleBucket {
  return {
    bookedBefore: 0,
    bookedAfter: 0,
    attended: 0,
    nonShow: 0,
  };
}

function createEmptyAddonSummary(addon: AddonConfig): CounterSummaryAddonBucket {
  return {
    addonId: addon.addonId,
    name: addon.name,
    key: addon.key,
    bookedBefore: 0,
    bookedAfter: 0,
    attended: 0,
    nonShow: 0,
  };
}

type ComputeSummaryParams = {
  metrics: MetricCell[];
  channels: ChannelConfig[];
  addons: AddonConfig[];
};

export function computeSummary({ metrics, channels, addons }: ComputeSummaryParams): CounterSummary {
  const channelMap = new Map<number, CounterSummaryChannel>();
  const addonMap = new Map<number, AddonConfig>();

  for (const addon of addons) {
    addonMap.set(addon.addonId, addon);
  }

  for (const channel of channels) {
    const addonEntries = addons.map((addon) => [addon.key, createEmptyAddonSummary(addon)] as const);
    channelMap.set(channel.id, {
      channelId: channel.id,
      channelName: channel.name,
      people: createEmptyPeopleSummary(),
      addons: Object.fromEntries(addonEntries),
    });
  }

  for (const metric of metrics) {
    const channelSummary = channelMap.get(metric.channelId);
    if (!channelSummary) continue;

    const target: CounterSummaryPeopleBucket | CounterSummaryAddonBucket | undefined =
      metric.kind === 'people'
        ? channelSummary.people
        : (() => {
            if (metric.addonId == null) return undefined;
            const addon = addonMap.get(metric.addonId);
            if (!addon) return undefined;
            return channelSummary.addons[addon.key];
          })();

    if (!target) continue;

    if (metric.tallyType === 'booked') {
      if (metric.period === 'before_cutoff') {
        target.bookedBefore += metric.qty;
      } else if (metric.period === 'after_cutoff') {
        target.bookedAfter += metric.qty;
      }
    } else if (metric.tallyType === 'attended') {
      target.attended += metric.qty;
    }
  }

  const totals: CounterSummary['totals'] = {
    people: createEmptyPeopleSummary(),
    addons: {},
  };

  for (const addon of addons) {
    totals.addons[addon.key] = createEmptyAddonSummary(addon);
  }

  const byChannel: CounterSummaryChannel[] = [];

  for (const channel of channels) {
    const summary = channelMap.get(channel.id);
    if (!summary) continue;

    summary.people.nonShow = Math.max(
      summary.people.bookedBefore + summary.people.bookedAfter - summary.people.attended,
      0,
    );

    totals.people.bookedBefore += summary.people.bookedBefore;
    totals.people.bookedAfter += summary.people.bookedAfter;
    totals.people.attended += summary.people.attended;

    for (const addon of addons) {
      const addonSummary = summary.addons[addon.key];
      addonSummary.nonShow = Math.max(
        addonSummary.bookedBefore + addonSummary.bookedAfter - addonSummary.attended,
        0,
      );

      const totalAddon = totals.addons[addon.key];
      totalAddon.bookedBefore += addonSummary.bookedBefore;
      totalAddon.bookedAfter += addonSummary.bookedAfter;
      totalAddon.attended += addonSummary.attended;
    }

    byChannel.push(summary);
  }

  totals.people.nonShow = Math.max(
    totals.people.bookedBefore + totals.people.bookedAfter - totals.people.attended,
    0,
  );

  for (const addon of addons) {
    const totalAddon = totals.addons[addon.key];
    totalAddon.nonShow = Math.max(
      totalAddon.bookedBefore + totalAddon.bookedAfter - totalAddon.attended,
      0,
    );
  }

  return { byChannel, totals };
}

export function toAddonConfig(params: {
  addonId: number;
  name: string;
  maxPerAttendee: number | null;
  sortOrder: number;
}): AddonConfig {
  const { addonId, name, maxPerAttendee, sortOrder } = params;
  return {
    addonId,
    name,
    key: slugify(name) || `addon-${addonId}`,
    maxPerAttendee,
    sortOrder,
  };
}
