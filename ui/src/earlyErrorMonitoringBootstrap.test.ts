import { readFileSync } from "fs";
import path from "path";

type EarlyBuffer = {
  events: Array<Record<string, unknown>>;
  dispose: () => void;
};

const publicDirectory = path.join(process.cwd(), "public");
const bootstrapSource = readFileSync(
  path.join(publicDirectory, "early-error-monitoring.js"),
  "utf8",
);
const storageKey = "omnilodge:early-error-buffer:v1";

const earlyBufferHost = (): Window & {
  __OMNILODGE_EARLY_ERROR_BUFFER__?: EarlyBuffer;
} => window as Window & { __OMNILODGE_EARLY_ERROR_BUFFER__?: EarlyBuffer };

describe("early error monitoring bootstrap", () => {
  const originalFetch = window.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    earlyBufferHost().__OMNILODGE_EARLY_ERROR_BUFFER__?.dispose();
    delete earlyBufferHost().__OMNILODGE_EARLY_ERROR_BUFFER__;
    window.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("loads the self-hosted monitor before the manifest selector", () => {
    const html = readFileSync(path.join(publicDirectory, "index.html"), "utf8");
    const monitorIndex = html.indexOf("early-error-monitoring.js");
    const selectorIndex = html.indexOf("pwa-manifest-selector.js");

    expect(monitorIndex).toBeGreaterThan(-1);
    expect(selectorIndex).toBeGreaterThan(monitorIndex);
    expect(html).not.toContain("__OMNILODGE_EARLY_ERROR_BUFFER__");
  });

  it("persists a redacted bounded event and removes it only after confirmation", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = fetchMock as unknown as typeof fetch;
    window.eval(bootstrapSource);

    window.dispatchEvent(new ErrorEvent("error", {
      message: "Startup failed for private@example.com",
      error: new Error("Startup failed for private@example.com"),
      filename: "/static/js/main.js?token=private",
    }));

    const persisted = window.localStorage.getItem(storageKey);
    expect(persisted).toBeTruthy();
    expect(persisted).not.toContain("private@example.com");
    expect(persisted).not.toContain("token=private");
    expect(JSON.parse(persisted || "[]")).toEqual([
      expect.objectContaining({ capturedUserId: null }),
    ]);

    window.dispatchEvent(new Event("pagehide"));
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("bounds Unicode-heavy persistence and transport by UTF-8 bytes", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = fetchMock as unknown as typeof fetch;
    window.eval(bootstrapSource);

    const unicodeStack = `Error: unicode\n${"😀".repeat(3_500)}`;
    for (let index = 0; index < 6; index += 1) {
      window.dispatchEvent(new ErrorEvent("error", {
        message: `Unicode startup failure ${index}`,
        error: {
          name: "UnicodeStartupError",
          message: `Unicode startup failure ${index}`,
          stack: unicodeStack,
        },
      }));
    }

    const persisted = window.localStorage.getItem(storageKey);
    expect(persisted).toBeTruthy();
    expect(Buffer.byteLength(persisted || "", "utf8")).toBeLessThan(48_000);
    expect(JSON.parse(persisted || "[]").length).toBeLessThan(6);

    window.dispatchEvent(new Event("pagehide"));
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();

    const requestBody = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(Buffer.byteLength(requestBody, "utf8")).toBeLessThan(48_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rearms the bootstrap watchdog when a hidden tab becomes visible", async () => {
    jest.useFakeTimers();
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(document, "readyState");
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    try {
      window.eval(bootstrapSource);
      jest.advanceTimersByTime(20_000);
      expect(window.localStorage.getItem(storageKey)).toBeNull();

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      jest.advanceTimersByTime(5_000);
      const persisted = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      expect(persisted).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "AppBootstrapTimeout", level: "fatal" }),
      ]));
    } finally {
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      if (readyStateDescriptor) Object.defineProperty(document, "readyState", readyStateDescriptor);
      if (onlineDescriptor) Object.defineProperty(navigator, "onLine", onlineDescriptor);
      jest.useRealTimers();
    }
  });
});
