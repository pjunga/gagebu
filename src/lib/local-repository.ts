import {
  asFiniteNumber,
  asNonEmptyString,
  createEntityId,
  type BaseEntity,
  type IncomeDetails,
  type SavingsAccount,
  type StockOrder,
  type Transaction,
  type WorkCategoryRecord,
  type WorkItem,
} from "./domain";
import {
  nowIso,
  reportRepositoryError,
  RepositoryError,
  sortEntities,
  type CollectionRepository,
  type DomainRepositories,
  type RepositoryErrorListener,
  type Unsubscribe,
} from "./repository-types";

export const LEGACY_TRANSACTION_STORAGE_KEY = "gagebu:transactions";
export const LEGACY_MIGRATION_STORAGE_KEY = "gagebu:transactions:migrated:v2";

export const LOCAL_STORAGE_KEYS = {
  transactions: "gagebu:transactions:v2",
  savingsAccounts: "gagebu:savings-accounts:v1",
  stockOrders: "gagebu:stock-orders:v1",
  workItems: "gagebu:work-items:v1",
  workCategories: "gagebu:work-categories:v1",
} as const;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memoryStorage = new Map<string, string>();

function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage: StorageLike | null, key: string): string | null {
  if (!storage) return memoryStorage.get(key) ?? null;
  try {
    return storage.getItem(key);
  } catch {
    // A browser can deny localStorage (private mode, quota policy, etc.).
    return memoryStorage.get(key) ?? null;
  }
}

function writeRaw(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) {
    memoryStorage.set(key, value);
    return;
  }
  try {
    storage.setItem(key, value);
  } catch (error) {
    // Keep nothing: the fallback is for callers with no storage at all, and a
    // rejected value left there would come back after a rollback.
    throw new RepositoryError(
      "브라우저 저장 공간에 기록하지 못했습니다. 저장 공간을 확인해주세요.",
      { code: "storage/write-failed", operation: "write", cause: error },
    );
  }
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const records = (parsed as { records?: unknown; transactions?: unknown })
        .records;
      if (Array.isArray(records)) return records;
      const transactions = (parsed as { transactions?: unknown }).transactions;
      if (Array.isArray(transactions)) return transactions;
    }
  } catch {
    // Invalid user data should result in an empty view, not a render crash.
  }
  return [];
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(text)) {
    const parts = text.split(/[./-]/).map(Number);
    if (parts.every(Number.isFinite)) {
      return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(
        parts[2],
      ).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function readIncomeDetails(value: unknown): IncomeDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const sourceValue = asNonEmptyString(raw.source).toLowerCase();
  const source =
    sourceValue === "salary" || sourceValue === "월급" || sourceValue === "급여"
      ? "salary"
      : sourceValue === "side-income" ||
          sourceValue === "sideincome" ||
          sourceValue === "부수입"
        ? "side-income"
        : "other";
  const result: IncomeDetails = { source };
  const stringKeys = [
    "employer",
    "payer",
    "sourceName",
    "paymentDate",
    "month",
    "note",
  ] as const;
  for (const key of stringKeys) {
    const item = asNonEmptyString(raw[key]);
    if (item) result[key] = item;
  }
  const numberKeys = ["count", "grossAmount", "netAmount", "taxAmount"] as const;
  for (const key of numberKeys) {
    const rawNumber = raw[key];
    if (rawNumber === undefined || rawNumber === null || rawNumber === "") continue;
    const number = asFiniteNumber(rawNumber, Number.NaN);
    if (Number.isFinite(number)) result[key] = number;
  }
  if (typeof raw.recurring === "boolean") result.recurring = raw.recurring;
  const workItemId = asNonEmptyString(raw.workItemId);
  if (workItemId) result.workItemId = workItemId;
  return result;
}

export interface LegacyMigrationResult {
  transactions: Transaction[];
  migrated: boolean;
  warnings: string[];
}

function normalizeLegacyTransaction(value: unknown, index: number): Transaction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawType = asNonEmptyString(raw.type || raw.kind).toLowerCase();
  const type =
    rawType === "income" || rawType === "수입" ? "income" : rawType === "expense" || rawType === "지출" ? "expense" : null;
  if (!type) return null;

  const amount = asFiniteNumber(raw.amount, Number.NaN);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const date = validDate(raw.date || raw.paymentDate || raw.occurredAt) ?? "1970-01-01";
  const category = asNonEmptyString(raw.category, type === "income" ? "기타 수입" : "기타 지출");
  const memo = asNonEmptyString(raw.memo || raw.description, type === "income" ? "수입" : "지출");
  const incomeDetails = readIncomeDetails(
    raw.incomeDetails || raw.incomeDetail || raw.details,
  );
  const id = asNonEmptyString(raw.id) || createEntityId(`legacy_${index}`);

  const sourceValue = asNonEmptyString(raw.source).toLowerCase();
  const source =
    sourceValue === "import"
      ? "import"
      : sourceValue === "manual"
        ? "manual"
        : "legacy";

  return {
    id,
    type,
    category,
    amount,
    memo,
    date,
    ...(incomeDetails ? { incomeDetails } : {}),
    ...(asNonEmptyString(raw.workItemId)
      ? { workItemId: asNonEmptyString(raw.workItemId) }
      : {}),
    source,
    ...(asNonEmptyString(raw.fingerprint)
      ? { fingerprint: asNonEmptyString(raw.fingerprint) }
      : {}),
    ...(validDate(raw.createdAt) ? { createdAt: validDate(raw.createdAt) } : {}),
    ...(validDate(raw.updatedAt) ? { updatedAt: validDate(raw.updatedAt) } : {}),
  };
}

export function readLegacyTransactions(storage?: StorageLike | null): Transaction[] {
  const target = storage === undefined ? getDefaultStorage() : storage;
  const raw = parseArray(readRaw(target, LEGACY_TRANSACTION_STORAGE_KEY));
  return raw
    .map((item, index) => normalizeLegacyTransaction(item, index))
    .filter((item): item is Transaction => item !== null);
}

function mergeItems<T extends BaseEntity>(current: T[], incoming: T[]): T[] {
  const result = [...current];
  const byIdentity = new Map<string, number>();
  result.forEach((item, index) => {
    byIdentity.set(`id:${item.id}`, index);
    if (item.fingerprint) byIdentity.set(`fingerprint:${item.fingerprint}`, index);
  });
  for (const item of incoming) {
    const existingIndex =
      byIdentity.get(`id:${item.id}`) ??
      (item.fingerprint ? byIdentity.get(`fingerprint:${item.fingerprint}`) : undefined);
    if (existingIndex === undefined) {
      byIdentity.set(`id:${item.id}`, result.length);
      if (item.fingerprint) byIdentity.set(`fingerprint:${item.fingerprint}`, result.length);
      result.push(item);
      continue;
    }
    // Current v2 data wins over the legacy shape. This preserves edits made
    // after a previous migration while still allowing missing legacy records in.
  }
  return result;
}

export function migrateLegacyTransactions(
  storage?: StorageLike | null,
): LegacyMigrationResult {
  const target = storage === undefined ? getDefaultStorage() : storage;
  const legacy = readLegacyTransactions(target);
  const current = parseArray(readRaw(target, LOCAL_STORAGE_KEYS.transactions))
    .map((item, index) => normalizeLegacyTransaction(item, index))
    .filter((item): item is Transaction => item !== null)
    .map((item) => ({ ...item, source: item.source === "legacy" ? "manual" : item.source }));
  const merged = mergeItems(current, legacy);
  const warnings: string[] = [];
  const marker = readRaw(target, LEGACY_MIGRATION_STORAGE_KEY);
  let migrated = marker === "true";

  if (merged.length !== current.length || !marker) {
    try {
      writeRaw(target, LOCAL_STORAGE_KEYS.transactions, JSON.stringify(merged));
      writeRaw(target, LEGACY_MIGRATION_STORAGE_KEY, "true");
      migrated = true;
    } catch {
      warnings.push("기존 거래를 새 저장 형식으로 옮기지 못했습니다.");
    }
  }

  return { transactions: merged, migrated, warnings };
}

function parseStored<T extends BaseEntity>(raw: string | null): T[] {
  const values = parseArray(raw);
  return values.filter((value): value is T => {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof (value as { id?: unknown }).id === "string" &&
        Boolean((value as { id: string }).id),
    );
  });
}

function cloneStored<T extends BaseEntity>(item: T): T {
  try {
    return structuredClone(item);
  } catch {
    return JSON.parse(JSON.stringify(item)) as T;
  }
}

export interface LocalStorageRepositoryOptions<T extends BaseEntity> {
  key: string;
  storage?: StorageLike | null;
  initial?: T[];
  normalize?: (item: T) => T;
  migrate?: () => T[];
}

/**
 * A browser-safe repository with the same async contract as the Firebase
 * implementation. It emits an initial snapshot immediately and then reacts
 * to cross-tab `storage` events as well as local writes.
 */
export class LocalStorageRepository<T extends BaseEntity>
  implements CollectionRepository<T>
{
  private readonly key: string;
  private readonly storage: StorageLike | null;
  private readonly normalize: (item: T) => T;
  private readonly listeners = new Set<RepositoryListener<T>>();
  private items: T[];

  constructor(options: LocalStorageRepositoryOptions<T>) {
    this.key = options.key;
    this.storage = options.storage === undefined ? getDefaultStorage() : options.storage;
    this.normalize = options.normalize ?? ((item) => item);
    const stored = parseStored<T>(readRaw(this.storage, options.key));
    this.items = stored.length
      ? stored.map((item) => this.normalize(cloneStored(item)))
      : (options.initial ?? []).map((item) => this.normalize(cloneStored(item)));
    if (options.migrate) {
      const migrated = options.migrate();
      this.items = mergeItems(this.items, migrated).map((item) => this.normalize(item));
      this.persist();
    }

    if (typeof window !== "undefined" && this.storage === getDefaultStorage()) {
      window.addEventListener("storage", this.handleStorageEvent);
    }
  }

  private readonly handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== this.key) return;
    this.items = parseStored<T>(event.newValue).map((item) => this.normalize(item));
    this.emit();
  };

  private persist(): void {
    writeRaw(this.storage, this.key, JSON.stringify(this.items));
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Observers should not prevent other tabs/components from receiving data.
      }
    }
  }

  private snapshot(): T[] {
    return sortEntities(this.items).map((item) => cloneStored(item));
  }

  async list(): Promise<T[]> {
    return this.snapshot();
  }

  async get(id: string): Promise<T | null> {
    const found = this.items.find((item) => item.id === id);
    return found ? cloneStored(found) : null;
  }

  async create(item: T): Promise<T> {
    return this.upsert(item);
  }

  async update(item: T): Promise<T> {
    return this.upsert(item);
  }

  /**
   * Places one item; the caller decides when to persist and notify. The scan
   * stays here rather than in a prebuilt index: the store can hold two rows
   * with one fingerprint, and an index keyed by fingerprint cannot say which
   * of them a write belongs to.
   */
  private apply(item: T, operation: string): { item: T; at: number } {
    const id = item.id?.trim();
    if (!id) {
      throw new RepositoryError("기록 식별자가 없습니다.", {
        code: "validation/missing-id",
        operation,
      });
    }
    const current = cloneStored(this.normalize({ ...item, id }));
    const existingIndex = this.items.findIndex((candidate) => candidate.id === id);
    const fingerprintIndex =
      existingIndex >= 0 || !current.fingerprint
        ? -1
        : this.items.findIndex((candidate) => candidate.fingerprint === current.fingerprint);
    const stored = this.items[existingIndex >= 0 ? existingIndex : fingerprintIndex];
    const updated: T = {
      ...current,
      // A record keeps the date it was first stored, the same way Firebase
      // reads it back off the existing document.
      createdAt: current.createdAt ?? stored?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    const at =
      existingIndex >= 0 ? existingIndex : fingerprintIndex >= 0 ? fingerprintIndex : this.items.length;
    this.items[at] = updated;
    return { item: updated, at };
  }

  /**
   * Replaces the stored item; see the Firebase repository for the same
   * contract. Callers spread the existing record in when they mean to keep it.
   */
  async upsert(item: T): Promise<T> {
    const previous = this.items;
    this.items = [...previous];
    let updated: T;
    try {
      updated = this.apply(item, "upsert").item;
      this.persist();
    } catch (error) {
      this.items = previous;
      throw error;
    }
    this.emit();
    return cloneStored(updated);
  }

  /**
   * Writes a whole batch behind a single persist and a single notification.
   * One at a time re-serialises the store and re-renders every subscriber per
   * record, so a large import spends most of its time on work it repeats.
   *
   * Items addressing the same row — same id, or same fingerprint — collapse to
   * the last one given, and the result holds the rows actually stored, ordered
   * by where they sit. Nothing is kept if the write fails.
   */
  async upsertMany(items: T[]): Promise<T[]> {
    if (!items.length) return [];
    for (const item of items) {
      if (!item.id?.trim()) {
        throw new RepositoryError("기록 식별자가 없습니다.", {
          code: "validation/missing-id",
          operation: "upsert-many",
        });
      }
    }
    const previous = this.items;
    this.items = [...previous];
    const written = new Map<number, T>();
    try {
      for (const item of items) {
        const { item: updated, at } = this.apply(item, "upsert-many");
        written.set(at, updated);
      }
      this.persist();
    } catch (error) {
      // A partly applied batch that never reached storage would resurrect on
      // the next successful write and vanish on a reload.
      this.items = previous;
      throw error;
    }
    // Past this point the store is written: failing here must not roll back.
    this.emit();
    return [...written.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => cloneStored(item));
  }

  async remove(id: string): Promise<void> {
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;
    const previous = this.items;
    this.items = next;
    try {
      this.persist();
    } catch (error) {
      this.items = previous;
      throw error;
    }
    this.emit();
  }

  async subscribe(
    onData: (items: T[]) => void,
    onError?: RepositoryErrorListener,
  ): Promise<Unsubscribe> {
    // One wrapper per call, so two subscriptions are two entries even when the
    // caller passes the same function twice — React setState keeps its identity
    // across renders, and a shared entry means one unsubscribe kills both.
    const listener: RepositoryListener<T> = (items) => onData(items);
    this.listeners.add(listener);
    try {
      onData(this.snapshot());
    } catch (error) {
      reportRepositoryError(
        onError,
        error,
        "저장된 기록을 표시하지 못했습니다.",
        { code: "observer/error", operation: "subscribe" },
      );
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Useful for tests and explicit cleanup in a long-lived shell. */
  dispose(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.handleStorageEvent);
    }
    this.listeners.clear();
  }
}

function transactionRepository(storage?: StorageLike | null): LocalStorageRepository<Transaction> {
  return new LocalStorageRepository<Transaction>({
    key: LOCAL_STORAGE_KEYS.transactions,
    storage,
    migrate: () => migrateLegacyTransactions(storage).transactions,
  });
}

export function createLocalRepositories(
  storage?: StorageLike | null,
): DomainRepositories {
  const transactions = transactionRepository(storage);
  const savingsAccounts = new LocalStorageRepository<SavingsAccount>({
    key: LOCAL_STORAGE_KEYS.savingsAccounts,
    storage,
  });
  const stockOrders = new LocalStorageRepository<StockOrder>({
    key: LOCAL_STORAGE_KEYS.stockOrders,
    storage,
  });
  const workItems = new LocalStorageRepository<WorkItem>({
    key: LOCAL_STORAGE_KEYS.workItems,
    storage,
  });
  const workCategories = new LocalStorageRepository<WorkCategoryRecord>({
    key: LOCAL_STORAGE_KEYS.workCategories,
    storage,
  });
  return {
    transactions,
    savingsAccounts,
    stockOrders,
    workItems,
    workCategories,
    savings: savingsAccounts,
    stocks: stockOrders,
    work: workItems,
  };
}

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

type RepositoryListener<T> = (items: T[]) => void;
