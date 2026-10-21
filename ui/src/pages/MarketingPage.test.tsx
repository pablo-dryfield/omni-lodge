import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetchMarketingOverview, type MarketingOverviewResponse, type MarketingTabData } from "../api/marketing";
import { useAppDispatch } from "../store/hooks";
import MarketingPage from "./MarketingPage";

jest.mock("../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("../store/hooks", () => ({ useAppDispatch: jest.fn() }));
jest.mock("axios", () => ({ isAxiosError: jest.fn(() => false) }));
jest.mock("../api/marketing", () => ({ fetchMarketingOverview: jest.fn() }));
jest.mock("../components/marketing/MarketingChartSection", () => ({ __esModule: true, default: () => null }));

const makeOverview = (costError: string | null): MarketingOverviewResponse => {
  const tab: MarketingTabData = {
    bookingCount: 1,
    revenueTotal: 100,
    revenueCurrency: "PLN",
    clickTotal: costError ? null : 0,
    sourceBreakdown: [], mediumBreakdown: [], campaignBreakdown: [], dailySeries: [], bookings: [],
  };
  return {
    startDate: "2026-10-21", endDate: "2026-10-21",
    overall: { ...tab, googleAdsCost: costError ? null : 0, googleCostCurrency: "PLN", costError },
    googleAds: { ...tab, googleAdsCost: costError ? null : 0, costCurrency: "PLN", costError, googleCostRows: [] },
    metaAds: { ...tab, clickTotal: null },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  (useAppDispatch as jest.Mock).mockReturnValue(jest.fn());
  Object.defineProperty(global, "ResizeObserver", { configurable: true, writable: true, value: class {
    observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn();
  } });
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: jest.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
});

it("shows unavailable cost, clicks and ROAS on Overall and Google Ads without hiding booking revenue or affecting Meta", async () => {
  (fetchMarketingOverview as jest.Mock).mockResolvedValue(makeOverview("Version v22 is deprecated"));
  render(<MantineProvider><MarketingPage title="Marketing" /></MantineProvider>);
  await screen.findByRole("tab", { name: "Overall" });

  const expectUnavailable = () => {
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Google Ads cost unavailable")).toBeInTheDocument();
    expect(panel.getByText("Version v22 is deprecated")).toBeInTheDocument();
    expect(panel.getAllByText("Unavailable")).toHaveLength(3);
    expect(panel.getByText("100.00 zł")).toBeInTheDocument();
    expect(panel.queryByText("Spent")).not.toBeInTheDocument();
    expect(panel.queryByText("Tracked")).not.toBeInTheDocument();
  };
  expectUnavailable();
  fireEvent.click(screen.getByRole("tab", { name: "Google Ads" }));
  expectUnavailable();
  fireEvent.click(screen.getByRole("tab", { name: "Meta Ads" }));
  expect(within(screen.getByRole("tabpanel")).queryByText("Google Ads cost unavailable")).not.toBeInTheDocument();
});

it("displays genuine zero spend when Google Ads successfully returns no costs", async () => {
  (fetchMarketingOverview as jest.Mock).mockResolvedValue(makeOverview(null));
  render(<MantineProvider><MarketingPage title="Marketing" /></MantineProvider>);
  await screen.findByRole("tab", { name: "Overall" });
  const panel = within(screen.getByRole("tabpanel"));
  expect(panel.getByText("0.00 zł")).toBeInTheDocument();
  expect(panel.getByText("Spent")).toBeInTheDocument();
  expect(panel.getByText("Tracked")).toBeInTheDocument();
  expect(panel.queryByText("Google Ads cost unavailable")).not.toBeInTheDocument();
});

it("protects the Overall display during a rolling release with the old backend response", async () => {
  const overview = makeOverview("Google Ads connection failed");
  delete overview.overall.costError;
  overview.overall.googleAdsCost = 0;
  overview.overall.clickTotal = 0;
  (fetchMarketingOverview as jest.Mock).mockResolvedValue(overview);
  render(<MantineProvider><MarketingPage title="Marketing" /></MantineProvider>);
  await screen.findByRole("tab", { name: "Overall" });
  const panel = within(screen.getByRole("tabpanel"));
  expect(panel.getAllByText("Unavailable")).toHaveLength(3);
  expect(panel.queryByText("0.00 zł")).not.toBeInTheDocument();
});
