import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  asFiniteNumber,
  asNonEmptyString,
  entityKindOf,
  isTransaction,
  sortWorkCategories,
  WORK_CATEGORIES,
  type WorkCategoryRecord,
  type SavingsAccount,
  type StockOrder,
  type Transaction,
  type WorkItem,
} from "./domain";

test("asFiniteNumber strips currency noise and falls back on garbage", () => {
  assert.equal(asFiniteNumber("1,200원"), 1200);
  assert.equal(asFiniteNumber("₩ 3,000"), 3000);
  assert.equal(asFiniteNumber(42), 42);
  assert.equal(asFiniteNumber("abc", 7), 7);
  assert.equal(asFiniteNumber(Number.NaN, 3), 3);
  assert.equal(asFiniteNumber(undefined), 0);
});

test("asNonEmptyString trims and falls back on blanks", () => {
  assert.equal(asNonEmptyString("  급여 "), "급여");
  assert.equal(asNonEmptyString("   ", "기타"), "기타");
  assert.equal(asNonEmptyString(null, "기타"), "기타");
});

const transaction: Transaction = {
  id: "t1",
  type: "expense",
  category: "식비",
  amount: 9000,
  memo: "점심",
  date: "2026-09-06",
};

test("isTransaction rejects records that cannot be summed", () => {
  assert.equal(isTransaction(transaction), true);
  assert.equal(isTransaction({ ...transaction, amount: Number.NaN }), false);
  assert.equal(isTransaction({ ...transaction, type: "transfer" }), false);
  assert.equal(isTransaction({ ...transaction, date: undefined }), false);
  assert.equal(isTransaction(null), false);
});

test("entityKindOf tells the four record kinds apart", () => {
  const savings: SavingsAccount = { id: "s1", institution: "은행", accountName: "적금" };
  const order: StockOrder = {
    id: "o1",
    ticker: "AAPL",
    side: "buy",
    quantity: 1,
    unitPrice: 100,
    totalAmount: 100,
    orderDate: "2026-09-06",
  };
  const work: WorkItem = { id: "w1", title: "강의", status: "planned" };

  assert.equal(entityKindOf(transaction), "transaction");
  assert.equal(entityKindOf(savings), "savingsAccount");
  assert.equal(entityKindOf(order), "stockOrder");
  assert.equal(entityKindOf(work), "workItem");
});

test("firestore rules accept user-managed work categories", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const workItemKeys = rules.match(/function validWorkItem[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/);

  assert.ok(workItemKeys, "validWorkItem should declare its allowed keys");
  // hasOnly() rejects the whole write when a key is missing, so a new field
  // has to be listed here or every task save fails with permission-denied.
  assert.match(workItemKeys[1], /"category"/);
  // Category names are user data now, so no name may be hard-coded in rules.
  for (const category of WORK_CATEGORIES) {
    assert.ok(!rules.includes(`"${category}"`), `firestore.rules still pins ${category}`);
  }
  assert.match(rules, /match \/users\/\{userId\}\/workCategories\/\{categoryId\}/);
});

test("sortWorkCategories puts ordered names first and keeps the rest alphabetical", () => {
  const item = (name: string, order?: number): WorkCategoryRecord => ({ id: name, name, order });
  const sorted = sortWorkCategories([item("나중"), item("먼저", 0), item("가나다")]);
  assert.deepEqual(sorted.map((entry) => entry.name), ["먼저", "가나다", "나중"]);
});
