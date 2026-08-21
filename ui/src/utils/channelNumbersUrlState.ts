import dayjs from 'dayjs';

import { sortProductTypeQueryValues } from './productTypeQuery';

export type ChannelNumbersPreset = 'thisMonth' | 'lastMonth' | 'custom';
export type ChannelNumbersRange = [Date, Date];

export type ChannelNumbersUrlState = {
  preset: ChannelNumbersPreset;
  range: ChannelNumbersRange;
  startDate: string;
  endDate: string;
  productTypeIds: string[] | null;
};

export type ChannelNumbersUrlSelection = Pick<
  ChannelNumbersUrlState,
  'preset' | 'range' | 'productTypeIds'
>;

export const CHANNEL_NUMBERS_QUERY_PARAMS = {
  startDate: 'startDate',
  endDate: 'endDate',
  preset: 'period',
  productTypeIds: 'productTypes',
} as const;

const DATE_FORMAT = 'YYYY-MM-DD';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatDate = (value: Date) => dayjs(value).format(DATE_FORMAT);

const parseDateStrictly = (value: string | null): Date | null => {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid() || parsed.format(DATE_FORMAT) !== value) {
    return null;
  }

  return parsed.startOf('day').toDate();
};

const parsePreset = (value: string | null): ChannelNumbersPreset | null => {
  if (value === 'thisMonth' || value === 'lastMonth' || value === 'custom') {
    return value;
  }
  return null;
};

const sameRange = (left: ChannelNumbersRange, right: ChannelNumbersRange) =>
  formatDate(left[0]) === formatDate(right[0]) && formatDate(left[1]) === formatDate(right[1]);

export const resolveChannelNumbersPresetRange = (
  preset: Exclude<ChannelNumbersPreset, 'custom'>,
  referenceDate: Date = new Date(),
): ChannelNumbersRange => {
  const reference = dayjs(referenceDate);
  const target = preset === 'lastMonth' ? reference.subtract(1, 'month') : reference;
  return [target.startOf('month').toDate(), target.endOf('month').toDate()];
};

const defaultState = (referenceDate: Date): ChannelNumbersUrlState => {
  const range = resolveChannelNumbersPresetRange('thisMonth', referenceDate);
  return {
    preset: 'thisMonth',
    range,
    startDate: formatDate(range[0]),
    endDate: formatDate(range[1]),
    productTypeIds: null,
  };
};

export const parseChannelNumbersSearchParams = (
  searchParams: URLSearchParams,
  referenceDate: Date = new Date(),
): ChannelNumbersUrlState => {
  const fallback = defaultState(referenceDate);
  const parsedStart = parseDateStrictly(searchParams.get(CHANNEL_NUMBERS_QUERY_PARAMS.startDate));
  const parsedEnd = parseDateStrictly(searchParams.get(CHANNEL_NUMBERS_QUERY_PARAMS.endDate));
  const requestedPreset = parsePreset(searchParams.get(CHANNEL_NUMBERS_QUERY_PARAMS.preset));
  const rawProductTypeIds = searchParams.get(CHANNEL_NUMBERS_QUERY_PARAMS.productTypeIds);
  const productTypeIds = rawProductTypeIds
    ? sortProductTypeQueryValues(rawProductTypeIds.split(','))
    : null;

  if (!parsedStart || !parsedEnd || parsedEnd.getTime() < parsedStart.getTime()) {
    return {
      ...fallback,
      productTypeIds: productTypeIds?.length ? productTypeIds : null,
    };
  }

  const range: ChannelNumbersRange = [parsedStart, parsedEnd];
  const thisMonthRange = resolveChannelNumbersPresetRange('thisMonth', referenceDate);
  const lastMonthRange = resolveChannelNumbersPresetRange('lastMonth', referenceDate);
  let preset: ChannelNumbersPreset = 'custom';

  // Dates are authoritative so an old shared link never jumps to a new month
  // merely because its preset metadata has become stale.
  if (requestedPreset === 'custom') {
    preset = 'custom';
  } else if (requestedPreset === 'thisMonth' && sameRange(range, thisMonthRange)) {
    preset = 'thisMonth';
  } else if (requestedPreset === 'lastMonth' && sameRange(range, lastMonthRange)) {
    preset = 'lastMonth';
  } else if (!requestedPreset && sameRange(range, thisMonthRange)) {
    preset = 'thisMonth';
  } else if (!requestedPreset && sameRange(range, lastMonthRange)) {
    preset = 'lastMonth';
  }

  return {
    preset,
    range,
    startDate: formatDate(range[0]),
    endDate: formatDate(range[1]),
    productTypeIds: productTypeIds?.length ? productTypeIds : null,
  };
};

export const serializeChannelNumbersSearchParams = (
  currentParams: URLSearchParams,
  state: ChannelNumbersUrlSelection,
): URLSearchParams => {
  const nextParams = new URLSearchParams(currentParams);
  nextParams.set(CHANNEL_NUMBERS_QUERY_PARAMS.startDate, formatDate(state.range[0]));
  nextParams.set(CHANNEL_NUMBERS_QUERY_PARAMS.endDate, formatDate(state.range[1]));
  nextParams.set(CHANNEL_NUMBERS_QUERY_PARAMS.preset, state.preset);

  const productTypeIds = state.productTypeIds
    ? sortProductTypeQueryValues(state.productTypeIds)
    : [];
  if (productTypeIds.length > 0) {
    nextParams.set(CHANNEL_NUMBERS_QUERY_PARAMS.productTypeIds, productTypeIds.join(','));
  } else {
    nextParams.delete(CHANNEL_NUMBERS_QUERY_PARAMS.productTypeIds);
  }

  return nextParams;
};
