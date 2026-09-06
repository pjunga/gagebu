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

test("upsertMany writes the batch behind one notification", async () => {
  const repositoryUnderTest = repository();
  const batches: number[] = [];
  await repositoryUnderTest.subscribe((items) => void batches.push(items.length));

  const before = batches.length;
  const written = await repositoryUnderTest.upsertMany([
    transaction({ id: "t1", fingerprint: "a" }),
    transaction({ id: "t2", fingerprint: "b" }),
    transaction({ id: "t3", fingerprint: "c" }),
  ]);

  assert.equal(written.length, 3);
  assert.equal((await repositoryUnderTest.list()).length, 3);
  // One notification for the batch, not one per record.
  assert.equal(batches.length - before, 1);
  assert.equal(batches.at(-1), 3);
});

test("upsertMany keeps the placement rules of a single upsert", async () => {
  const repositoryUnderTest = repository();
  const created = await repositoryUnderTest.upsert(transaction({ id: "t1", fingerprint: "a" }));
  await repositoryUnderTest.upsertMany([
    transaction({ id: "t9", fingerprint: "a", memo: "저녁" }),
    transaction({ id: "t2", fingerprint: "b" }),
  ]);

  const stored = await repositoryUnderTest.list();
  assert.equal(stored.length, 2);
  const matched = stored.find((item) => item.fingerprint === "a");
  assert.equal(matched?.memo, "저녁");
  assert.equal(matched?.createdAt, created.createdAt);
});

test("upsertMany persists once for the whole batch", async () => {
  let writes = 0;
  const storage = fakeStorage();
  const counting: StorageLike = { ...storage, setItem: (key, value) => { writes += 1; storage.setItem(key, value); } };
  const repositoryUnderTest = new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: counting });

  await repositoryUnderTest.upsertMany([
    transaction({ id: "t1" }),
    transaction({ id: "t2" }),
    transaction({ id: "t3" }),
  ]);

  assert.equal(writes, 1);
});

test("upsertMany collapses items that address the same row", async () => {
  const repositoryUnderTest = repository();
  const written = await repositoryUnderTest.upsertMany([
    transaction({ id: "t1", memo: "점심" }),
    transaction({ id: "t1", memo: "저녁" }),
    transaction({ id: "t2", fingerprint: "a" }),
    transaction({ id: "t3", fingerprint: "a", memo: "덮어씀" }),
  ]);

  const stored = await repositoryUnderTest.list();
  assert.equal(stored.length, 2);
  assert.equal(written.length, 2);
  assert.equal(stored.find((item) => item.id === "t1")?.memo, "저녁");
  assert.equal(stored.find((item) => item.fingerprint === "a")?.memo, "덮어씀");
});

test("upsertMany keeps nothing when the store cannot be written", async () => {
  const storage = fakeStorage();
  const failing: StorageLike = {
    ...storage,
    setItem: (key, value) => {
      if (value.includes("붙지 않아야 함")) throw new Error("quota");
      storage.setItem(key, value);
    },
  };
  const repositoryUnderTest = new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: failing });
  await repositoryUnderTest.upsert(transaction({ id: "t1" }));

  await assert.rejects(() =>
    repositoryUnderTest.upsertMany([transaction({ id: "t2", memo: "붙지 않아야 함" })]),
  );
  const stored = await repositoryUnderTest.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, "t1");
});

test("upsertMany rejects a batch with a missing id before writing any of it", async () => {
  const repositoryUnderTest = repository();
  await assert.rejects(
    () => repositoryUnderTest.upsertMany([transaction({ id: "t1" }), transaction({ id: " " })]),
    /기록 식별자가 없습니다/,
  );
  assert.equal((await repositoryUnderTest.list()).length, 0);
});

test("upsertMany on an empty batch touches nothing", async () => {
  let writes = 0;
  const storage = fakeStorage();
  const counting: StorageLike = { ...storage, setItem: (key, value) => { writes += 1; storage.setItem(key, value); } };
  const repositoryUnderTest = new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: counting });
  let notifications = 0;
  await repositoryUnderTest.subscribe(() => { notifications += 1; });

  assert.deepEqual(await repositoryUnderTest.upsertMany([]), []);
  assert.equal(writes, 0);
  assert.equal(notifications, 1); // only the immediate one from subscribe
});

test("upsertMany keeps a row whose fingerprint match is later addressed by id", async () => {
  const repositoryUnderTest = repository();
  await repositoryUnderTest.upsert(transaction({ id: "old", fingerprint: "f" }));

  await repositoryUnderTest.upsertMany([
    transaction({ id: "new", fingerprint: "f", memo: "새 행" }),
    transaction({ id: "old", fingerprint: "g", memo: "다른 행" }),
  ]);

  const stored = await repositoryUnderTest.list();
  assert.deepEqual(
    stored.map((item) => [item.id, item.fingerprint, item.memo]).sort(),
    [["new", "f", "새 행"], ["old", "g", "다른 행"]].sort(),
  );
});

test("upsertMany keeps a row whose id match is later addressed by fingerprint", async () => {
  const repositoryUnderTest = repository();
  await repositoryUnderTest.upsert(transaction({ id: "a", fingerprint: "f1" }));

  await repositoryUnderTest.upsertMany([
    transaction({ id: "a", fingerprint: "f2", memo: "갱신" }),
    transaction({ id: "b", fingerprint: "f1", memo: "다른 행" }),
  ]);

  const stored = await repositoryUnderTest.list();
  assert.deepEqual(
    stored.map((item) => [item.id, item.fingerprint, item.memo]).sort(),
    [["a", "f2", "갱신"], ["b", "f1", "다른 행"]].sort(),
  );
});

test("a failed write leaves nothing behind for the next reader", async () => {
  const storage = fakeStorage();
  const failing: StorageLike = {
    ...storage,
    setItem: (key, value) => {
      if (value.includes("붙지 않아야 함")) throw new Error("quota");
      storage.setItem(key, value);
    },
  };
  const repositoryUnderTest = new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: failing });
  await repositoryUnderTest.upsert(transaction({ id: "t1" }));
  await assert.rejects(() => repositoryUnderTest.upsertMany([transaction({ id: "t2", memo: "붙지 않아야 함" })]));

  // A repository with no storage falls back to the in-process copy; the
  // rejected batch must not be waiting for it there.
  const fallback = new LocalStorageRepository<Transaction>({ key: "test:transactions", storage: null });
  assert.deepEqual((await fallback.list()).map((item) => item.id), ["t1"]);
});
