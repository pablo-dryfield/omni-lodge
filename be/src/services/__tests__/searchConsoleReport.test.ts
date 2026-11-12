import { buildPerformanceRequest } from '../searchConsoleReport';

const base = {siteUrl: 'https://example.com/', startDate: '2026-10-01', endDate: '2026-10-31'};
describe('Search Console reporting contracts', () => {
  it('uses independent ungrouped property totals and one lookahead row', () => {
    const request = buildPerformanceRequest({...base, dimensions: ['query', 'page']}, 1000);
    expect(request.detail).toMatchObject({rowLimit: 1001, startRow: 0, aggregationType: 'auto', dimensions: ['query', 'page'], dataState: 'final', type: 'web'});
    expect(request.summary).toEqual({startDate: base.startDate, endDate: base.endDate, dataState: 'final', type: 'web', aggregationType: 'byProperty', rowLimit: 1});
  });
  it('preserves all native filters across summaries and paginated details', () => {
    const request = buildPerformanceRequest({...base, country: 'POL', device: 'mobile', query: 'pub crawl', queryMatch: 'equals', page: '/store2/', pageMatch: 'contains', type: 'image', startRow: '1000'}, 1000);
    expect(request.detail.dimensionFilterGroups).toEqual(request.summary.dimensionFilterGroups);
    expect(request.filters).toEqual([
      {dimension: 'country', operator: 'equals', expression: 'pol'},
      {dimension: 'device', operator: 'equals', expression: 'MOBILE'},
      {dimension: 'query', operator: 'equals', expression: 'pub crawl'},
      {dimension: 'page', operator: 'contains', expression: '/store2/'},
    ]);
    expect(request.summary.aggregationType).toBe('auto');
    expect(request.detail.startRow).toBe(1000);
    expect(request.summary).not.toHaveProperty('startRow');
    expect(request.summary).not.toHaveProperty('dimensions');
  });
  it.each(['discover', 'googleNews'])('does not request unsupported property aggregation for %s', type => {
    expect(buildPerformanceRequest({...base, type}, 1000).summary.aggregationType).toBe('auto');
  });
  it('uses the configured page-size ceiling and never exceeds provider lookahead limit', () => {
    expect(buildPerformanceRequest({...base, rowLimit: 24999}, 500).rowLimit).toBe(500);
    expect(buildPerformanceRequest({...base, rowLimit: 24999}, 24999).detail.rowLimit).toBe(25000);
  });
  it.each([
    {startDate: '2026-02-30'}, {startDate: '2026-11-01'}, {endDate: 'bad'}, {dimensions: ['unknown']},
    {dimensions: ['page', 'page']}, {dimensions: []}, {rowLimit: 0}, {rowLimit: 25000}, {startRow: -1},
    {startRow: '1x'}, {startRow: 1.2}, {device: 'tv'}, {country: 'pl'}, {queryMatch: 'regex'},
    {type: 'bogus'}, {page: ['a']}, {query: 'x\n'}, {siteUrl: ''},
  ])('rejects invalid input without silently changing report meaning: %j', options => {
    expect(() => buildPerformanceRequest({...base, ...options}, 1000)).toThrow();
  });
});
