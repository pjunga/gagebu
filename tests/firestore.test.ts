import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { createFirebaseRepositories } from "../src/lib/firebase-repository";
import { workCategoryName } from "../src/lib/work-categories";
import { backupCollections, exportBackup, parseBackup, restoreBackup } from "../src/lib/backup";
import { createDemoRepositories } from "../src/lib/demo-data";

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8180", "Run through the isolated Firebase emulator (pnpm test:firestore).");
let environment: RulesTestEnvironment;
before(async () => { environment = await initializeTestEnvironment({ projectId: "demo-gagebu", firestore: { host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8") } }); });
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });
const database = (uid = "owner", email = "pjunga0730@gmail.com", emailVerified = true) => environment.authenticatedContext(uid, { email, email_verified: emailVerified, firebase: { sign_in_provider: "google.com" } }).firestore() as unknown as Firestore;
const repositories = (db = database(), userId = "owner") => createFirebaseRepositories({ firestore: db, userId });

test("expense fields, zero balance and closing/reopening round-trip under real rules", async () => {
  const repository = repositories();
  await repository.transactions.upsert({ id: "expense", type: "expense", category: "식비", amount: 12000, memo: "점심", date: "2026-09-01", expenseDetails: { paymentMethod: "카드", merchant: "상점", note: "메모" } });
  assert.deepEqual((await repository.transactions.get("expense"))?.expenseDetails, { paymentMethod: "카드", merchant: "상점", note: "메모" });
  const account = { id: "saving", institution: "은행", accountName: "예금", balance: 0, principal: 1000000, closedAt: "2026-09-01" };
  await repository.savingsAccounts.upsert(account);
  assert.equal((await repository.savingsAccounts.get(account.id))?.balance, 0);
  await repository.savingsAccounts.upsert({ ...account, closedAt: undefined });
  assert.equal((await repository.savingsAccounts.get(account.id))?.closedAt, undefined);
  for (const closedAt of ["invalid", "2026-13-01", "2026-02-30", "2025-02-29"]) await assert.rejects(repository.savingsAccounts.upsert({ ...account, closedAt }));
  await repository.savingsAccounts.upsert({ ...account, closedAt: "2024-02-29" });
});

test("concurrent initialization never overwrites a rename or resurrects deleted defaults", async () => {
  const first = repositories(), second = repositories();
  await Promise.all([first.initializeWorkCategories(), second.initializeWorkCategories()]);
  assert.equal((await first.workCategories.list()).length, 4);
  await first.renameWorkCategory("category_seed_0", "사용자 이름");
  await first.workCategories.remove("category_seed_1");
  await Promise.all([repositories().initializeWorkCategories(), second.initializeWorkCategories()]);
  assert.equal((await first.workCategories.get("category_seed_0"))?.name, "사용자 이름");
  assert.equal(await first.workCategories.get("category_seed_1"), null);
  assert.equal((await first.workCategories.list()).length, 3);
});

test("existing custom categories survive initial registration before the first subscription response", async () => {
  const db = database();
  await setDoc(doc(db, "users/owner/workCategories/custom"), { id: "custom", name: "기존 카테고리" });
  const repository = repositories(db);
  await repository.initializeWorkCategories();
  const events: string[] = [];
  let ready!: () => void;
  const received = new Promise<void>(resolve => { ready = resolve; });
  const stop = await repository.workCategories.subscribe(items => { events.push("data"); assert.deepEqual(items.map(item => item.name), ["기존 카테고리"]); }, error => { throw error; }, () => { events.push("ready"); ready(); });
  assert.deepEqual(events, [], "registration is not the first server response");
  await received; stop();
  assert.equal(events[0], "data"); assert.equal(events.at(-1), "ready");
  assert.equal((await repository.workCategories.list()).length, 1);
});

test("a failed legacy binding chunk keeps visible categories unchanged and retries safely", async () => {
  const repository = repositories();
  await repository.initializeWorkCategories();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore() as unknown as Firestore;
    const batch = writeBatch(db);
    for (let index = 0; index < 101; index++) {
      const id = String(index).padStart(3, "0");
      batch.set(doc(db, "users/owner/workItems", id), { id, title: `작업 ${id}`, category: "교수설계", status: "done", course: "보존할 과목", amount: index === 100 ? -1 : 0 });
    }
    await batch.commit();
  });
  await assert.rejects(repository.renameWorkCategory("category_seed_0", "새 이름"));
  const categories = await repository.workCategories.list();
  const tasks = await repository.workItems.list();
  assert.equal(tasks.length, 101);
  assert(tasks.every(item => workCategoryName(item, categories) === "교수설계"));
  await repository.workItems.upsert({ ...(await repository.workItems.get("100"))!, amount: 0 });
  await repository.renameWorkCategory("category_seed_0", "새 이름");
  const renamed = await repository.workCategories.list();
  assert((await repository.workItems.list()).every(item => workCategoryName(item, renamed) === "새 이름" && item.course === "보존할 과목"));
});

test("restore inserts absent IDs without replacing concurrent or existing values", async () => {
  const first = repositories(), second = repositories();
  const item = { id: "task", title: "복원", status: "planned" as const };
  const [left, right] = await Promise.all([first.workItems.insertMissing([item]), second.workItems.insertMissing([item])]);
  assert.equal(left.length + right.length, 1);
  await first.workItems.upsert({ ...item, title: "현재 수정값" });
  assert.deepEqual(await second.workItems.insertMissing([item]), []);
  assert.equal((await second.workItems.get(item.id))?.title, "현재 수정값");
});

test("all five backup collections round-trip through the real Firebase rules", async () => {
  const source = createDemoRepositories("2026-09-12");
  await source.initializeWorkCategories();
  const backup = parseBackup(JSON.stringify(await exportBackup(source)));
  const target = repositories();
  const result = await restoreBackup(backup, target);
  assert.equal(result.added, backupCollections.reduce((sum, key) => sum + backup.data[key].length, 0));
  const exported = await exportBackup(target);
  for (const key of backupCollections) assert.deepEqual([...exported.data[key]].sort((a, b) => a.id.localeCompare(b.id)), [...backup.data[key]].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal((await restoreBackup(backup, target)).added, 0);
});

test("rules reject another user's records, unauthorized accounts and unknown fields", async () => {
  const db = database();
  await assertFails(getDocs(collection(db, "users/another-user/transactions")));
  await assertFails(getDoc(doc(database("owner", "unlisted@example.com"), "users/owner/workCategories/example")));
  // The rules are the only gate now, so an unverified address must not pass
  // even when it spells an allowed one.
  await assertFails(getDoc(doc(database("owner", "pjunga0730@gmail.com", false), "users/owner/workCategories/example")));
  await assertFails(setDoc(doc(db, "users/owner/workCategories/example"), { id: "example", name: "카테고리", extra: "unknown" }));
  await assertFails(setDoc(doc(db, "users/owner/transactions/example"), { id: "example", type: "expense", date: "2026-09-01", amount: 1, expenseDetails: { note: 42 } }));
});
