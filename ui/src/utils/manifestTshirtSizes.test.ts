import { getManifestTshirtSizeLabels } from './manifestTshirtSizes';

describe('getManifestTshirtSizeLabels', () => {
  it('creates separate size labels in canonical order with every quantity visible', () => {
    expect(getManifestTshirtSizeLabels(4, { XL: 1, S: 2, M: 1 })).toEqual([
      'S × 2',
      'M × 1',
      'XL × 1',
    ]);
  });

  it('keeps unassigned quantities visible when recorded sizes are incomplete', () => {
    expect(getManifestTshirtSizeLabels(3, { M: 2 })).toEqual(['M × 2', '1 unspecified']);
  });

  it('returns no labels so the chip can preserve its numeric fallback', () => {
    expect(getManifestTshirtSizeLabels(3)).toEqual([]);
  });
});
