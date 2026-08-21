import {
  serializeProductTypeSelection,
  sortProductTypeQueryValues,
} from './productTypeQuery';

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

  it('sorts and deduplicates stable numeric and fallback values', () => {
    expect(sortProductTypeQueryValues(['10', '2', 'name:other', '2', ' name:other '])).toEqual([
      '2',
      '10',
      'name:other',
    ]);
  });
});
