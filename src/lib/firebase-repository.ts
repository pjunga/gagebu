import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
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

/** Firestore caps a batch at 500 writes. */
const FIREBASE_BATCH_SIZE = 400;

/** Firestore allows at most 30 values in an `in` filter. */
const DOCUMENT_ID_QUERY_LIMIT = 30;

/** How many id lookups run at once while preparing a batch. */
const CONCURRENT_READS = 8;

/** Firestore codes that reject the request itself, whatever it carried. */
function appliesToEveryWrite(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "permission-denied" || code === "unauthenticated" || code === "unavailable";
}

export const FIREBASE_MIGRATION_STORAGE_KEY =
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
          operation: "upsert-many",
        });
      }
    }
    // Two items for one document id collapse to the last one, so a batch never
    // queues the same reference twice. The local repository also folds items
    // that land on the same row by fingerprint; ids are all Firestore has.
    const unique = [...new Map(items.map((item) => [item.id.trim(), item])).values()];
    const written: T[] = [];
    const rejected: string[] = [];
    let committed = 0;
    let failure: unknown = null;
    try {
      const firestore = ensureFirebase();
      const target = await this.collectionForUser();
      // Normalise once: the creation dates are looked up for exactly the
      // documents that are about to be written.
      const prepared = unique.map((item) => {
        const id = item.id.trim();
        return { id, current: this.normalize({ ...item, id }) };
      });
      const storedCreatedAt = await this.createdAtFor(target, prepared);
      const payloadFor = ({ id, current }: (typeof prepared)[number]) => {
        const existing = storedCreatedAt.get(id);
        const createdAt = current.createdAt ?? normalizeFirestoreValue(existing);
        return {
          data: removeUndefined({
            ...current,
            createdAt: current.createdAt ?? existing ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          }) as DocumentData,
          stored: {
            ...current,
            createdAt: typeof createdAt === "string" ? createdAt : nowIso(),
            updatedAt: nowIso(),
          },
        };
      };
      for (let offset = 0; offset < prepared.length; offset += FIREBASE_BATCH_SIZE) {
        const chunk = prepared.slice(offset, offset + FIREBASE_BATCH_SIZE);
        const batch = writeBatch(firestore);
        const payloads = chunk.map(payloadFor);
        payloads.forEach((payload, at) => batch.set(doc(target, chunk[at].id), payload.data));
        try {
          await batch.commit();
          committed += chunk.length;
          written.push(...payloads.map((payload) => payload.stored));
        } catch (error) {
          failure ??= error;
          // Sign-in and rule failures apply to the whole request, so retrying
          // document by document would just repeat them a few hundred times.
          if (appliesToEveryWrite(error)) throw error;
          // Otherwise the batch is atomic and one document the rules reject
          // takes the other 399 with it. Write them singly to keep the good
          // rows, a wave at a time so a long chunk does not block the tab.
          let refusedHere = 0;
          for (let at = 0; at < payloads.length; at += CONCURRENT_READS) {
            const wave = payloads.slice(at, at + CONCURRENT_READS);
            const outcomes = await Promise.all(
              wave.map(async (payload, offsetInWave) => {
                const id = chunk[at + offsetInWave].id;
                try {
                  await setDoc(doc(target, id), payload.data);
                  return { stored: payload.stored, id: undefined };
                } catch {
                  return { stored: undefined, id };
                }
              }),
            );
            for (const outcome of outcomes) {
              if (outcome.stored) {
                committed += 1;
                written.push(outcome.stored);
              } else if (outcome.id) {
                refusedHere += 1;
                rejected.push(outcome.id);
              }
            }
          }
          // Every document refused means the cause was not this chunk's data.
          if (refusedHere === payloads.length) throw error;
        }
      }
      if (rejected.length) {
        throw new RepositoryError(
          `${rejected.length}건을 Firebase가 거부했습니다. (${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? " 외" : ""})`,
          { code: "firebase/write-rejected", operation: "upsert-many", cause: failure, alreadySaved: committed },
        );
      }
      return written;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      // Earlier chunks are already in Firestore; the caller adds them to its own
      // tally so the user is told once how much of the import landed.
      throw new RepositoryError("Firebase에 기록을 저장하지 못했습니다.", {
        code: "firebase/write-failed",
        operation: "upsert-many",
        cause: error,
        alreadySaved: committed,
      });
    }
  }

  /**
   * Stored creation dates for the documents about to be written. Reading them
   * by id costs one query per 30 documents and never depends on how large the
   * collection has grown.
   */
  private async createdAtFor(
    target: Awaited<ReturnType<FirebaseRepository<T>["collectionForUser"]>>,
    items: { id: string; current: T }[],
  ): Promise<Map<string, unknown>> {
    const ids = items.filter((item) => !item.current.createdAt).map((item) => item.id);
    const chunks: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += DOCUMENT_ID_QUERY_LIMIT) {
      chunks.push(ids.slice(offset, offset + DOCUMENT_ID_QUERY_LIMIT));
    }
    const stored = new Map<string, unknown>();
    // A large import would otherwise open hundreds of queries at once and trip
    // the burst quota before a single record is written.
    for (let offset = 0; offset < chunks.length; offset += CONCURRENT_READS) {
      const snapshots = await Promise.all(
        chunks
          .slice(offset, offset + CONCURRENT_READS)
          .map((chunk) => getDocs(query(target, where(documentId(), "in", chunk)))),
      );
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) stored.set(entry.id, entry.data().createdAt);
      }
    }
    return stored;
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
  for (let offset = 0; offset < pending.length; offset += FIREBASE_BATCH_SIZE) {
    const batch = writeBatch(firestore);
    for (const item of pending.slice(offset, offset + FIREBASE_BATCH_SIZE)) {
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
      uploaded += Math.min(FIREBASE_BATCH_SIZE, pending.length - offset);
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
