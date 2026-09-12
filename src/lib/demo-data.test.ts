import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoData, createDemoRepositories } from "./demo-data";
import { WORK_CATEGORIES } from "./domain";

const TODAY = "2026-09-06";

test("demo work items use valid categories and paid ones link to real side income", () => {
  const data = buildDemoData(TODAY);
  const transactionIds = new Set(data.transactions.map((transaction) => transaction.id));
  const workItemIds = new Set(data.workItems.map((item) => item.id));

  for (const item of data.workItems) {
    assert.ok(item.category && (WORK_CATEGORIES as readonly string[]).includes(item.category), item.title);
    if (item.status === "paid") {
      assert.ok(
        item.sideIncomeTransactionId && transactionIds.has(item.sideIncomeTransactionId),
        `${item.title} should link to a side-income transaction`,
      );
    }
  }
  for (const transaction of data.transactions) {
    if (transaction.workItemId) assert.ok(workItemIds.has(transaction.workItemId), transaction.memo);
  }
  assert.ok(data.transactions.some((transaction) => transaction.date.startsWith(TODAY.slice(0, 7))));
});

test("createDemoRepositories serves the dataset from memory", async () => {
  const repositories = createDemoRepositories(TODAY);
  const data = buildDemoData(TODAY);

  assert.equal((await repositories.transactions.list()).length, data.transactions.length);
  assert.equal((await repositories.savingsAccounts.list()).length, data.savingsAccounts.length);
  assert.equal((await repositories.stockOrders.list()).length, data.stockOrders.length);
  assert.equal((await repositories.workItems.list()).length, data.workItems.length);
});
