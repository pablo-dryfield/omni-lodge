import {
  captureApiFailure,
  captureClientError,
  captureException,
  captureAxiosError,
  flushErrorMonitoring,
  initializeErrorMonitoring,
  markAxiosRequestForErrorMonitoring,
  resetErrorMonitoringForTests,
} from "./errorMonitoring";
import { MemoryClientErrorQueueStore } from "./errorMonitoringQueue";

const acceptedResponse = { status: 202 } as Response;

const readSentEvents = (transport: jest.Mock): Array<Record<string, unknown>> => {
  return transport.mock.calls
    .filter(([url]) => String(url).includes("/client-errors/batch"))
    .flatMap((request) => {
      const parsed = JSON.parse(String((request[1] as RequestInit).body));
      return Array.isArray(parsed.events) ? parsed.events : [];
    });
};

const waitForQueuedCount = async (
  store: MemoryClientErrorQueueStore,
  expected: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.getAll()).length === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected ${expected} queued client errors`);
};

describe("browser error monitoring", () => {
  let store: MemoryClientErrorQueueStore;
  let transport: jest.Mock;

  beforeEach(async () => {
    await resetErrorMonitoringForTests();
    store = new MemoryClientErrorQueueStore();
    transport = jest.fn().mockResolvedValue(acceptedResponse);
  });

  afterEach(async () => {
    await resetErrorMonitoringForTests();
    jest.restoreAllMocks();
  });

  const configureWithoutHandlers = (): void => {
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      release: "web-test1234",
      environment: "test",
      captureConsole: false,
      captureFetch: false,
      flushIntervalMs: 600_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
      getUserContext: () => ({
        id: 42,
        roleSlug: "manager",
        userTypeId: 3,
        staffType: "long_term",
        authenticated: true,
      }),
    });
    cleanup();
  };

  it("persists, enriches, redacts, and sends exceptions in a first-party batch", async () => {
    configureWithoutHandlers();
    captureException(new Error("Failure for guest@example.com token=super-secret"), {
      password: "never-store-this",
      operation: "save-booking",
    });
    await waitForQueuedCount(store, 1);

    await flushErrorMonitoring();

    const [event] = readSentEvents(transport);
    expect(event).toEqual(
      expect.objectContaining({
        type: "exception",
        level: "error",
        capturedUserId: 42,
        release: "web-test1234",
        environment: "test",
        route: "/",
      }),
    );
    expect(JSON.stringify(event)).not.toContain("guest@example.com");
    expect(JSON.stringify(event)).not.toContain("super-secret");
    expect(JSON.stringify(event)).not.toContain("never-store-this");
    expect(event.context).toEqual(expect.objectContaining({
      details: expect.objectContaining({ operation: "save-booking" }),
    }));
    expect(event.context).not.toHaveProperty("user");
    expect(await store.getAll()).toEqual([]);
  });

  it("deduplicates a same-release burst before transport and records its local occurrence count", async () => {
    configureWithoutHandlers();
    captureClientError({ type: "manual", message: "same failure" });
    captureClientError({ type: "manual", message: "same failure" });
    captureClientError({ type: "manual", message: "same failure" });
    await waitForQueuedCount(store, 1);

    expect((await store.getAll())[0].event.release).toBe("web-test1234");

    await flushErrorMonitoring();

    const events = readSentEvents(transport);
    expect(events).toHaveLength(1);
    expect(events[0].tags).toEqual(expect.objectContaining({ localOccurrences: 3 }));
  });

  it("does not coalesce identical failures captured by different releases", async () => {
    configureWithoutHandlers();
    captureClientError({
      type: "manual",
      message: "same cross-release failure",
      release: "web-release-a",
    });
    captureClientError({
      type: "manual",
      message: "same cross-release failure",
      release: "web-release-b",
    });
    await waitForQueuedCount(store, 2);

    const queuedReleases = (await store.getAll())
      .map((item) => item.event.release)
      .sort();
    expect(queuedReleases).toEqual(["web-release-a", "web-release-b"]);

    await flushErrorMonitoring();

    const events = readSentEvents(transport);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.release).sort()).toEqual([
      "web-release-a",
      "web-release-b",
    ]);
  });

  it("coalesces duplicate API diagnostics reported by overlapping transports", async () => {
    configureWithoutHandlers();
    captureApiFailure({
      method: "POST",
      url: "/api/payments/confirm?token=private",
      status: 503,
      name: "XMLHttpRequestError",
      message: "XMLHttpRequest failed with status 503",
      tags: { transport: "xmlhttprequest" },
    });
    captureApiFailure({
      method: "POST",
      url: "/api/payments/confirm?token=different-private-value",
      status: 503,
      name: "AxiosError",
      message: "Request failed with status code 503",
      tags: { transport: "axios" },
    });
    await waitForQueuedCount(store, 1);

    await flushErrorMonitoring();
    const events = readSentEvents(transport);
    expect(events).toHaveLength(1);
    expect(events[0].tags).toEqual(expect.objectContaining({ localOccurrences: 2 }));
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("does not coalesce failures from different resource URLs", async () => {
    configureWithoutHandlers();
    captureClientError({
      type: "resource_error",
      message: "Failed to load script",
      context: { resourceUrl: "/static/booking-tools.js" },
    });
    captureClientError({
      type: "resource_error",
      message: "Failed to load script",
      context: { resourceUrl: "/static/task-planner.js" },
    });
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    expect(readSentEvents(transport)).toHaveLength(2);
  });

  it("coalesces one runtime crash and retains the richest React diagnosis", async () => {
    configureWithoutHandlers();
    const stack = "TypeError: Cannot read properties of null\n    at TaskPlanner (TaskPlanner.tsx:9006:73)";
    captureClientError({
      type: "exception",
      level: "error",
      name: "TypeError",
      message: "Cannot read properties of null",
      stack,
    });
    captureClientError({
      type: "console_error",
      level: "error",
      name: "ConsoleError",
      message: "Cannot read properties of null",
      stack,
    });
    captureClientError({
      type: "react_error",
      level: "fatal",
      name: "TypeError",
      message: "Cannot read properties of null",
      stack,
      componentStack: "at TaskPlanner\nat AppErrorBoundary",
      context: { boundary: "AppErrorBoundary" },
    });
    await waitForQueuedCount(store, 1);

    await flushErrorMonitoring();
    const events = readSentEvents(transport);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      type: "react_error",
      level: "fatal",
      componentStack: "at TaskPlanner\nat AppErrorBoundary",
      tags: expect.objectContaining({ localOccurrences: 3 }),
    }));
  });

  it("retains failed deliveries for a later retry", async () => {
    transport.mockRejectedValue(new TypeError("offline"));
    configureWithoutHandlers();
    captureClientError({ type: "manual", message: "save me" });
    await waitForQueuedCount(store, 1);

    await expect(flushErrorMonitoring()).resolves.toBe(false);
    const queued = await store.getAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].attempts).toBe(1);
    expect(queued[0].nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("keeps events offline and delivers them when connectivity returns", async () => {
    const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    configureWithoutHandlers();
    captureClientError({ type: "manual", message: "created offline" });
    await waitForQueuedCount(store, 1);

    await expect(flushErrorMonitoring()).resolves.toBe(false);
    expect(await store.getAll()).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await expect(flushErrorMonitoring()).resolves.toBe(true);
    expect(await store.getAll()).toEqual([]);
    if (originalOnline) {
      Object.defineProperty(navigator, "onLine", originalOnline);
    }
  });

  it("bounds the offline queue and retains the newest diagnostics", async () => {
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      maxQueueSize: 2,
      maxQueueBytes: 100_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    captureClientError({ type: "manual", message: "oldest" });
    captureClientError({ type: "manual", message: "middle" });
    captureClientError({ type: "manual", message: "newest" });
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    const messages = readSentEvents(transport).map((event) => event.message);
    expect(messages).toEqual(["middle", "newest"]);
  });

  it("retains fatal diagnostics ahead of newer warnings when the queue is full", async () => {
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      maxQueueSize: 2,
      maxQueueBytes: 100_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    captureClientError({ type: "manual", level: "fatal", message: "fatal-root-crash" });
    captureClientError({ type: "manual", level: "warning", message: "old-warning" });
    captureClientError({ type: "manual", level: "warning", message: "new-warning" });
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    expect(readSentEvents(transport).map((event) => event.message)).toEqual([
      "fatal-root-crash",
      "new-warning",
    ]);
  });

  it("reports an aggregate queue-overflow marker after delivery recovers", async () => {
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      maxQueueSize: 2,
      maxQueueBytes: 100_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    captureClientError({ type: "manual", message: "first" });
    captureClientError({ type: "manual", message: "second" });
    captureClientError({ type: "manual", message: "third" });
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    expect(await store.getAll()).toHaveLength(1);
    await flushErrorMonitoring();
    const overflow = readSentEvents(transport).find(
      (event) => event.name === "MonitoringQueueOverflow",
    );
    expect(overflow).toEqual(expect.objectContaining({
      level: "warning",
      tags: expect.objectContaining({
        monitoringQueueOverflow: true,
        droppedEvents: 1,
      }),
    }));
  });

  it("does not coalesce queued errors captured for different signed-in users", async () => {
    let userId = 41;
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
      getUserContext: () => ({ id: userId, authenticated: true }),
    });
    cleanup();
    captureClientError({ type: "manual", message: "same account-sensitive failure" });
    userId = 42;
    captureClientError({ type: "manual", message: "same account-sensitive failure" });
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    expect(readSentEvents(transport).map((event) => event.capturedUserId)).toEqual([41, 42]);
  });

  it("marks pre-login events explicitly anonymous so a later login cannot claim them", async () => {
    let userId: number | null = null;
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
      getUserContext: () => ({
        id: userId,
        authenticated: userId !== null,
      }),
    });
    cleanup();
    captureClientError({ type: "manual", message: "captured before login" });
    await waitForQueuedCount(store, 1);
    userId = 42;

    await flushErrorMonitoring();
    expect(readSentEvents(transport)[0]).toEqual(expect.objectContaining({
      capturedUserId: null,
    }));
  });

  it("times out a hung transport and coalesces concurrent flush callers", async () => {
    transport.mockImplementation(() => new Promise(() => undefined));
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      flushIntervalMs: 600_000,
      transportTimeoutMs: 1_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    try {
      captureClientError({ type: "manual", message: "hung delivery" });
      await waitForQueuedCount(store, 1);
      jest.useFakeTimers();
      const first = flushErrorMonitoring();
      const concurrent = flushErrorMonitoring();
      expect(concurrent).toBe(first);
      for (let tick = 0; tick < 20 && transport.mock.calls.length === 0; tick += 1) {
        await Promise.resolve();
      }
      expect(transport).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1_000);
      await expect(first).resolves.toBe(false);
      expect((await store.getAll())[0].attempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("captures window exceptions and resource failures", async () => {
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      flushIntervalMs: 600_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("render exploded"),
        message: "render exploded",
        filename: "https://omni-lodge.com/static/main.js?token=secret",
        lineno: 12,
        colno: 9,
      }),
    );
    const image = document.createElement("img");
    image.src = "https://omni-lodge.com/private-photo.jpg?signature=secret";
    document.body.appendChild(image);
    image.dispatchEvent(new Event("error"));
    cleanup();
    await waitForQueuedCount(store, 2);

    await flushErrorMonitoring();
    const events = readSentEvents(transport);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["exception", "resource_error"]),
    );
    expect(JSON.stringify(events)).not.toContain("signature=secret");
    image.remove();
  });

  it("instruments app fetch failures, including external uploads, but ignores health and resumable 308 responses", async () => {
    const originalFetch = window.fetch;
    const requestFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        headers: { get: () => "request-55" },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 308,
        statusText: "Resume incomplete",
        headers: { get: () => null },
      })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    window.fetch = requestFetch as typeof fetch;
    const cleanup = initializeErrorMonitoring({
      endpoint: `${window.location.origin}/api/client-errors/batch`,
      captureConsole: false,
      captureFetch: true,
      flushIntervalMs: 600_000,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });

    await window.fetch("/api/bookings?email=private@example.com");
    await window.fetch("/api/health");
    await window.fetch("/api/social-media/files", { method: "PUT" });
    await expect(
      window.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
        method: "PUT",
      }),
    ).rejects.toThrow("Failed to fetch");
    cleanup();
    await waitForQueuedCount(store, 2);
    await flushErrorMonitoring();

    const events = readSentEvents(transport);
    expect(events.filter((event) => event.type === "api_error")).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        requestId: "request-55",
        http: expect.objectContaining({ status: 503, method: "GET" }),
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: "api_error",
        message: "Failed to fetch",
        http: expect.objectContaining({ method: "PUT" }),
      }),
    );
    expect(JSON.stringify(events[1])).toContain("https://www.googleapis.com/upload/drive/v3/files");
    expect(JSON.stringify(events[1])).not.toContain("uploadType=resumable");
    expect(JSON.stringify(events)).not.toContain("private@example.com");
    window.fetch = originalFetch;
  });

  it("captures raw XMLHttpRequest status failures, timeouts, and aborts without response data", async () => {
    class FakeXmlHttpRequest extends EventTarget {
      status = 0;

      open(): void {}

      send(): void {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, "XMLHttpRequest");
    Object.defineProperty(window, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: FakeXmlHttpRequest as unknown as typeof XMLHttpRequest,
    });
    let cleanup: () => void = () => undefined;
    try {
      cleanup = initializeErrorMonitoring({
        endpoint: "/api/client-errors/batch",
        captureConsole: false,
        captureFetch: false,
        captureNetworkTransports: true,
        queueStore: store,
        fetchImpl: transport as typeof fetch,
      });
      const failed = new window.XMLHttpRequest();
      failed.open("POST", "/api/raw-payment?iban=PL61109010140000071219812874");
      failed.send();
      (failed as unknown as { status: number }).status = 503;
      failed.dispatchEvent(new Event("loadend"));

      const timedOut = new window.XMLHttpRequest();
      timedOut.open("GET", "/api/raw-timeout?customer=Pablo");
      timedOut.send();
      timedOut.dispatchEvent(new Event("timeout"));

      const aborted = new window.XMLHttpRequest();
      aborted.open("PUT", "/api/raw-abort?token=secret");
      aborted.send();
      aborted.dispatchEvent(new Event("abort"));
      cleanup();
      await waitForQueuedCount(store, 3);
      await flushErrorMonitoring();

      const events = readSentEvents(transport);
      expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
        "XMLHttpRequestError",
        "XMLHttpRequestTimeout",
        "XMLHttpRequestAbort",
      ]));
      expect(events.find((event) => event.name === "XMLHttpRequestError")?.http).toEqual(
        expect.objectContaining({ method: "POST", status: 503 }),
      );
      expect(JSON.stringify(events)).not.toContain("PL61109010140000071219812874");
      expect(JSON.stringify(events)).not.toContain("customer=Pablo");
      expect(JSON.stringify(events)).not.toContain("token=secret");
    } finally {
      cleanup();
      if (descriptor) Object.defineProperty(window, "XMLHttpRequest", descriptor);
    }
  });

  it("captures WebSocket and EventSource connection failures without messages or payloads", async () => {
    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      constructor(readonly url: string | URL) {
        super();
      }
    }
    class FakeEventSource extends EventTarget {
      constructor(readonly url: string | URL) {
        super();
      }
    }
    const webSocketDescriptor = Object.getOwnPropertyDescriptor(window, "WebSocket");
    const eventSourceDescriptor = Object.getOwnPropertyDescriptor(window, "EventSource");
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket as unknown as typeof WebSocket,
    });
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: FakeEventSource as unknown as typeof EventSource,
    });
    let cleanup: () => void = () => undefined;
    try {
      cleanup = initializeErrorMonitoring({
        endpoint: "/api/client-errors/batch",
        captureConsole: false,
        captureFetch: false,
        captureNetworkTransports: true,
        queueStore: store,
        fetchImpl: transport as typeof fetch,
      });
      const socket = new window.WebSocket("wss://omni-lodge.com/live?token=socket-secret");
      const source = new window.EventSource("/api/openBar/events?sessionId=private-session");
      expect(socket).toBeInstanceOf(FakeWebSocket);
      expect(source).toBeInstanceOf(FakeEventSource);
      socket.dispatchEvent(new Event("error"));
      source.dispatchEvent(new Event("error"));
      cleanup();
      await waitForQueuedCount(store, 2);
      await flushErrorMonitoring();

      const events = readSentEvents(transport);
      expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
        "WebSocketConnectionError",
        "EventSourceConnectionError",
      ]));
      expect(events.map((event) => (event.http as Record<string, unknown>).method)).toEqual(
        expect.arrayContaining(["WS", "SSE"]),
      );
      expect(JSON.stringify(events)).not.toContain("socket-secret");
      expect(JSON.stringify(events)).not.toContain("private-session");
    } finally {
      cleanup();
      if (webSocketDescriptor) Object.defineProperty(window, "WebSocket", webSocketDescriptor);
      if (eventSourceDescriptor) {
        Object.defineProperty(window, "EventSource", eventSourceDescriptor);
      } else {
        delete (window as unknown as { EventSource?: typeof EventSource }).EventSource;
      }
    }
  });

  it("provides Axios hooks and ignores canceled or expected responses", async () => {
    configureWithoutHandlers();
    const config = markAxiosRequestForErrorMonitoring({
      method: "post",
      baseURL: "https://omni-lodge.com/api",
      url: "/bookings?token=private",
    });
    expect(
      captureAxiosError({
        name: "AxiosError",
        message: "Request failed",
        code: "ERR_BAD_RESPONSE",
        config,
        response: {
          status: 422,
          statusText: "Unprocessable",
          data: {
            message: "Invalid guest@example.com for Pablo Cabrera",
            error: "Account PL61109010140000071219812874 is invalid",
            reference: "private-booking-reference",
            code: "VALIDATION_FAILED",
            password: "secret",
          },
          headers: { "x-request-id": "request-77" },
        },
      }),
    ).not.toBeNull();
    expect(
      captureAxiosError({
        name: "CanceledError",
        message: "canceled",
        code: "ERR_CANCELED",
        config: { url: "/api/search" },
      }),
    ).toBeNull();
    expect(
      captureApiFailure({ url: "/api/upload", status: 308, method: "PUT" }),
    ).toBeNull();
    await waitForQueuedCount(store, 1);

    await flushErrorMonitoring();
    const [event] = readSentEvents(transport);
    expect(event).toEqual(
      expect.objectContaining({
        type: "api_error",
        level: "warning",
        requestId: "request-77",
        http: expect.objectContaining({ status: 422 }),
      }),
    );
    expect(JSON.stringify(event)).not.toContain("guest@example.com");
    expect(JSON.stringify(event)).not.toContain("token=private");
    expect(JSON.stringify(event)).not.toContain("Pablo Cabrera");
    expect(JSON.stringify(event)).not.toContain("PL61109010140000071219812874");
    expect(JSON.stringify(event)).not.toContain("private-booking-reference");
    expect(JSON.stringify(event)).toContain("VALIDATION_FAILED");
  });

  it("ignores only unauthenticated GET session checks across URL forms", async () => {
    configureWithoutHandlers();

    expect(captureApiFailure({
      method: "GET",
      url: "/api/session",
      status: 401,
    })).toBeNull();
    expect(captureApiFailure({
      method: "get",
      url: "https://omni-lodge.com/api/session/?cache=private",
      status: 401,
    })).toBeNull();

    expect(captureApiFailure({
      method: "POST",
      url: "/api/session",
      status: 401,
    })).not.toBeNull();
    expect(captureApiFailure({
      method: "GET",
      url: "/api/session/profile-photo",
      status: 401,
    })).not.toBeNull();
    expect(captureApiFailure({
      method: "GET",
      url: "/api/bookings",
      status: 401,
    })).not.toBeNull();

    await waitForQueuedCount(store, 3);
    await flushErrorMonitoring();

    const events = readSentEvents(transport);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.http)).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "POST", url: "/api/session", status: 401 }),
      expect.objectContaining({ method: "GET", url: "/api/session/profile-photo", status: 401 }),
      expect.objectContaining({ method: "GET", url: "/api/bookings", status: 401 }),
    ]));
  });

  it("keeps console capture non-throwing for revoked proxy arguments", async () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: true,
      captureFetch: false,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    try {
      expect(() => console.error(proxy)).not.toThrow();
      cleanup();
      await waitForQueuedCount(store, 1);
      await flushErrorMonitoring();
      expect(readSentEvents(transport)[0]).toEqual(expect.objectContaining({
        type: "console_error",
      }));
    } finally {
      cleanup();
      console.error = originalConsoleError;
    }
  });

  it("drains startup failures captured before the application bundle loaded", async () => {
    const dispose = jest.fn();
    const host = window as unknown as {
      __OMNILODGE_EARLY_ERROR_BUFFER__?: {
        events: unknown[];
        dispose: () => void;
      };
    };
    host.__OMNILODGE_EARLY_ERROR_BUFFER__ = {
      events: [
        {
          type: "resource_error",
          capturedUserId: null,
          level: "error",
          name: "EarlyResourceLoadError",
          message: "Failed to load script",
          release: "web-preboot",
          occurredAt: "2026-09-10T01:02:03.000Z",
          context: { earlyBoot: true, source: "/pwa-manifest-selector.js" },
        },
      ],
      dispose,
    };
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      release: "web-mainhash",
      captureConsole: false,
      captureFetch: false,
      queueStore: store,
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    await flushErrorMonitoring();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.__OMNILODGE_EARLY_ERROR_BUFFER__).toBeUndefined();
    expect(readSentEvents(transport)[0]).toEqual(
      expect.objectContaining({
        type: "resource_error",
        name: "EarlyResourceLoadError",
        capturedUserId: null,
        release: "web-mainhash",
        occurredAt: "2026-09-10T01:02:03.000Z",
      }),
    );
  });

  it("captures a visible online page whose application root stays blank", async () => {
    jest.useFakeTimers();
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(document, "readyState");
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    document.body.innerHTML = '<div id="root"></div>';

    try {
      initializeErrorMonitoring({
        endpoint: "/api/client-errors/batch",
        release: "web-test1234",
        environment: "test",
        captureConsole: false,
        captureFetch: false,
        flushIntervalMs: 600_000,
        queueStore: store,
        fetchImpl: transport as typeof fetch,
      });
      jest.advanceTimersByTime(20_000);
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      await flushErrorMonitoring();
      await flushErrorMonitoring();

      const captured = readSentEvents(transport).find(
        (event) => event.name === "AppBootstrapTimeout",
      );
      expect(captured).toEqual(expect.objectContaining({
        name: "AppBootstrapTimeout",
        level: "fatal",
      }));
    } finally {
      await resetErrorMonitoringForTests();
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      if (readyStateDescriptor) Object.defineProperty(document, "readyState", readyStateDescriptor);
      if (onlineDescriptor) Object.defineProperty(navigator, "onLine", onlineDescriptor);
      jest.useRealTimers();
    }
  });

  it("rechecks a blank application root after a hidden tab becomes visible", async () => {
    jest.useFakeTimers();
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(document, "readyState");
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    document.body.innerHTML = '<div id="root"></div>';

    try {
      initializeErrorMonitoring({
        endpoint: "/api/client-errors/batch",
        captureConsole: false,
        captureFetch: false,
        flushIntervalMs: 600_000,
        queueStore: store,
        fetchImpl: transport as typeof fetch,
      });
      jest.advanceTimersByTime(20_000);
      await Promise.resolve();
      expect(await store.getAll()).toEqual([]);

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      jest.advanceTimersByTime(5_000);
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      await flushErrorMonitoring();
      await flushErrorMonitoring();
      expect(readSentEvents(transport)).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "AppBootstrapTimeout", level: "fatal" }),
      ]));
    } finally {
      await resetErrorMonitoringForTests();
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      if (readyStateDescriptor) Object.defineProperty(document, "readyState", readyStateDescriptor);
      if (onlineDescriptor) Object.defineProperty(navigator, "onLine", onlineDescriptor);
      jest.useRealTimers();
    }
  });
});
