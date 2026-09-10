import {
  initializeErrorMonitoring,
  resetErrorMonitoringForTests,
} from "./errorMonitoring";
import { MemoryClientErrorQueueStore } from "./errorMonitoringQueue";

const requestUse = jest.fn();
const requestEject = jest.fn();
const responseUse = jest.fn();
const responseEject = jest.fn();
const defaultAxiosClient = {
  interceptors: {
    request: { use: requestUse, eject: requestEject },
    response: { use: responseUse, eject: responseEject },
  },
};

describe("default Axios error monitoring", () => {
  afterEach(async () => {
    await resetErrorMonitoringForTests();
    jest.clearAllMocks();
  });

  it("timestamps direct Axios requests, observes failures, and ejects both hooks", async () => {
    requestUse.mockReturnValue(11);
    responseUse.mockReturnValue(22);
    const cleanup = initializeErrorMonitoring({
      captureConsole: false,
      captureFetch: false,
      queueStore: new MemoryClientErrorQueueStore(),
      fetchImpl: jest.fn().mockResolvedValue({ status: 202 }) as typeof fetch,
      defaultAxiosClient,
    });

    expect(requestUse).toHaveBeenCalledTimes(1);
    expect(responseUse).toHaveBeenCalledTimes(1);
    const requestHandler = requestUse.mock.calls[0][0] as (
      config: Record<string, unknown>,
    ) => Record<string, unknown>;
    expect(requestHandler({})).toEqual(
      expect.objectContaining({
        __omnilodgeErrorMonitoringStartedAt: expect.any(Number),
      }),
    );

    cleanup();
    expect(requestEject).toHaveBeenCalledWith(11);
    expect(responseEject).toHaveBeenCalledWith(22);
  });
});
