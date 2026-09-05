import { isFirebaseConfigured } from "./firebase";
import { createFirebaseRepositories } from "./firebase-repository";
import { createLocalRepositories, type StorageLike } from "./local-repository";
import type { DomainRepositories } from "./repository-types";

export type RepositoryMode = "local" | "firebase";

export interface DataRepositoriesOptions {
  mode?: RepositoryMode;
  storage?: StorageLike | null;
}

/** Selects one persistence backend while keeping the domain contract stable. */
export function createDataRepositories(
  options: DataRepositoriesOptions = {},
): DomainRepositories {
  const mode = options.mode ?? (isFirebaseConfigured ? "firebase" : "local");
  return mode === "firebase"
    ? createFirebaseRepositories()
    : createLocalRepositories(options.storage);
}

export {
  createLocalRepositories,
  migrateLegacyTransactions,
  readLegacyTransactions,
  LEGACY_TRANSACTION_STORAGE_KEY,
  LEGACY_MIGRATION_STORAGE_KEY,
  LOCAL_STORAGE_KEYS,
} from "./local-repository";
export {
  createFirebaseRepositories,
  FirebaseRepository,
  migrateLegacyTransactionsToFirebase,
} from "./firebase-repository";
export type {
  CollectionRepository,
  DomainRepositories,
  RepositoryErrorListener,
  Unsubscribe,
} from "./repository-types";
export { RepositoryError, getErrorMessage } from "./repository-types";
