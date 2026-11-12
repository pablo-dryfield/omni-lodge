import { google } from 'googleapis';
import { getSearchConsolePerformance } from '../searchConsoleService';
import { getConfigValue, refreshConfigCacheKeys } from '../configService';

jest.mock('googleapis', () => ({google: {auth: {OAuth2: jest.fn(() => ({setCredentials: jest.fn()}))}, searchconsole: jest.fn()}}));
jest.mock('../../models/SeoActionLog.js', () => ({__esModule: true, default: {}}));
jest.mock('../configService.js', () => ({getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn()}));

describe('Search Console independent totals and pagination', () => {
  const query = jest.fn();
  const row = (key: string, clicks: number) => ({keys: [key], clicks, impressions: clicks * 10, ctr: 0.1, position: 8});
  beforeEach(() => {
    jest.clearAllMocks();
    (google.searchconsole as jest.Mock).mockReturnValue({searchanalytics: {query}});
    (getConfigValue as jest.Mock).mockImplementation(key => key === 'SEARCH_CONSOLE_PAGE_SIZE' ? 100 : 'test-credential');
    (refreshConfigCacheKeys as jest.Mock).mockResolvedValue(undefined);
  });
  it('returns full summary even if loaded detail sums are smaller, and uses exact next offset', async () => {
    query.mockResolvedValueOnce({data: {rows: Array.from({length: 101}, (_, i) => row(String(i), 1)), responseAggregationType: 'byPage'}})
      .mockResolvedValueOnce({data: {rows: [row('', 9000)], responseAggregationType: 'byProperty'}});
    const result = await getSearchConsolePerformance({siteUrl: 'https://example.com/', startRow: 200});
    expect(result.rows).toHaveLength(100);
    expect(result.summary?.clicks).toBe(9000);
    expect(result.coverage).toMatchObject({startRow: 200, hasMore: true, nextStartRow: 300, limitedByProvider: true});
    expect(result.detailAggregation).toBe('byPage');
    expect(result.summaryAggregation).toBe('byProperty');
    expect(query.mock.calls[1][0].requestBody).not.toHaveProperty('dimensions');
  });
  it('keeps no-data distinct from a genuine zero and terminates at exact page size', async () => {
    query.mockResolvedValueOnce({data: {rows: []}}).mockResolvedValueOnce({data: {rows: []}});
    const empty = await getSearchConsolePerformance({siteUrl: 'https://example.com/'});
    expect(empty.summary).toBeNull();
    expect(empty.coverage).toMatchObject({hasMore: false, nextStartRow: null, returnedRows: 0});
    query.mockResolvedValueOnce({data: {rows: Array.from({length: 100}, (_, i) => row(String(i), 0))}})
      .mockResolvedValueOnce({data: {rows: [row('', 0)]}});
    const zero = await getSearchConsolePerformance({siteUrl: 'https://example.com/'});
    expect(zero.summary?.clicks).toBe(0);
    expect(zero.coverage.hasMore).toBe(false);
  });
  it('propagates provider errors, rather than replacing missing summary with detail sums', async () => {
    query.mockResolvedValueOnce({data: {rows: [row('a', 1)]}}).mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(getSearchConsolePerformance({siteUrl: 'https://example.com/'})).rejects.toThrow('Provider unavailable');
  });
  it('refreshes the operator page size on each request', async () => {
    query.mockResolvedValue({data: {rows: []}});
    await getSearchConsolePerformance({siteUrl: 'https://example.com/'});
    expect(refreshConfigCacheKeys).toHaveBeenCalledWith(['SEARCH_CONSOLE_PAGE_SIZE']);
  });
});
