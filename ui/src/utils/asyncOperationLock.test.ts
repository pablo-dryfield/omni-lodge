import {
  releaseAsyncOperationLock,
  tryAcquireAsyncOperationLock,
} from "./asyncOperationLock";

describe("async operation lock", () => {
  it("rejects re-entrant work synchronously until the active operation releases it", () => {
    const lock = { current: false };

    expect(tryAcquireAsyncOperationLock(lock)).toBe(true);
    expect(tryAcquireAsyncOperationLock(lock)).toBe(false);

    releaseAsyncOperationLock(lock);

    expect(tryAcquireAsyncOperationLock(lock)).toBe(true);
  });
});
