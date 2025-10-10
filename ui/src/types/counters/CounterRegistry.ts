export type MetricTallyType = 'booked' | 'attended';
export type MetricPeriod = 'before_cutoff' | 'after_cutoff' | null;
export type MetricKind = 'people' | 'addon' | 'cash_payment';

export type CounterStatus = 'draft' | 'platforms' | 'reservations' | 'final';

export type StaffOption = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  userTypeSlug: string | null;
  userTypeName: string | null;
};

export type AddonConfig = {
  addonId: number;
  name: string;
  key: string;
  maxPerAttendee: number | null;
  sortOrder: number;
  priceOverride?: number | null;
};

export type CatalogProduct = {
  id: number;
  name: string;
  status: boolean;
  productTypeId: number;
  price: number;
  allowedAddOns: AddonConfig[];
};

export type ChannelConfig = {
  id: number;
  name: string;
  sortOrder: number;
};

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

export type CounterSummaryBucket = {
  bookedBefore: number;
  bookedAfter: number;
  attended: number;
  nonShow: number;
};

export type CounterSummaryAddonBucket = CounterSummaryBucket & {
  addonId: number;
  name: string;
  key: string;
};

export type CounterSummaryChannel = {
  channelId: number;
  channelName: string;
  people: CounterSummaryBucket;
  addons: Record<string, CounterSummaryAddonBucket>;
};

export type CounterSummary = {
  byChannel: CounterSummaryChannel[];
  totals: {
    people: CounterSummaryBucket;
    addons: Record<string, CounterSummaryAddonBucket>;
  };
};

export type CounterRegistryMetricStaff = {
  userId: number;
  role: string;
  name: string;
  userTypeSlug: string | null;
  userTypeName: string | null;
};

export type CounterRegistryManager = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
};

export type CounterRegistryProductSummary = {
  id: number;
  name: string;
};

export type CounterRegistryPayload = {
  counter: {
    id: number;
    date: string;
    userId: number;
    status: CounterStatus;
    notes: string | null;
    productId: number | null;
    createdAt: string;
    updatedAt: string;
    manager: CounterRegistryManager | null;
    product: CounterRegistryProductSummary | null;
  };
  staff: CounterRegistryMetricStaff[];
  metrics: MetricCell[];
  derivedSummary: CounterSummary;
  addons: AddonConfig[];
  channels: ChannelConfig[];
};
