import assert from "node:assert/strict";
import test from "node:test";

import { LocalStorageRepository, type StorageLike } from "./local-repository";
import type { Transaction } from "./domain";

function fakeStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function repository() {
  return new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: fakeStorage() });
}

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "transaction_1",
  type: "expense",
  category: "식비",
  amount: 12_000,
  memo: "점심",
  date: "2026-09-06",
  ...overrides,
});

test("upsert replaces the stored item rather than merging into it", async () => {
  const repositoryUnderTest = repository();
  await repositoryUnderTest.upsert(transaction({ fingerprint: "abc" }));
  const updated = await repositoryUnderTest.upsert(transaction({ memo: "저녁" }));
  assert.equal(updated.memo, "저녁");
  assert.equal(updated.fingerprint, undefined);
});

test("upsert keeps the date the record was first stored", async () => {
  const repositoryUnderTest = repository();
  const created = await repositoryUnderTest.upsert(transaction());
  const updated = await repositoryUnderTest.upsert(transaction({ memo: "저녁" }));
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.createdAt, undefined);
});

test("upsert matches an existing record by fingerprint when the id is new", async () => {
  const repositoryUnderTest = repository();
  const created = await repositoryUnderTest.upsert(transaction({ fingerprint: "abc" }));
  const updated = await repositoryUnderTest.upsert(
    transaction({ id: "transaction_2", fingerprint: "abc", memo: "저녁" }),
  );
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal((await repositoryUnderTest.list()).length, 1);
});

test("two subscriptions survive independently when they share a function", async () => {
  const repositoryUnderTest = repository();
  const received: Transaction[][] = [];
  const onData = (items: Transaction[]) => void received.push(items);

  // React mounts an effect twice in StrictMode and passes the same setState
  // function both times; the first mount's unsubscribe must not stop the second.
  const first = repositoryUnderTest.subscribe(onData);
  const second = repositoryUnderTest.subscribe(onData);
  (await first)();
  await second;

  const before = received.length;
  await repositoryUnderTest.upsert(transaction());
  assert.equal(received.length - before, 1);
});
