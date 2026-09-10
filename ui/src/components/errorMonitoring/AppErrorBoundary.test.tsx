import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  flushErrorMonitoring,
  initializeErrorMonitoring,
  resetErrorMonitoringForTests,
} from "../../utils/errorMonitoring";
import { MemoryClientErrorQueueStore } from "../../utils/errorMonitoringQueue";
import AppErrorBoundary from "./AppErrorBoundary";

const Broken = (): JSX.Element => {
  throw new Error("Broken child");
};

describe("AppErrorBoundary", () => {
  const transport = jest.fn().mockResolvedValue({ status: 202 } as Response);

  beforeEach(async () => {
    await resetErrorMonitoringForTests();
    transport.mockClear();
    const cleanup = initializeErrorMonitoring({
      endpoint: "/api/client-errors/batch",
      captureConsole: false,
      captureFetch: false,
      queueStore: new MemoryClientErrorQueueStore(),
      fetchImpl: transport as typeof fetch,
    });
    cleanup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await resetErrorMonitoringForTests();
    jest.restoreAllMocks();
  });

  it("reports a React crash and renders an accessible recovery screen", async () => {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeInTheDocument();
    expect(screen.getByText(/Error reference:/)).toBeInTheDocument();

    await flushErrorMonitoring();
    const body = JSON.parse(String((transport.mock.calls[0][1] as RequestInit).body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        type: "react_error",
        level: "fatal",
        message: "Broken child",
        componentStack: expect.stringContaining("Broken"),
      }),
    );
  });

  it("supports a custom fallback and reset action", async () => {
    const onReset = jest.fn();
    render(
      <AppErrorBoundary
        onReset={onReset}
        fallback={({ reset }) => <button onClick={reset}>Recover now</button>}
      >
        <Broken />
      </AppErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Recover now" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
