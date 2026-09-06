import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import {
  auth,
  db,
  isAllowedFirebaseUser,
  isFirebaseConfigured,
} from "./firebase";
import {
  ENTITY_COLLECTIONS,
  type BaseEntity,
  type EntityByKind,
  type EntityKind,
  type Transaction,
} from "./domain";
import {
  LEGACY_MIGRATION_STORAGE_KEY,
  readLegacyTransactions,
  type StorageLike,
} from "./local-repository";
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

export /** Firestore caps a batch at 500 writes; the migration path uses the same size. */
const FIREBASE_BATCH_SIZE = 400;

const FIREBASE_MIGRATION_STORAGE_KEY =
  "gagebu:firebase-migration-complete";

function ensureFirebase(): NonNullable<typeof db> {
  if (!isFirebaseConfigured || !db || !auth) {
    throw new RepositoryError("Firebase 환경변수가 설정되지 않았습니다.", {
      code: "firebase/not-configured",
      operation: "initialize",
    });
  }
  return db;
}

async function getUserId(): Promise<string> {
  ensureFirebase();
  if (!auth) {
    throw new RepositoryError("Firebase 인증을 초기화하지 못했습니다.", {
      code: "firebase/auth-unavailable",
      operation: "authenticate",
    });
  }
  if (typeof window === "undefined") {
    throw new RepositoryError("Firebase 저장소는 브라우저에서만 사용할 수 있습니다.", {
      code: "firebase/browser-required",
      operation: "authenticate",
    });
  }
  const user = auth.currentUser;
  if (!user || !isAllowedFirebaseUser(user)) {
    throw new RepositoryError("허용된 Google 계정으로 로그인해주세요.", {
      code: "firebase/auth-required",
      operation: "authenticate",
    });
  }
  return user.uid;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  // Firebase sentinels and Timestamp/Date instances must pass through intact.
  if (value instanceof Date) return value;
  if ("_methodName" in value || "toDate" in value) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = removeUndefined(child);
  }
  return result;
}

function normalizeFirestoreValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeFirestoreValue(child);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function mapDocument<T extends BaseEntity>(id: string, data: DocumentData): T {
  return {
    ...(normalizeFirestoreValue(data) as Omit<T, "id">),
    id,
  } as T;
}

export interface FirebaseRepositoryOptions<T extends BaseEntity> {
  kind: EntityKind;
  collectionName?: string;
  normalize?: (item: T) => T;
}

export class FirebaseRepository<T extends BaseEntity>
  implements CollectionRepository<T>
{
  private readonly kind: EntityKind;
  private readonly collectionName: string;
  private readonly normalize: (item: T) => T;

  constructor(options: FirebaseRepositoryOptions<T>) {
    this.kind = options.kind;
    this.collectionName =
      options.collectionName ?? ENTITY_COLLECTIONS[options.kind];
    this.normalize = options.normalize ?? ((item) => item);
  }

  private async collectionForUser() {
    const firestore = ensureFirebase();
    const userId = await getUserId();
    return collection(firestore, "users", userId, this.collectionName);
  }

  async list(): Promise<T[]> {
    try {
      const target = await this.collectionForUser();
      const snapshot = await getDocs(query(target));
      return sortEntities(
        snapshot.docs.map((item) => this.normalize(mapDocument<T>(item.id, item.data()))),
      );
    } catch (error) {
      throw new RepositoryError("Firebase에서 기록을 불러오지 못했습니다.", {
        code: "firebase/read-failed",
        operation: "list",
        cause: error,
      });
    }
  }

  async get(id: string): Promise<T | null> {
    if (!id.trim()) return null;
    try {
      const target = await this.collectionForUser();
      const snapshot = await getDoc(doc(target, id));
      return snapshot.exists()
        ? this.normalize(mapDocument<T>(snapshot.id, snapshot.data()))
        : null;
    } catch (error) {
      throw new RepositoryError("Firebase에서 기록을 불러오지 못했습니다.", {
        code: "firebase/read-failed",
        operation: "get",
        cause: error,
      });
    }
  }

  async create(item: T): Promise<T> {
    return this.upsert(item);
  }

  async update(item: T): Promise<T> {
    return this.upsert(item);
  }

  /**
   * Replaces the stored document, like the local repository does. Merging
   * instead would make a field impossible to clear: the caller passes the whole
   * record, so a field it leaves out is a field it means to drop.
   */
  async upsert(item: T): Promise<T> {
    const id = item.id?.trim();
    if (!id) {
      throw new RepositoryError("기록 식별자가 없습니다.", {
        code: "validation/missing-id",
        operation: "upsert",
      });
    }
    try {
      const target = await this.collectionForUser();
      const existing = await getDoc(doc(target, id));
      const current = this.normalize({ ...item, id });
      const storedCreatedAt = existing.data()?.createdAt;
      const payload = removeUndefined({
        ...current,
        createdAt: current.createdAt ?? storedCreatedAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      }) as DocumentData;
      await setDoc(doc(target, id), payload);
      const createdAt = current.createdAt ?? normalizeFirestoreValue(storedCreatedAt);
      return {
        ...current,
        // Report the date that was actually written, not today's.
        createdAt: typeof createdAt === "string" ? createdAt : nowIso(),
        updatedAt: nowIso(),
      };
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError("Firebase에 기록을 저장하지 못했습니다.", {
        code: "firebase/write-failed",
        operation: "upsert",
        cause: error,
      });
    }
  }

  /**
   * Writes a whole batch in as few round trips as Firestore allows. Stored
   * createdAt values are read once for the batch rather than per document.
   */
  async upsertMany(items: T[]): Promise<T[]> {
    if (!items.length) return [];
    for (const item of items) {
      if (!item.id?.trim()) {
        throw new RepositoryError("기록 식별자가 없습니다.", {
          code: "validation/missing-id",
          operation: "upsert",
        });
      }
    }
    try {
      const firestore = ensureFirebase();
      const target = await this.collectionForUser();
      const snapshot = await getDocs(query(target));
      const storedCreatedAt = new Map(snapshot.docs.map((entry) => [entry.id, entry.data().createdAt]));
      const written: T[] = [];
      for (let offset = 0; offset < items.length; offset += FIREBASE_BATCH_SIZE) {
        const chunk = items.slice(offset, offset + FIREBASE_BATCH_SIZE);
        const batch = writeBatch(firestore);
        for (const item of chunk) {
          const id = item.id.trim();
          const current = this.normalize({ ...item, id });
          const existing = storedCreatedAt.get(id);
          batch.set(
            doc(target, id),
            removeUndefined({
              ...current,
              createdAt: current.createdAt ?? existing ?? serverTimestamp(),
              updatedAt: serverTimestamp(),
            }) as DocumentData,
          );
          const createdAt = current.createdAt ?? normalizeFirestoreValue(existing);
          written.push({
            ...current,
            createdAt: typeof createdAt === "string" ? createdAt : nowIso(),
            updatedAt: nowIso(),
          });
        }
        await batch.commit();
      }
      return written;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError("Firebase에 기록을 저장하지 못했습니다.", {
        code: "firebase/write-failed",
        operation: "upsert",
        cause: error,
      });
    }
  }

  async remove(id: string): Promise<void> {
    if (!id.trim()) return;
    try {
      const target = await this.collectionForUser();
      await deleteDoc(doc(target, id));
    } catch (error) {
      throw new RepositoryError("Firebase에서 기록을 삭제하지 못했습니다.", {
        code: "firebase/delete-failed",
        operation: "delete",
        cause: error,
      });
    }
  }

  async subscribe(
    onData: (items: T[]) => void,
    onError?: RepositoryErrorListener,
  ): Promise<Unsubscribe> {
    try {
      if (this.kind === "transaction") {
        try {
          await migrateLegacyTransactionsToFirebase();
        } catch (error) {
          // Legacy migration should not prevent a user from seeing already
          // synced records. Surface the issue while still opening the stream.
          reportRepositoryError(
            onError,
            error,
            "기존 거래를 Firebase로 옮기지 못했습니다.",
            { code: "firebase/migration-failed", operation: "migrate" },
          );
        }
      }
      const target = await this.collectionForUser();
      const stop = onSnapshot(
        query(target),
        (snapshot) => {
          try {
            onData(
              sortEntities(
                snapshot.docs.map((item) =>
                  this.normalize(mapDocument<T>(item.id, item.data())),
                ),
              ),
            );
          } catch (error) {
            reportRepositoryError(
              onError,
              error,
              "Firebase 기록을 표시하지 못했습니다.",
              { code: "firebase/parse-failed", operation: "subscribe" },
            );
          }
        },
        (error) => {
          reportRepositoryError(
            onError,
            error,
            "Firebase에서 기록을 실시간으로 불러오지 못했습니다.",
            { code: "firebase/subscribe-failed", operation: "subscribe" },
          );
        },
      );
      return stop;
    } catch (error) {
      const normalized = reportRepositoryError(
        onError,
        error,
        "Firebase 연결에 실패했습니다. 설정값과 콘솔 설정을 확인해주세요.",
        { code: "firebase/subscribe-failed", operation: "subscribe" },
      );
      // Keep the subscription contract total: consumers can always clean up.
      void normalized;
      return () => undefined;
    }
  }
}

function storageGet(storage: StorageLike | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageSet(storage: StorageLike | null | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // A migration marker is an optimization only; failed writes must not make
    // an otherwise successful Firebase import fail.
  }
}

function firebaseMigrationKey(userId: string): string {
  return `${FIREBASE_MIGRATION_STORAGE_KEY}:v2:${userId}`;
}

export interface FirebaseMigrationResult {
  migrated: boolean;
  uploaded: number;
  skipped: number;
}

/**
 * Uploads only local records that are absent remotely. Existing remote docs
 * win on ID/fingerprint collisions, so rerunning this cannot overwrite a
 * user's Firebase edits or create duplicate imports.
 */
export async function migrateLegacyTransactionsToFirebase(
  localTransactions: Transaction[] = [],
  storage?: StorageLike | null,
): Promise<FirebaseMigrationResult> {
  const firestore = ensureFirebase();
  const userId = await getUserId();
  const markerStorage = storage === undefined ? defaultStorage() : storage;
  const candidates = localTransactions.length
    ? localTransactions
    : readLegacyTransactions(markerStorage);
  if (!candidates.length) {
    storageSet(markerStorage, firebaseMigrationKey(userId), "true");
    storageSet(markerStorage, LEGACY_MIGRATION_STORAGE_KEY, "true");
    return { migrated: true, uploaded: 0, skipped: 0 };
  }

  const target = collection(firestore, "users", userId, ENTITY_COLLECTIONS.transaction);
  const remote = await getDocs(query(target));
  const remoteIds = new Set(remote.docs.map((item) => item.id));
  const remoteFingerprints = new Set(
    remote.docs
      .map((item) => item.data().fingerprint)
      .filter((value): value is string => typeof value === "string" && Boolean(value)),
  );
  const pending = candidates.filter((item) => {
    if (remoteIds.has(item.id)) return false;
    if (!item.fingerprint) return true;
    return !remoteFingerprints.has(item.fingerprint);
  });
  let uploaded = 0;
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = writeBatch(firestore);
    for (const item of pending.slice(offset, offset + 400)) {
      const reference = doc(target, item.id);
      batch.set(
        reference,
        removeUndefined({
          ...item,
          source: item.source ?? "legacy",
          createdAt: item.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as DocumentData,
        { merge: true },
      );
    }
    if (pending.length) {
      await batch.commit();
      uploaded += Math.min(400, pending.length - offset);
    }
  }
  storageSet(markerStorage, firebaseMigrationKey(userId), "true");
  storageSet(markerStorage, LEGACY_MIGRATION_STORAGE_KEY, "true");
  return {
    migrated: true,
    uploaded,
    skipped: candidates.length - uploaded,
  };
}

export function createFirebaseRepositories(): DomainRepositories {
  const transactions = new FirebaseRepository<EntityByKind["transaction"]>({
    kind: "transaction",
  });
  const savingsAccounts = new FirebaseRepository<EntityByKind["savingsAccount"]>({
    kind: "savingsAccount",
  });
  const stockOrders = new FirebaseRepository<EntityByKind["stockOrder"]>({
    kind: "stockOrder",
  });
  const workItems = new FirebaseRepository<EntityByKind["workItem"]>({
    kind: "workItem",
  });
  return {
    transactions,
    savingsAccounts,
    stockOrders,
    workItems,
    savings: savingsAccounts,
    stocks: stockOrders,
    work: workItems,
  };
}

export function getFirebaseMigrationMarker(
  storage: StorageLike | null | undefined,
  userId: string,
): boolean {
  return storageGet(storage, firebaseMigrationKey(userId)) === "true";
}
