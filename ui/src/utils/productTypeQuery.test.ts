import {
  getDefaultBookingsSummaryProductTypeValues,
  isFoodTourProductType,
  resolveBookingsSummaryProductTypeValues,
  serializeProductTypeSelection,
  sortProductTypeQueryValues,
} from './productTypeQuery';

const productTypeOptions = [
  { value: '1', label: 'Main Product' },
  { value: '2', label: 'Activities' },
  { value: '3', label: 'Food Tour Krakow' },
];

describe('product type query serialization', () => {
  it('preserves an explicit selection while the catalog is loading', () => {
    expect(serializeProductTypeSelection(['2', '1'], [])).toBe('1,2');
  });

  it('omits the filter when every available type is selected', () => {
    expect(serializeProductTypeSelection(['3', '1', '2'], ['1', '2', '3'])).toBeUndefined();
  });

  it('omits an empty selection because the UI treats it as all types', () => {
    expect(serializeProductTypeSelection([], ['1', '2', '3'])).toBeUndefined();
  });

  it('can preserve an explicit all-types selection for a page with a filtered default', () => {
    expect(
      serializeProductTypeSelection(['3', '1', '2'], ['1', '2', '3'], {
        omitWhenAllSelected: false,
      }),
    ).toBe('1,2,3');
  });

  it('sorts and deduplicates stable numeric and fallback values', () => {
    expect(sortProductTypeQueryValues(['10', '2', 'name:other', '2', ' name:other '])).toEqual([
      '2',
      '10',
      'name:other',
    ]);
  });
});

describe('Bookings Summary product type defaults', () => {
  it('excludes Food Tour Krakow from the default selection', () => {
    expect(getDefaultBookingsSummaryProductTypeValues(productTypeOptions)).toEqual(['1', '2']);
  });

  it('matches Food Tour labels without depending on a database ID or casing', () => {
    expect(isFoodTourProductType({ value: '42', label: '  FOOD   TOUR Krakow ' })).toBe(true);
    expect(isFoodTourProductType({ value: '3', label: 'Activities' })).toBe(false);
  });

  it('preserves an explicit valid URL selection instead of applying the default', () => {
    expect(resolveBookingsSummaryProductTypeValues(productTypeOptions, ['3'], true)).toEqual(['3']);
    expect(resolveBookingsSummaryProductTypeValues(productTypeOptions, ['3', '1'], true)).toEqual(['1', '3']);
  });

  it('uses the filtered default only when the URL has no product-type filter', () => {
    expect(resolveBookingsSummaryProductTypeValues(productTypeOptions, [], false)).toEqual(['1', '2']);
    expect(resolveBookingsSummaryProductTypeValues(productTypeOptions, [], true)).toEqual(['1', '2', '3']);
  });

  it('keeps the only available type selected instead of producing an empty filter', () => {
    expect(
      getDefaultBookingsSummaryProductTypeValues([
        { value: '9', label: 'Food Tour Krakow' },
      ]),
    ).toEqual(['9']);
  });

  it('serializes the filtered default so it persists in a shared URL', () => {
    const selected = getDefaultBookingsSummaryProductTypeValues(productTypeOptions);
    expect(
      serializeProductTypeSelection(selected, productTypeOptions.map((option) => option.value), {
        omitWhenAllSelected: false,
      }),
    ).toBe('1,2');
  });
});
