/**
 * IndexedDB project storage (BUILD_PLAN.md §Phase 7).
 *
 * Hand-rolled rather than pulling a wrapper library: the surface used here is
 * four operations, and every one of them must degrade to "no persistence"
 * rather than throwing, because private-browsing modes and full disks are
 * ordinary conditions the editor has to survive.
 */
import type { ForgeProject } from '@/store/persistence';

const DB_NAME = 'arduforge';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const META = 'meta';

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly project: ForgeProject;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });

  return dbPromise;
}

/**
 * IndexedDB hands back structured-clone output, which the DOM types describe as
 * `any`. Pretending otherwise would spread that `any` through every caller, so
 * the untyped edge is confined to this one function: the single assertion below
 * is the one place a stored value acquires a type. Callers that use the result
 * to drive the editor must still validate it — see readStoredProject in
 * projectManager.
 *
 * `action` is typed as the bare `IDBRequest`, which is the DOM's own
 * `IDBRequest<any>`, and not `IDBRequest<unknown>`. `IDBRequest<T>` is
 * invariant in T — its `onsuccess` handler carries a `this: IDBRequest<T>`
 * parameter — so `IDBRequest<undefined>` from `store.delete` and
 * `IDBRequest<IDBValidKey>` from `store.put` are both unassignable to
 * `IDBRequest<unknown>`, and every write call site fails to compile.
 */
function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export const projectStore = {
  async list(): Promise<ProjectRecord[]> {
    try {
      const all = await run<ProjectRecord[]>(PROJECTS, 'readonly', (store) => store.getAll());
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  },

  async get(id: string): Promise<ProjectRecord | null> {
    try {
      const found = await run<ProjectRecord | undefined>(PROJECTS, 'readonly', (store) =>
        store.get(id),
      );
      return found ?? null;
    } catch {
      return null;
    }
  },

  async put(record: ProjectRecord): Promise<void> {
    try {
      await run(PROJECTS, 'readwrite', (store) => store.put(record));
    } catch {
      // Persistence is best-effort; losing it must not take the editor down.
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await run(PROJECTS, 'readwrite', (store) => store.delete(id));
    } catch {
      // ignore
    }
  },
};

export const metaStore = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await run<T | undefined>(META, 'readonly', (store) => store.get(key));
      return value ?? null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown): Promise<void> {
    try {
      await run(META, 'readwrite', (store) => store.put(value, key));
    } catch {
      // ignore
    }
  },
};

/**
 * Crash detection (§Phase 7 recovery).
 *
 * A flag is raised while the editor is open and lowered on a clean unload. If
 * it is still raised at startup, the previous session ended without unloading —
 * a crash, a kill, or a lost tab — and the autosave is worth offering back.
 */
const DIRTY_KEY = 'session-open';

export async function markSessionOpen(): Promise<boolean> {
  const wasOpen = (await metaStore.get<boolean>(DIRTY_KEY)) === true;
  await metaStore.set(DIRTY_KEY, true);
  return wasOpen;
}

export async function markSessionClosed(): Promise<void> {
  await metaStore.set(DIRTY_KEY, false);
}
