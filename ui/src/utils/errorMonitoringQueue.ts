import type {
  ClientErrorQueueStore,
  QueuedClientError,
} from "./errorMonitoringTypes";

const DATABASE_NAME = "omnilodge-error-monitoring";
const STORE_NAME = "pending-events";
const LOCAL_STORAGE_KEY = "omnilodge:error-monitoring:queue:v1";

export class MemoryClientErrorQueueStore implements ClientErrorQueueStore {
  private items = new Map<string, QueuedClientError>();

  async getAll(): Promise<QueuedClientError[]> {
    return Array.from(this.items.values()).map((item) => ({ ...item }));
  }

  async put(item: QueuedClientError): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  async remove(ids: string[]): Promise<void> {
    ids.forEach((id) => this.items.delete(id));
  }

  async clear(): Promise<void> {
    this.items.clear();
  }
}

export class LocalStorageClientErrorQueueStore implements ClientErrorQueueStore {
  private readonly memoryFallback = new MemoryClientErrorQueueStore();

  private canUseStorage(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      // Accessing the Storage getter itself throws in some privacy modes and
      // embedded browsers, before getItem/setItem can be attempted.
      return Boolean(window.localStorage);
    } catch {
      return false;
    }
  }

  private read(): QueuedClientError[] {
    if (!this.canUseStorage()) {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(items: QueuedClientError[]): boolean {
    if (!this.canUseStorage()) {
      return false;
    }
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
      return true;
    } catch {
      return false;
    }
  }

  async getAll(): Promise<QueuedClientError[]> {
    const persisted = this.read();
    const memory = await this.memoryFallback.getAll();
    const merged = new Map<string, QueuedClientError>();
    persisted.forEach((item) => merged.set(item.id, item));
    memory.forEach((item) => merged.set(item.id, item));
    return Array.from(merged.values());
  }

  async put(item: QueuedClientError): Promise<void> {
    const items = await this.getAll();
    const next = items.filter((candidate) => candidate.id !== item.id);
    next.push(item);
    if (this.write(next)) {
      await this.memoryFallback.clear();
    } else {
      await this.memoryFallback.put(item);
    }
  }

  async remove(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    const items = this.read().filter((candidate) => !idSet.has(candidate.id));
    this.write(items);
    await this.memoryFallback.remove(ids);
  }

  async clear(): Promise<void> {
    if (this.canUseStorage()) {
      try {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch {
        // The in-memory fallback is still cleared below.
      }
    }
    await this.memoryFallback.clear();
  }
}

export class IndexedDbClientErrorQueueStore implements ClientErrorQueueStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Unable to open error queue"));
      request.onblocked = () => reject(new Error("Error queue database is blocked"));
    });
    return this.databasePromise;
  }

  private async request<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error || new Error("Error queue request failed"));
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        // IndexedDB requests can report success before the containing write
        // transaction commits. Resolve only after oncomplete so callers never
        // delete a durable fallback copy for a transaction that later aborts.
        resolve(result);
      };
      transaction.onerror = () => fail(
        transaction.error || request.error || new Error("Error queue transaction failed"),
      );
      transaction.onabort = () => fail(
        transaction.error || request.error || new Error("Error queue transaction aborted"),
      );
    });
  }

  getAll(): Promise<QueuedClientError[]> {
    return this.request("readonly", (store) => store.getAll());
  }

  async put(item: QueuedClientError): Promise<void> {
    await this.request("readwrite", (store) => store.put(item));
  }

  async remove(ids: string[]): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to remove sent errors"));
      transaction.onabort = () => reject(transaction.error || new Error("Unable to remove sent errors"));
    });
  }

  async clear(): Promise<void> {
    await this.request("readwrite", (store) => store.clear());
  }
}

export class ResilientClientErrorQueueStore implements ClientErrorQueueStore {
  private primaryDisabled = false;
  private failoverPromise: Promise<void> | null = null;

  constructor(
    private readonly primary: ClientErrorQueueStore | null,
    private readonly fallback: ClientErrorQueueStore,
  ) {}

  private failover(): Promise<void> {
    if (this.failoverPromise) {
      return this.failoverPromise;
    }
    this.primaryDisabled = true;
    this.failoverPromise = (async () => {
      if (!this.primary) {
        return;
      }
      try {
        const recoverable = await this.primary.getAll();
        for (const item of recoverable) {
          await this.fallback.put(item);
        }
      } catch {
        // The primary store is unavailable. Already-persisted records remain in
        // IndexedDB and can be retried on a future application session.
      }
    })();
    return this.failoverPromise;
  }

  async getAll(): Promise<QueuedClientError[]> {
    if (!this.primary || this.primaryDisabled) {
      await this.failoverPromise;
      return this.fallback.getAll();
    }
    try {
      const [primaryItems, fallbackItems] = await Promise.all([
        this.primary.getAll(),
        this.fallback.getAll(),
      ]);
      const merged = new Map<string, QueuedClientError>();
      primaryItems.forEach((item) => merged.set(item.id, item));
      // Fallback items may be newer updates written during a previous
      // IndexedDB failure, so they deliberately win on duplicate ids.
      fallbackItems.forEach((item) => merged.set(item.id, item));
      return Array.from(merged.values());
    } catch {
      await this.failover();
      return this.fallback.getAll();
    }
  }

  async put(item: QueuedClientError): Promise<void> {
    if (!this.primary || this.primaryDisabled) {
      await this.failoverPromise;
      await this.fallback.put(item);
      return;
    }
    try {
      await this.primary.put(item);
      // Remove any stale failover copy left by an earlier application run.
      await this.fallback.remove([item.id]);
    } catch {
      await this.failover();
      await this.fallback.put(item);
    }
  }

  async remove(ids: string[]): Promise<void> {
    if (!this.primary || this.primaryDisabled) {
      await this.failoverPromise;
      await this.fallback.remove(ids);
      return;
    }
    try {
      await this.primary.remove(ids);
      await this.fallback.remove(ids);
    } catch {
      await this.failover();
      await this.fallback.remove(ids);
    }
  }

  async clear(): Promise<void> {
    if (!this.primary || this.primaryDisabled) {
      await this.failoverPromise;
      await this.fallback.clear();
      return;
    }
    try {
      await this.primary.clear();
      await this.fallback.clear();
    } catch {
      await this.failover();
      await this.fallback.clear();
    }
  }
}

export const createBrowserClientErrorQueueStore = (): ClientErrorQueueStore => {
  const fallback = new LocalStorageClientErrorQueueStore();
  let indexedDb: ClientErrorQueueStore | null = null;
  try {
    // Like localStorage, merely reading the IndexedDB getter can throw in
    // privacy-constrained webviews.
    if (typeof window !== "undefined" && window.indexedDB) {
      indexedDb = new IndexedDbClientErrorQueueStore();
    }
  } catch {
    indexedDb = null;
  }
  return new ResilientClientErrorQueueStore(indexedDb, fallback);
};
