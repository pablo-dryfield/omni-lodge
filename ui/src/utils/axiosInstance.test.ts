import { dispatchServerAvailabilityCandidate } from "./serverAvailability";

jest.mock("axios", () => {
  const requestUse = jest.fn();
  const responseUse = jest.fn();
  const isCancel = jest.fn((error: { mockCanceled?: boolean } | undefined) => (
    error?.mockCanceled === true
  ));

  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        interceptors: {
          request: { use: requestUse },
          response: { use: responseUse },
        },
      })),
      isCancel,
    },
    mockRequestUse: requestUse,
    mockResponseUse: responseUse,
  };
});

jest.mock("./serverAvailability", () => ({
  ...jest.requireActual("./serverAvailability"),
  dispatchServerAvailabilityCandidate: jest.fn(),
}));

// Importing the singleton registers the interceptors captured by the Axios mock.
require("./axiosInstance");

const { mockResponseUse } = jest.requireMock("axios") as {
  mockResponseUse: jest.Mock;
};
const mockedDispatchCandidate = dispatchServerAvailabilityCandidate as jest.MockedFunction<
  typeof dispatchServerAvailabilityCandidate
>;
const responseErrorHandler = mockResponseUse.mock.calls[0][1] as (
  error: unknown,
) => Promise<never>;

describe("axios server availability candidates", () => {
  beforeEach(() => {
    mockedDispatchCandidate.mockClear();
    jest.spyOn(Date, "now").mockReturnValue(1_787_938_200_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports a network failure with request and lifecycle diagnostics", async () => {
    const failure = {
      message: "Network Error",
      code: "ERR_NETWORK",
      config: {
        baseURL: "http://localhost:3001/api",
        url: "/required-actions/me",
        method: "get",
      },
    };

    await expect(responseErrorHandler(failure)).rejects.toBe(failure);
    expect(mockedDispatchCandidate).toHaveBeenCalledWith({
      status: undefined,
      isNetworkError: true,
      message: "Network Error",
      code: "ERR_NETWORK",
      method: "GET",
      url: "http://localhost:3001/api/required-actions/me",
      visibilityState: document.visibilityState,
      occurredAt: 1_787_938_200_000,
    });
  });

  it("reports a 5xx response", async () => {
    const failure = {
      message: "Service unavailable",
      response: { status: 503 },
      config: { baseURL: "/api", url: "/work", method: "post" },
    };

    await expect(responseErrorHandler(failure)).rejects.toBe(failure);
    expect(mockedDispatchCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, isNetworkError: false, method: "POST" }),
    );
  });

  it("ignores 4xx and canceled requests", async () => {
    const forbidden = {
      message: "Forbidden",
      response: { status: 403 },
      config: { url: "/forbidden", method: "get" },
    };
    const canceled = { message: "canceled", mockCanceled: true };

    await expect(responseErrorHandler(forbidden)).rejects.toBe(forbidden);
    await expect(responseErrorHandler(canceled)).rejects.toBe(canceled);
    expect(mockedDispatchCandidate).not.toHaveBeenCalled();
  });
});
