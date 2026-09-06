import type {
  BaseEntity,
  DomainEntity,
  EntityByKind,
  EntityKind,
} from "./domain";

export type Unsubscribe = () => void;

export type RepositoryListener<T> = (items: T[]) => void;

export type RepositoryErrorListener = (error: RepositoryError) => void;

/** A user-safe error that still retains the original cause for diagnostics. */
export class RepositoryError extends Error {
  readonly code: string;
  readonly operation?: string;
  readonly cause?: unknown;
  /** Records already written when a partly applied batch failed. */
  readonly alreadySaved?: number;

  constructor(
    message: string,
    options: { code?: string; operation?: string; cause?: unknown; alreadySaved?: number } = {},
  ) {
    super(message);
    this.name = "RepositoryError";
    this.code = options.code ?? "repository/error";
    this.operation = options.operation;
    this.cause = options.cause;
    this.alreadySaved = options.alreadySaved;
  }
}

export interface CollectionRepository<T extends BaseEntity> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(item: T): Promise<T>;
  update(item: T): Promise<T>;
  upsert(item: T): Promise<T>;
  /**
   * Applies several writes with one persist and one notification. The result
   * holds the rows that were stored, in no guaranteed order.
   */
  upsertMany(items: T[]): Promise<T[]>;
  remove(id: string): Promise<void>;
  subscribe(
    onData: RepositoryListener<T>,
    onError?: RepositoryErrorListener,
  ): Promise<Unsubscribe>;
}

export interface DomainRepositories {
  transactions: CollectionRepository<EntityByKind["transaction"]>;
  savingsAccounts: CollectionRepository<EntityByKind["savingsAccount"]>;
  stockOrders: CollectionRepository<EntityByKind["stockOrder"]>;
  workItems: CollectionRepository<EntityByKind["workItem"]>;
  /** Short aliases for consumers that use the domain noun rather than the collection name. */
  savings: CollectionRepository<EntityByKind["savingsAccount"]>;
  stocks: CollectionRepository<EntityByKind["stockOrder"]>;
  work: CollectionRepository<EntityByKind["workItem"]>;
}

export type RepositoryForKind<K extends EntityKind> = CollectionRepository<
  EntityByKind[K]
>;

export function toRepositoryError(
  error: unknown,
  fallbackMessage: string,
  options: { code?: string; operation?: string } = {},
): RepositoryError {
  if (error instanceof RepositoryError) return error;
  return new RepositoryError(fallbackMessage, {
    ...options,
    cause: error,
  });
}

export function getErrorMessage(
  error: unknown,
  fallbackMessage = "작업을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
): string {
  return error instanceof RepositoryError || error instanceof Error
    ? error.message || fallbackMessage
    : fallbackMessage;
}

export function reportRepositoryError(
  onError: RepositoryErrorListener | undefined,
  error: unknown,
  fallbackMessage: string,
  options: { code?: string; operation?: string } = {},
): RepositoryError {
  const normalized = toRepositoryError(error, fallbackMessage, options);
  try {
    onError?.(normalized);
  } catch {
    // A consumer's error renderer must not break repository cleanup.
  }
  return normalized;
}

export function cloneEntity<T extends DomainEntity>(item: T): T {
  // structuredClone is unavailable in a few supported browsers; JSON is safe
  // here because our persisted domain model contains JSON-compatible values.
  try {
    return structuredClone(item);
  } catch {
    return JSON.parse(JSON.stringify(item)) as T;
  }
}

export function sortEntities<T extends BaseEntity>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftDate = entitySortDate(left);
    const rightDate = entitySortDate(right);
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return left.id.localeCompare(right.id);
  });
}

function entitySortDate(item: BaseEntity): string {
  const candidate = item as BaseEntity & {
    date?: string;
    orderDate?: string;
    dueDate?: string;
  };
  return (
    candidate.date ??
    candidate.orderDate ??
    candidate.dueDate ??
    item.updatedAt ??
    item.createdAt ??
    ""
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}
