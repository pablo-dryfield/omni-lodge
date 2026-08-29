import dayjs from 'dayjs';

import {
  parseChannelNumbersSearchParams,
  resolveChannelNumbersPresetRange,
  serializeChannelNumbersSearchParams,
} from './channelNumbersUrlState';

const referenceDate = new Date(2026, 7, 21, 12);
const formatRange = (range: [Date, Date]) => range.map((value) => dayjs(value).format('YYYY-MM-DD'));

describe('Channel Numbers URL state', () => {
  it('restores the linked July range and infers Last Month in August', () => {
    const state = parseChannelNumbersSearchParams(
      new URLSearchParams('startDate=2026-07-01&endDate=2026-07-31'),
      referenceDate,
    );

    expect(state.preset).toBe('lastMonth');
    expect(formatRange(state.range)).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('keeps old shared dates authoritative when preset metadata becomes stale', () => {
    const septemberReference = new Date(2026, 8, 21, 12);
    const state = parseChannelNumbersSearchParams(
      new URLSearchParams('startDate=2026-07-01&endDate=2026-07-31&period=lastMonth'),
      septemberReference,
    );

    expect(state.preset).toBe('custom');
    expect(formatRange(state.range)).toEqual(['2026-07-01', '2026-07-31']);
  });

  it.each([
    'startDate=2026-02-31&endDate=2026-03-31',
    'startDate=2026-13-01&endDate=2026-12-31',
    'startDate=2026-08-20',
    'startDate=2026-08-20&endDate=2026-08-01',
  ])('strictly falls back for an invalid range: %s', (query) => {
    const state = parseChannelNumbersSearchParams(new URLSearchParams(query), referenceDate);

    expect(state.preset).toBe('thisMonth');
    expect(formatRange(state.range)).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('preserves unrelated parameters and canonicalizes filter values', () => {
    const range = resolveChannelNumbersPresetRange('lastMonth', referenceDate);
    const next = serializeChannelNumbersSearchParams(
      new URLSearchParams('source=shared&temporary=keep'),
      { preset: 'lastMonth', range, productTypeIds: ['10', '2', '2'] },
    );

    expect(next.get('source')).toBe('shared');
    expect(next.get('temporary')).toBe('keep');
    expect(next.get('startDate')).toBe('2026-07-01');
    expect(next.get('endDate')).toBe('2026-07-31');
    expect(next.get('period')).toBe('lastMonth');
    expect(next.get('productTypes')).toBe('2,10');
  });

  it('persists a single-day custom range with the same start and end date', () => {
    const selectedDay = new Date(2026, 7, 24, 12);
    const next = serializeChannelNumbersSearchParams(
      new URLSearchParams('source=shared'),
      {
        preset: 'custom',
        range: [selectedDay, selectedDay],
        productTypeIds: ['1', '2'],
      },
    );

    expect(next.get('source')).toBe('shared');
    expect(next.get('period')).toBe('custom');
    expect(next.get('startDate')).toBe('2026-08-24');
    expect(next.get('endDate')).toBe('2026-08-24');
    expect(next.get('productTypes')).toBe('1,2');
  });

  it('uses an absent product-type parameter as the unfiltered default', () => {
    const state = parseChannelNumbersSearchParams(new URLSearchParams(), referenceDate);

    expect(state.productTypeIds).toBeNull();
  });
});
