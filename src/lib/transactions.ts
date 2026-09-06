import { isFirebaseConfigured } from "./firebase";
import {
  createFirebaseRepositories,
  migrateLegacyTransactionsToFirebase,
} from "./firebase-repository";
import { createLocalRepositories } from "./local-repository";
import { getErrorMessage, type Unsubscribe } from "./repository-types";
import type { Transaction } from "./domain";

export type { Transaction } from "./domain";

let localTransactions: ReturnType<typeof createLocalRepositories>["transactions"];
let firebaseTransactions: ReturnType<typeof createFirebaseRepositories>["transactions"];

function getLocalTransactions() {
  localTransactions ??= createLocalRepositories().transactions;
  return localTransactions;
}

function getFirebaseTransactions() {
  firebaseTransactions ??= createFirebaseRepositories().transactions;
  return firebaseTransactions;
}

/**
 * Legacy adapter retained for the original single-page UI. New code should
 * use `createLocalRepositories`/`createFirebaseRepositories` directly.
 */
export async function subscribeToTransactions(
  localItems: Transaction[],
  onData: (transactions: Transaction[]) => void,
  onError: (message: string) => void,
): Promise<Unsubscribe> {
  if (!isFirebaseConfigured) {
    const repository = getLocalTransactions();
    try {
      await repository.upsertMany(localItems);
    } catch (error) {
      // Seeding is best effort: report it and still open the stream, the same
      // way the Firebase branch below does.
      onError(error instanceof Error ? error.message : "기존 거래를 저장하지 못했습니다.");
    }
    return repository.subscribe(onData, (error) => onError(error.message));
  }

  try {
    await migrateLegacyTransactionsToFirebase(localItems);
  } catch (error) {
    onError(getErrorMessage(error, "Firebase 연결에 실패했습니다."));
  }
  return getFirebaseTransactions().subscribe(onData, (error) =>
    onError(error.message),
  );
}

export async function saveTransaction(
  transaction: Transaction,
): Promise<Transaction> {
  return (
    isFirebaseConfigured ? getFirebaseTransactions() : getLocalTransactions()
  ).upsert(transaction);
}

export async function removeTransaction(id: string): Promise<void> {
  return (
    isFirebaseConfigured ? getFirebaseTransactions() : getLocalTransactions()
  ).remove(id);
}
