import assert from "node:assert/strict";
import test from "node:test";
import { backupCollections, exportBackup, parseBackup, previewBackup, readBackupData, restoreBackup, type Backup } from "./backup";
import { buildDemoData } from "./demo-data";
import { createLocalRepositories, createMemoryStorage, LOCAL_STORAGE_KEYS, type StorageLike } from "./local-repository";
import { defaultWorkCategories } from "./work-categories";

const backup = (): Backup => ({ format: "gagebu", version: 1, exportedAt: "2026-09-12T00:00:00.000Z", data: { ...buildDemoData("2026-09-12"), workCategories: defaultWorkCategories() } });

test("all five collections round-trip without changing fields; repeats preserve current edits", async () => {
  const original = parseBackup(JSON.stringify(backup()));
  const memory = createMemoryStorage();
  const repositories = createLocalRepositories(memory);
  const empty = await readBackupData(repositories);
  assert.equal(previewBackup(original, empty).reduce((sum, row) => sum + row.added, 0), backupCollections.reduce((sum, key) => sum + original.data[key].length, 0));
  const result = await restoreBackup(original, repositories);
  assert(result.added > 0); assert.equal(result.skipped, 0);
  const exported = await exportBackup(createLocalRepositories(memory));
  for (const key of backupCollections) assert.deepEqual([...exported.data[key]].sort((a, b) => a.id.localeCompare(b.id)), [...original.data[key]].sort((a, b) => a.id.localeCompare(b.id)));
  const task = original.data.workItems[0];
  await repositories.workItems.upsert({ ...task, title: "복원 후 수정한 제목" });
  assert.equal((await restoreBackup(original, repositories)).added, 0);
  assert.equal((await repositories.workItems.get(task.id))?.title, "복원 후 수정한 제목");
});

test("invalid backups are rejected before any write", async () => {
  const repositories = createLocalRepositories(createMemoryStorage());
  for (const mutate of [
    (value: Backup) => { value.data.transactions[0].amount = -1; },
    (value: Backup) => { value.data.workItems[0].id = "invalid/path"; },
    (value: Backup) => { value.data.stockOrders.push(value.data.stockOrders[0]); },
    (value: Backup) => { value.data.savingsAccounts[0].closedAt = "2026-02-30"; },
    (value: Backup) => { (value.data.savingsAccounts[0] as unknown as Record<string, unknown>).unknown = true; },
  ]) {
    const invalid = backup(); mutate(invalid);
    assert.throws(() => parseBackup(JSON.stringify(invalid)));
    await assert.rejects(restoreBackup(invalid, repositories));
  }
  assert.throws(() => parseBackup('{"format":"gagebu","version":2}'));
  assert.throws(() => parseBackup("invalid JSON"));
  for (const records of Object.values(await readBackupData(repositories))) assert.deepEqual(records, []);
});

test("a partial restore reports saved rows and retries without duplicates or overwrites", async () => {
  const memory = createMemoryStorage();
  let fail = true;
  const storage: StorageLike = { getItem: memory.getItem, removeItem: memory.removeItem, setItem(key, value) { if (fail && key === LOCAL_STORAGE_KEYS.stockOrders) throw new Error("quota"); memory.setItem(key, value); } };
  const repositories = createLocalRepositories(storage);
  const original = backup();
  await assert.rejects(restoreBackup(original, repositories), /건은 추가되었습니다/);
  const preview = previewBackup(original, await readBackupData(repositories));
  assert(preview.some(row => row.skipped > 0));
  assert(preview.some(row => row.added > 0));
  fail = false;
  const result = await restoreBackup(original, repositories);
  assert.equal(result.added, preview.reduce((sum, row) => sum + row.added, 0));
  assert.equal((await restoreBackup(original, repositories)).added, 0);
});
