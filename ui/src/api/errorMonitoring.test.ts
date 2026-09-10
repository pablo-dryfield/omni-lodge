import axiosInstance from "../utils/axiosInstance";
import {
  addErrorMonitoringNote,
  buildErrorMonitoringIssueParams,
  deleteErrorMonitoringNote,
  fetchErrorMonitoringIssue,
  fetchErrorMonitoringIssues,
  fetchErrorMonitoringSummary,
  updateErrorMonitoringIssue,
} from "./errorMonitoring";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

const issue = {
  id: "42",
  fingerprint: "client:TypeError:abc",
  source: "browser",
  kind: "runtime_error",
  title: "Cannot read properties of null",
  severity: "error" as const,
  status: "open" as const,
  firstSeenAt: "2026-09-08T10:00:00.000Z",
  lastSeenAt: "2026-09-09T10:00:00.000Z",
  occurrenceCount: 8,
  affectedUserCount: 3,
  reopenedCount: 0,
  lastRoute: "/assistant-manager-tasks",
  lastPageUrl: "/assistant-manager-tasks?section=setup",
  lastRelease: "2026.09.09",
  lastEnvironment: "production",
  assignedTo: null,
  statusChangedAt: null,
};

describe("error monitoring API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("serializes multi-value filters and removes empty values", () => {
    expect(
      buildErrorMonitoringIssueParams({
        page: 2,
        limit: 25,
        status: ["open", "investigating"],
        severity: ["fatal", "error"],
        source: ["browser", "server"],
        kind: [],
        search: " null ",
        pagePath: "",
        userId: null,
      }),
    ).toEqual({
      page: 2,
      limit: 25,
      status: "open,investigating",
      severity: "fatal,error",
      source: "browser,server",
      search: " null ",
    });
  });

  it("loads summary, issue list and paginated issue detail from the admin endpoints", async () => {
    const summary = {
      counts: { total: 1, open: 1, investigating: 0, resolved: 0, ignored: 0 },
      severity: { warning: 0, error: 1, fatal: 0 },
      sources: [{ source: "browser", count: 1 }],
      occurrences: { last24Hours: 8, last7Days: 8 },
      generatedAt: "2026-09-09T10:00:00.000Z",
    };
    const list = { issues: [issue], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } };
    const detail = {
      issue,
      occurrences: [],
      notes: [],
      occurrencePagination: { page: 2, limit: 15, total: 20, totalPages: 2 },
    };

    mockedAxios.get
      .mockResolvedValueOnce({ data: summary })
      .mockResolvedValueOnce({ data: list })
      .mockResolvedValueOnce({ data: detail });

    await expect(fetchErrorMonitoringSummary()).resolves.toEqual(summary);
    await expect(fetchErrorMonitoringIssues({ page: 1, status: ["open"] })).resolves.toEqual(list);
    await expect(fetchErrorMonitoringIssue("issue/42", 2, 15)).resolves.toEqual(detail);

    expect(mockedAxios.get).toHaveBeenNthCalledWith(1, "/error-monitoring/summary", {
      skipErrorMonitoring: true,
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(2, "/error-monitoring/issues", {
      params: { page: 1, status: "open" },
      skipErrorMonitoring: true,
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      3,
      "/error-monitoring/issues/issue%2F42",
      {
        params: { occurrencePage: 2, occurrenceLimit: 15 },
        skipErrorMonitoring: true,
      },
    );
  });

  it("updates triage state and supports wrapped mutation responses", async () => {
    const updated = { ...issue, status: "resolved" as const };
    const note = {
      id: "7",
      body: "Fixed in release 2026.09.09",
      createdAt: "2026-09-09T11:00:00.000Z",
      updatedAt: "2026-09-09T11:00:00.000Z",
      author: null,
    };
    mockedAxios.patch.mockResolvedValueOnce({ data: { issue: updated } });
    mockedAxios.post.mockResolvedValueOnce({ data: { note } });
    mockedAxios.delete.mockResolvedValueOnce({ data: undefined });

    await expect(updateErrorMonitoringIssue("42", { status: "resolved" })).resolves.toEqual(updated);
    await expect(addErrorMonitoringNote("42", note.body)).resolves.toEqual(note);
    await expect(deleteErrorMonitoringNote("42", "7")).resolves.toBeUndefined();

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      "/error-monitoring/issues/42",
      { status: "resolved" },
      { skipErrorMonitoring: true },
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "/error-monitoring/issues/42/notes",
      { body: note.body },
      { skipErrorMonitoring: true },
    );
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      "/error-monitoring/issues/42/notes/7",
      { skipErrorMonitoring: true },
    );
  });
});
