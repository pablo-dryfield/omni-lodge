import {
  createBrowserClientErrorQueueStore,
  IndexedDbClientErrorQueueStore,
  LocalStorageClientErrorQueueStore,
  MemoryClientErrorQueueStore,
  ResilientClientErrorQueueStore,
} from "./errorMonitoringQueue";
import type { ClientErrorQueueStore, QueuedClientError } from "./errorMonitoringTypes";

const STORAGE_KEY = "omnilodge:error-monitoring:queue:v1";

const queued = (id: string, message = id): QueuedClientError => ({
  id,
  fingerprint: `fingerprint-${id}`,
  enqueuedAt: 1,
  nextAttemptAt: 1,
  attempts: 0,
  event: {
    eventId: id,
    type: "manual",
    level: "error",
    message,
    occurredAt: "2026-09-10T00:00:00.000Z",
  },
});

class FailsWritesAfterExistingData implements ClientErrorQueueStore {
  constructor(private readonly existing: QueuedClientError[]) {}

  getAll(): Promise<QueuedClientError[]> {
    return Promise.resolve([...this.existing]);
  }

  put(): Promise<void> {
    return Promise.reject(new Error("IndexedDB write failed"));
  }

  remove(): Promise<void> {
    return Promise.reject(new Error("IndexedDB remove failed"));
  }

  clear(): Promise<void> {
    return Promise.reject(new Error("IndexedDB clear failed"));
  }
}

describe("error monitoring queue fallbacks", () => {
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    jest.restoreAllMocks();
  });

  it("migrates recoverable IndexedDB records before continuing in the fallback", async () => {
    const fallback = new MemoryClientErrorQueueStore();
    const store = new ResilientClientErrorQueueStore(
      new FailsWritesAfterExistingData([queued("existing")]),
      fallback,
    );

    await store.put(queued("new"));

    expect((await store.getAll()).map((item) => item.id).sort()).toEqual([
      "existing",
      "new",
    ]);
  });

  it("merges in-memory records with records already persisted in localStorage", async () => {
    const store = new LocalStorageClientErrorQueueStore();
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("Quota exceeded");
      });
    await store.put(queued("memory"));
    setItem.mockRestore();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([queued("persisted")]));

    expect((await store.getAll()).map((item) => item.id).sort()).toEqual([
      "memory",
      "persisted",
    ]);
  });

  it("moves memory fallback records into localStorage when storage recovers", async () => {
    const store = new LocalStorageClientErrorQueueStore();
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("Storage temporarily unavailable");
      });
    await store.put(queued("offline"));
    setItem.mockRestore();

    await store.put(queued("online"));

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    expect(persisted.map((item: QueuedClientError) => item.id).sort()).toEqual([
      "offline",
      "online",
    ]);
    expect((await store.getAll()).map((item) => item.id).sort()).toEqual([
      "offline",
      "online",
    ]);
  });

  it("recovers fallback records from a previous run and removes sent copies from both stores", async () => {
    const primary = new MemoryClientErrorQueueStore();
    const fallback = new MemoryClientErrorQueueStore();
    await primary.put(queued("primary"));
    await fallback.put(queued("fallback"));
    const store = new ResilientClientErrorQueueStore(primary, fallback);

    expect((await store.getAll()).map((item) => item.id).sort()).toEqual([
      "fallback",
      "primary",
    ]);

    await store.remove(["fallback", "primary"]);

    expect(await primary.getAll()).toEqual([]);
    expect(await fallback.getAll()).toEqual([]);
  });

  it("falls back to memory when reading the localStorage getter itself throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    try {
      const store = new LocalStorageClientErrorQueueStore();
      await expect(store.put(queued("privacy-mode"))).resolves.toBeUndefined();
      expect((await store.getAll()).map((item) => item.id)).toEqual(["privacy-mode"]);
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });

  it("falls back safely when reading the indexedDB getter itself throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => {
        throw new DOMException("IndexedDB blocked", "SecurityError");
      },
    });
    try {
      const store = createBrowserClientErrorQueueStore();
      await expect(store.put(queued("no-indexed-db"))).resolves.toBeUndefined();
      expect((await store.getAll()).map((item) => item.id)).toEqual(["no-indexed-db"]);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "indexedDB", descriptor);
      } else {
        delete (window as unknown as { indexedDB?: IDBFactory }).indexedDB;
      }
    }
  });

  it("does not report an IndexedDB write as durable until its transaction commits", async () => {
    type MutableRequest<T> = {
      result: T;
      error: DOMException | null;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      onblocked?: (() => void) | null;
      onupgradeneeded?: (() => void) | null;
    };
    const putRequest: MutableRequest<IDBValidKey> = {
      result: "commit-test",
      error: null,
      onsuccess: null,
      onerror: null,
    };
    const transaction = {
      error: null as DOMException | null,
      objectStore: () => ({ put: () => putRequest }),
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
    };
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => transaction,
    };
    const openRequest: MutableRequest<typeof database> = {
      result: database,
      error: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      onupgradeneeded: null,
    };
    const descriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open: () => openRequest } as unknown as IDBFactory,
    });
    try {
      const store = new IndexedDbClientErrorQueueStore();
      let resolved = false;
      const write = store.put(queued("commit-test")).then(() => {
        resolved = true;
      });
      openRequest.onsuccess?.();
      await Promise.resolve();
      await Promise.resolve();
      putRequest.onsuccess?.();
      await Promise.resolve();
      expect(resolved).toBe(false);

      transaction.oncomplete?.();
      await write;
      expect(resolved).toBe(true);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "indexedDB", descriptor);
      } else {
        delete (window as unknown as { indexedDB?: IDBFactory }).indexedDB;
      }
    }
  });
});
