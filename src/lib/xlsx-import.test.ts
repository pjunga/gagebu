import assert from "node:assert/strict";
import test from "node:test";
import {
  importedId,
  parseAmount,
  parseDateValue,
  partialSaveError,
  previewImportRows,
  stableFingerprint,
  type WorkbookRows,
} from "./xlsx-import";
import { RepositoryError } from "./repository-types";

test("parseAmount reads the money formats the source workbook uses", () => {
  assert.equal(parseAmount("1,234원"), 1234);
  assert.equal(parseAmount("₩12,000"), 12000);
  assert.equal(parseAmount("3만"), 30_000);
  assert.equal(parseAmount("1.5억"), 150_000_000);
  assert.equal(parseAmount("(500)"), -500);
  assert.equal(parseAmount("10%"), 0.1);
  assert.equal(parseAmount(1500), 1500);
});

test("parseAmount rejects values that are not an amount", () => {
  assert.equal(parseAmount("-"), null);
  assert.equal(parseAmount("없음"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(Number.NaN), null);
  assert.equal(parseAmount(new Date()), null);
});

test("parseDateValue normalises the date shapes to ISO days", () => {
  assert.equal(parseDateValue("2026년 3월 5일"), "2026-03-05");
  assert.equal(parseDateValue("2026년 3월"), "2026-03-01");
  assert.equal(parseDateValue("2026-03-05"), "2026-03-05");
  assert.equal(parseDateValue("2026.3"), "2026-03-01");
  assert.equal(parseDateValue("3월", 2025), "2025-03-01");
  // Excel serial numbers, including the 1900 leap-year quirk.
  assert.equal(parseDateValue(45_000), "2023-03-15");
  assert.equal(parseDateValue(61), "1900-03-01");
});

test("parseDateValue rejects impossible or unparseable dates", () => {
  assert.equal(parseDateValue("2026-02-30"), null);
  assert.equal(parseDateValue("garbage"), null);
  assert.equal(parseDateValue("3월"), null, "a bare month needs a fallback year");
  assert.equal(parseDateValue(""), null);
});

test("stableFingerprint ignores key order but not content", () => {
  const first = stableFingerprint("side-income", { amount: 1000, month: 3 });
  const reordered = stableFingerprint("side-income", { month: 3, amount: 1000 });
  assert.equal(first, reordered);
  assert.notEqual(first, stableFingerprint("side-income", { amount: 1001, month: 3 }));
  assert.notEqual(first, stableFingerprint("salary", { amount: 1000, month: 3 }));
  assert.match(first, /^v1-[0-9a-f]{16}$/);
});

test("importedId derives a stable id from the fingerprint", () => {
  const fingerprint = stableFingerprint("side-income", { amount: 1 });
  assert.equal(importedId("transaction", fingerprint), `import_transaction_${fingerprint}`);
});

const sideIncomeSheet: Record<string, WorkbookRows> = {
  부수입: [
    ["", "강의료", "원고료"],
    ["1월", "300,000", "50,000"],
  ],
};

test("previewImportRows turns a side-income block into income transactions", () => {
  const preview = previewImportRows(sideIncomeSheet, { year: 2026 });

  assert.equal(preview.counts.transactions, 2);
  assert.equal(preview.counts.duplicates, 0);
  assert.deepEqual(
    preview.transactions.map((transaction) => [
      transaction.category,
      transaction.amount,
      transaction.date,
      transaction.type,
    ]),
    [
      ["강의료", 300_000, "2026-01-01", "income"],
      ["원고료", 50_000, "2026-01-01", "income"],
    ],
  );
  assert.equal(preview.transactions[0].incomeDetails?.source, "side-income");
  assert.equal(preview.transactions[0].incomeDetails?.month, "2026-01");
});

test("previewImportRows skips rows whose fingerprint was already imported", () => {
  const first = previewImportRows(sideIncomeSheet, { year: 2026 });
  const second = previewImportRows(sideIncomeSheet, {
    year: 2026,
    existingFingerprints: first.records.map((record) => record.fingerprint),
  });

  assert.equal(second.counts.transactions, 0);
  assert.equal(second.counts.duplicates, 2);
  assert.deepEqual(second.duplicateFingerprints.sort(), first.records.map((record) => record.fingerprint).sort());
});

test("previewImportRows reports sheets it does not understand", () => {
  const preview = previewImportRows({ 메모: [["아무거나"]] });

  assert.equal(preview.counts.transactions, 0);
  assert.equal(preview.skippedRows.length, 1);
  assert.equal(preview.skippedRows[0].sheet, "메모");
});

test("partialSaveError reports everything stored before the failure", () => {
  const groupFailure = new RepositoryError("Firebase에 기록을 저장하지 못했습니다.", {
    code: "firebase/write-failed",
    alreadySaved: 400,
  });

  const composed = partialSaveError(groupFailure, 1200);
  assert.ok(composed instanceof RepositoryError);
  assert.equal(composed.alreadySaved, 1600);
  assert.equal(composed.code, "firebase/write-failed");
  assert.match(composed.message, /1600건은 이미 저장되었습니다\.$/);
  // The count is stated once, not once per layer.
  assert.equal(composed.message.match(/이미 저장되었습니다/g)?.length, 1);
});

test("partialSaveError passes a failure through when nothing was stored", () => {
  const failure = new RepositoryError("브라우저 저장 공간에 기록하지 못했습니다.", {
    code: "storage/write-failed",
  });
  assert.equal(partialSaveError(failure, 0), failure);
});
