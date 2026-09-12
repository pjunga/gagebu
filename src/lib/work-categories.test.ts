import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRepositories, createMemoryStorage, LOCAL_STORAGE_KEYS, type StorageLike } from "./local-repository";
import { workCategoryName } from "./work-categories";

test("initialization keeps renamed/deleted defaults across repeated and concurrent clients", async () => {
  const storage = createMemoryStorage();
  const first = createLocalRepositories(storage);
  const second = createLocalRepositories(storage);
  await Promise.all([first.initializeWorkCategories(), second.initializeWorkCategories()]);
  assert.equal((await first.workCategories.list()).length, 4);
  await first.renameWorkCategory("category_seed_0", "새 이름");
  await first.workCategories.remove("category_seed_1");
  await second.initializeWorkCategories();
  const reloaded = createLocalRepositories(storage);
  await reloaded.initializeWorkCategories();
  assert.equal((await reloaded.workCategories.get("category_seed_0"))?.name, "새 이름");
  assert.equal(await reloaded.workCategories.get("category_seed_1"), null);
  assert.equal(workCategoryName({ category: "교수설계" }, await reloaded.workCategories.list()), "새 이름", "old imports follow the renamed default");
  assert.equal(workCategoryName({}, await reloaded.workCategories.list()), "새 이름", "old records without categories keep their link");
});

test("a category rename failure preserves visible names and a retry preserves legacy task fields", async () => {
  const memory = createMemoryStorage();
  let failingKey = "";
  const storage: StorageLike = { getItem: memory.getItem, removeItem: memory.removeItem, setItem(key, value) { if (key === failingKey) throw new Error("disk full"); memory.setItem(key, value); } };
  const repositories = createLocalRepositories(storage);
  await repositories.initializeWorkCategories();
  await repositories.workItems.upsert({ id: "work", title: "기존 작업", status: "done", amount: 0, memo: "메모", course: "기존 과목", workDate: "2025-12-31" });
  for (const key of [LOCAL_STORAGE_KEYS.workItems, LOCAL_STORAGE_KEYS.workCategories]) {
    failingKey = key;
    await assert.rejects(repositories.renameWorkCategory("category_seed_0", "바뀐 이름"));
    const task = (await repositories.workItems.get("work"))!;
    assert.equal(workCategoryName(task, await repositories.workCategories.list()), "교수설계");
  }
  failingKey = "";
  await repositories.renameWorkCategory("category_seed_0", "바뀐 이름");
  const task = (await repositories.workItems.get("work"))!;
  assert.equal(workCategoryName(task, await repositories.workCategories.list()), "바뀐 이름");
  assert.equal(task.course, "기존 과목"); assert.equal(task.amount, 0); assert.equal(task.status, "done");
  await repositories.renameWorkCategory("category_seed_0", "다시 변경");
  assert.equal(workCategoryName(task, await repositories.workCategories.list()), "다시 변경");
});
