import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import axiosInstance from "../utils/axiosInstance";
import { useSearchConsolePerformance, type SearchConsolePerformanceResult } from "./searchConsole";

jest.mock("../utils/axiosInstance", () => ({__esModule: true, default: {get: jest.fn()}}));
const get = axiosInstance.get as jest.Mock;
const page = (startRow: number, next: number | null): SearchConsolePerformanceResult => ({
  rows: [{keys: [String(startRow)], clicks: 2, impressions: 20, ctr: 0.1, position: 6}],
  summary: {clicks: 999, impressions: 9999, ctr: 0.0999, position: 5},
  startDate: "2026-10-01", endDate: "2026-10-31", dimensions: ["query"], summaryAggregation: "byProperty",
  detailAggregation: "byProperty", searchType: "web", timeZone: "America/Los_Angeles",
  coverage: {startRow, rowLimit: 1000, returnedRows: 1, hasMore: next !== null, nextStartRow: next, limitedByProvider: true},
});
const wrapper = () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const params = {siteUrl: "https://example.com/", startDate: "2026-10-01", endDate: "2026-10-31", dimensions: ["query"], filters: {country: "pol", query: "pub crawl", queryMatch: "equals"}};
afterEach(() => jest.clearAllMocks());
it("passes native filters and provider pagination, preserving independent totals", async () => {
  get.mockResolvedValueOnce({data: page(0, 1000)}).mockResolvedValueOnce({data: page(1000, null)});
  const {result} = renderHook(() => useSearchConsolePerformance(params), {wrapper: wrapper()});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data?.rows).toHaveLength(2));
  expect(get.mock.calls[1][1].params).toMatchObject({...params.filters, startRow: 1000, dimensions: "query"});
  expect(result.current.data?.summary?.clicks).toBe(999);
  expect(result.current.hasNextPage).toBe(false);
});
it("does not mix rows when the filters change", async () => {
  get.mockImplementation((_url, options) => Promise.resolve({data: {...page(0, null), rows: [{...page(0, null).rows[0], keys: [options.params.query]}]}}));
  const {result, rerender} = renderHook(({query}) => useSearchConsolePerformance({...params, filters: {query}}), {initialProps: {query: "first"}, wrapper: wrapper()});
  await waitFor(() => expect(result.current.data?.rows[0].keys).toEqual(["first"]));
  rerender({query: "second"});
  await waitFor(() => expect(result.current.data?.rows[0].keys).toEqual(["second"]));
  expect(result.current.data?.rows).toHaveLength(1);
});
it("does not send requests without a selected property", () => {
  renderHook(() => useSearchConsolePerformance({...params, siteUrl: null}), {wrapper: wrapper()});
  expect(get).not.toHaveBeenCalled();
});
