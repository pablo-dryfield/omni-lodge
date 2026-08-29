import {
  SERVER_AVAILABILITY_CANDIDATE_EVENT,
  ServerAvailabilityCandidateDetail,
  dispatchServerAvailabilityCandidate,
  probeServerHealth,
} from "./serverAvailability";

describe("server availability utilities", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("dispatches candidate diagnostics without changing them", () => {
    const listener = jest.fn();
    const detail: ServerAvailabilityCandidateDetail = {
      status: 503,
      isNetworkError: false,
      message: "Request failed with status code 503",
      code: "ERR_BAD_RESPONSE",
      method: "GET",
      url: "/api/required-actions/me",
      visibilityState: "visible",
      occurredAt: 1_787_938_200_000,
    };
    window.addEventListener(SERVER_AVAILABILITY_CANDIDATE_EVENT, listener);

    dispatchServerAvailabilityCandidate(detail);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(detail);
    window.removeEventListener(SERVER_AVAILABILITY_CANDIDATE_EVENT, listener);
  });

  it("probes the default health endpoint with a cache-bypassing native request", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(probeServerHealth({ fetchImpl })).resolves.toEqual({
      available: true,
      status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: expect.anything(),
      }),
    );
  });

  it("normalizes a configured API base URL and reports an unhealthy response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(
      probeServerHealth({ baseURL: "http://localhost:3001/api/", fetchImpl }),
    ).resolves.toEqual({ available: false, status: 503 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3001/api/health",
      expect.any(Object),
    );
  });

  it("treats a non-5xx response as proof that the server is reachable", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(probeServerHealth({ fetchImpl })).resolves.toEqual({
      available: true,
      status: 404,
    });
  });

  it("returns unavailable when the health request fails", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(probeServerHealth({ fetchImpl })).resolves.toEqual({ available: false });
  });

  it("aborts a health request after the configured timeout", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;

    const resultPromise = probeServerHealth({ fetchImpl, timeoutMs: 25 });
    jest.advanceTimersByTime(25);

    await expect(resultPromise).resolves.toEqual({ available: false });
    expect(requestSignal?.aborted).toBe(true);
  });
});
