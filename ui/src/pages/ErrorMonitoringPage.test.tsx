import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import ErrorMonitoringPage from "./ErrorMonitoringPage";
import {
  addErrorMonitoringNote,
  fetchErrorMonitoringIssue,
  fetchErrorMonitoringIssues,
  fetchErrorMonitoringSummary,
  updateErrorMonitoringIssue,
} from "../api/errorMonitoring";

jest.mock("../api/errorMonitoring", () => ({
  fetchErrorMonitoringSummary: jest.fn(),
  fetchErrorMonitoringIssues: jest.fn(),
  fetchErrorMonitoringIssue: jest.fn(),
  updateErrorMonitoringIssue: jest.fn(),
  addErrorMonitoringNote: jest.fn(),
  deleteErrorMonitoringNote: jest.fn(),
}));

jest.mock("../api/users", () => ({
  useActiveUsers: () => ({
    data: [{ id: 8, firstName: "Pablo", lastName: "Cabrera", email: "pablo@example.com" }],
  }),
}));

jest.mock("../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

const mockModuleAccess = {
  ready: true,
  loading: false,
  canView: true,
  canCreate: false,
  canUpdate: true,
  canDelete: false,
};
jest.mock("../hooks/useModuleAccess", () => ({
  useModuleAccess: () => mockModuleAccess,
}));

const mockDispatch = jest.fn();
jest.mock("../store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
}));

class TestResizeObserver implements ResizeObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

global.ResizeObserver = TestResizeObserver;

const mockedSummary = fetchErrorMonitoringSummary as jest.MockedFunction<typeof fetchErrorMonitoringSummary>;
const mockedIssues = fetchErrorMonitoringIssues as jest.MockedFunction<typeof fetchErrorMonitoringIssues>;
const mockedDetail = fetchErrorMonitoringIssue as jest.MockedFunction<typeof fetchErrorMonitoringIssue>;
const mockedUpdate = updateErrorMonitoringIssue as jest.MockedFunction<typeof updateErrorMonitoringIssue>;
const mockedAddNote = addErrorMonitoringNote as jest.MockedFunction<typeof addErrorMonitoringNote>;

const issue = {
  id: "42",
  fingerprint: "browser:TypeError:null-checked",
  source: "browser",
  kind: "runtime_error",
  title: "Cannot read properties of null (reading 'checked')",
  severity: "error" as const,
  status: "open" as const,
  firstSeenAt: "2026-09-08T08:00:00.000Z",
  lastSeenAt: "2026-09-09T08:00:00.000Z",
  occurrenceCount: 12,
  affectedUserCount: 4,
  reopenedCount: 0,
  lastRoute: "/assistant-manager-tasks",
  lastPageUrl: "/assistant-manager-tasks?section=setup",
  lastRelease: "2026.09.09",
  lastEnvironment: "production",
  assignedTo: null,
  statusChangedAt: null,
};

const summary = {
  counts: { total: 9, open: 3, investigating: 1, resolved: 4, ignored: 1 },
  severity: { warning: 3, error: 5, fatal: 1 },
  sources: [{ source: "browser", count: 9 }],
  occurrences: {
    last24Hours: 28,
    last7Days: 91,
    samplesLast24Hours: 18,
    samplesLast7Days: 61,
  },
  queue: { pending: 0, dropped: 0 },
  generatedAt: "2026-09-09T10:00:00.000Z",
};

const detail = {
  issue,
  occurrences: [
    {
      id: "81",
      eventId: "event-81",
      clientEventId: "ui-20260909-abcd",
      eventCount: 3,
      source: "browser",
      kind: "runtime_error",
      level: "error",
      errorName: "TypeError",
      message: issue.title,
      stack: "TypeError: Cannot read properties of null\n    at TaskPlanner.tsx:9006:73",
      componentStack: "at TaskPlanner",
      occurredAt: "2026-09-09T08:00:00.000Z",
      receivedAt: "2026-09-09T08:00:01.000Z",
      user: { id: 11, firstName: "Jamie", lastName: "Felton" },
      requestId: null,
      httpMethod: null,
      httpUrlPath: null,
      httpStatus: null,
      durationMs: null,
      pageUrlPath: "/assistant-manager-tasks",
      route: "/assistant-manager-tasks",
      release: "2026.09.09",
      environment: "production",
      userAgent: "Chrome Mobile",
      context: { action: "toggle social media" },
      tags: null,
      breadcrumbs: [],
    },
  ],
  notes: [],
  occurrencePagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderPage = (entry = "/error-monitoring") => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ErrorMonitoringPage />
          <LocationProbe />
        </MantineProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("ErrorMonitoringPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModuleAccess.canUpdate = true;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    mockedSummary.mockResolvedValue(summary);
    mockedIssues.mockResolvedValue({
      issues: [issue],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
    mockedDetail.mockResolvedValue(detail);
    mockedUpdate.mockResolvedValue({ ...issue, status: "resolved" });
    mockedAddNote.mockResolvedValue({
      id: "note-1",
      body: "Fixed null event handling.",
      createdAt: "2026-09-09T10:10:00.000Z",
      updatedAt: "2026-09-09T10:10:00.000Z",
      author: { id: 8, firstName: "Pablo", lastName: "Cabrera" },
    });
  });

  it("shows monitoring health and grouped issue counts", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Error monitoring" })).toBeInTheDocument();
    expect((await screen.findAllByText(issue.title))[0]).toBeInTheDocument();
    expect(screen.getByText("Active issues")).toBeInTheDocument();
    expect(screen.getByText("Weighted events · 24h")).toBeInTheDocument();
    expect(screen.getByText(/18 stored samples/)).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(mockedIssues).toHaveBeenCalledWith(expect.objectContaining({
      status: ["open", "investigating"],
      page: 1,
      limit: 25,
    }));
  });

  it("warns administrators when the server capture queue dropped events", async () => {
    mockedSummary.mockResolvedValueOnce({
      ...summary,
      queue: { pending: 2, dropped: 4 },
    });

    renderPage();

    expect(await screen.findByText("Some server captures could not be retained")).toBeInTheDocument();
    expect(screen.getByText(/Dropped: 4/)).toBeInTheDocument();
    expect(screen.getByText("2 in memory")).toBeInTheDocument();
  });

  it("opens a full diagnostic view and resolves an issue", async () => {
    renderPage("/error-monitoring?status=active");

    fireEvent.click((await screen.findAllByText(issue.title))[0]);
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
      expect(params.get("issue")).toBe("42");
    });
    const linkedParams = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
    expect(linkedParams.get("status")).toBe("active");
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Issue details")).toBeInTheDocument();
    expect(await within(drawer).findByText(/TaskPlanner\.tsx:9006:73/)).toBeInTheDocument();
    expect(within(drawer).getByText("ui-20260909-abcd")).toBeInTheDocument();
    expect(within(drawer).getByText("3 events in this sample")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("42", { status: "resolved" });
    });
  });

  it("triages an issue directly from the desktop list without opening its details", async () => {
    mockedUpdate.mockResolvedValueOnce({ ...issue, status: "investigating" });
    renderPage();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", {
      name: `Investigate issue: ${issue.title}`,
    }));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("42", { status: "investigating" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(new URLSearchParams(screen.getByTestId("location-search").textContent ?? "").has("issue")).toBe(false);
  });

  it("confirms before ignoring an issue from the list", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", {
      name: `Ignore issue: ${issue.title}`,
    }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Ignore this issue? Future occurrences will stay grouped as ignored until you reopen it.",
    );
    expect(mockedUpdate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(within(table).getByRole("button", {
      name: `Ignore issue: ${issue.title}`,
    }));
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("42", { status: "ignored" });
    });
    confirmSpy.mockRestore();
  });

  it("shows only Reopen for a closed issue in the list", async () => {
    const resolvedIssue = { ...issue, status: "resolved" as const };
    mockedIssues.mockResolvedValueOnce({
      issues: [resolvedIssue],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
    mockedUpdate.mockResolvedValueOnce({ ...issue, status: "open" });
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("button", { name: `Resolve issue: ${issue.title}` })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: `Ignore issue: ${issue.title}` })).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: `Reopen issue: ${issue.title}` }));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("42", { status: "open" });
    });
  });

  it("keeps mobile issue actions separate from the details button", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 48em)",
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    renderPage();

    const card = await screen.findByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: `Resolve issue: ${issue.title}` }));
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("42", { status: "resolved" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides list triage actions when access is read only", async () => {
    mockModuleAccess.canUpdate = false;
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).queryByText("Actions")).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: `Resolve issue: ${issue.title}` })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: `Open ${issue.title}` }).length).toBeGreaterThan(0);
  });

  it("opens a linked issue directly from the URL", async () => {
    renderPage("/error-monitoring?source=client&issue=42");

    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText(/TaskPlanner\.tsx:9006:73/)).toBeInTheDocument();
    expect(mockedDetail).toHaveBeenCalledWith("42", 1, 15);

    fireEvent.click(within(drawer).getByRole("button", { name: "Close issue details" }));
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
      expect(params.has("issue")).toBe(false);
    });
    const remainingParams = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
    expect(remainingParams.get("source")).toBe("client");
  });

  it("adds an investigation note from the issue drawer", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText(issue.title))[0]);
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("tab", { name: /Notes/ }));
    fireEvent.change(within(drawer).getByLabelText("Add investigation note"), {
      target: { value: "Fixed null event handling." },
    });
    fireEvent.click(within(drawer).getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(mockedAddNote).toHaveBeenCalledWith("42", "Fixed null event handling.");
    });
  });
});
