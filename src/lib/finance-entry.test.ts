import assert from "node:assert/strict";
import test from "node:test";
import { recordToDraft } from "./finance-entry";
import { createLocalRepositories, createMemoryStorage } from "./local-repository";

test("editing preserves zero amounts and the stock's currency", () => {
  const draft = recordToDraft({ id: "s", kind: "savings", title: "예금", date: "2026-09-01", amount: 0, principal: 1_000_000, balance: 0, monthlyContribution: 0, principalOrBalance: 0 });
  assert.equal(draft.balance, "0"); assert.equal(draft.amount, "1000000"); assert.equal(draft.monthlyContribution, "0");
  assert.equal(recordToDraft({ id: "o", kind: "stock-order", title: "주식", date: "2026-09-01", amount: 420, currency: "USD", quantity: 2, unitPrice: 210 }).currency, "USD");
});

test("reloading transactions preserves expense details and import metadata", async () => {
  const storage = createMemoryStorage();
  const repositories = createLocalRepositories(storage);
  const record = { id: "expense", type: "expense" as const, amount: 1000, date: "2026-09-01", category: "식비", memo: "점심", expenseDetails: { paymentMethod: "카드", merchant: "상점", note: "메모" }, import: { sheet: "거래", row: 2 }, fingerprint: "fp", source: "import" as const };
  await repositories.transactions.upsert(record);
  const before = await repositories.transactions.get(record.id);
  const reopened = createLocalRepositories(storage);
  assert.deepEqual(await reopened.transactions.get(record.id), before);
});
