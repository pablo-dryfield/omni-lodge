import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import SearchConsolePage from "./SearchConsolePage";
import { useSearchConsolePerformance } from "../api/searchConsole";

jest.mock("../store/hooks", () => ({useAppDispatch: () => jest.fn()}));
jest.mock("../components/access/PageAccessGuard", () => ({PageAccessGuard: ({children}: {children: ReactNode}) => <>{children}</>}));
jest.mock("../api/searchConsole", () => ({
  useSearchConsolePerformance: jest.fn(),
  useSearchConsoleSites: () => ({data: [{siteUrl: "https://krawlthroughkrakow.com/", permissionLevel: "siteOwner"}], refetch: jest.fn()}),
  useSeoActionLogs: () => ({data: [], refetch: jest.fn()}),
  useInspectSearchConsoleUrl: () => ({}), useAnalyzeGoogleSerp: () => ({}), useCreateSeoActionLog: () => ({}),
}));
const performance = useSearchConsolePerformance as jest.Mock;
const show = () => render(<MantineProvider><SearchConsolePage /></MantineProvider>);
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {writable: true, value: jest.fn().mockImplementation(query => ({matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn()}))});
  global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  performance.mockReset().mockImplementation(params => ({
    isSuccess: true, refetch: jest.fn(), hasNextPage: true, fetchNextPage: jest.fn(),
    data: {rows: [{keys: params.dimensions.length === 1 && params.dimensions[0] === "page" ? ["https://krawlthroughkrakow.com/"] : ["pub crawl krakow tickets", "https://krawlthroughkrakow.com/"], clicks: 1, impressions: 10, ctr: 0.1, position: 4}],
      summary: {clicks: 9000, impressions: 90000, ctr: 0.1, position: 5}, summaryAggregation: "byProperty", detailAggregation: "byPage", dimensions: params.dimensions},
  }));
});
it("shows independent Google totals, not the sum of the sample", () => {
  show(); expect(screen.getAllByText("9,000").length).toBeGreaterThan(0);
  expect(screen.getByText(/Summary totals are returned independently/)).toBeInTheDocument();
});
it("applies the same explicit filters to every report, including comparison", () => {
  show();
  fireEvent.change(screen.getByLabelText("Query", {exact: true}), {target: {value: "krakow pub crawl"}});
  fireEvent.click(screen.getByRole("button", {name: "Apply filters"}));
  const lastCalls = performance.mock.calls.slice(-8);
  expect(lastCalls).toHaveLength(8);
  expect(lastCalls.every(([params]) => params.filters.query === "krakow pub crawl")).toBe(true);
});
it("uses direct page and exact query dimensions and does not invent missing-page diagnoses", () => {
  show();
  expect(performance.mock.calls.some(([params]) => params.dimensions.join() === "page")).toBe(true);
  expect(performance.mock.calls.some(([params]) => params.dimensions.join() === "query")).toBe(true);
  expect(screen.getAllByText("Not observed").length).toBeGreaterThan(0);
  expect(screen.queryByText("Missing", {exact: true})).not.toBeInTheDocument();
  expect(screen.getAllByText(/Investigate query coverage/).length).toBeGreaterThan(0);
});
it("makes pagination and provider coverage visible", () => {
  show(); expect(screen.getAllByRole("button", {name: "Load more rows"}).length).toBe(7);
  expect(screen.getAllByText(/Google omits anonymized queries/).length).toBe(5);
});
