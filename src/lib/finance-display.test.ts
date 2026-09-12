import assert from "node:assert/strict";
import test from "node:test";
import {
  categorySubLabel,
  formatMoney,
  addMonths,
  savingsStatus,
  isAssetInYear,
  isForeignCurrency,
  previousMonthOf,
  relativeDay,
  totalByCurrency,
  isTaskInPeriod,
  taskDueDate,
  taskNextStatus,
  taskStatus,
  taskStatusOptions,
  localDate,
  sortTasksByDeadline,
} from "./finance-display";
import { previewImportRows } from "./xlsx-import";

const today = "2026-09-06";

test("work filters use deadlines and keep legacy and undated records accessible", () => {
  const task = { dueDate: "2026-09-30", workDate: "2025-08-01" };
  assert.equal(taskDueDate(task), "2026-09-30");
  assert.equal(isTaskInPeriod(task, "2026", "09"), true);
  assert.equal(isTaskInPeriod(task, "2026", "08"), false);
  assert.equal(isTaskInPeriod(task, "2025", "08"), false);
  assert.equal(isTaskInPeriod(task, "2026", ""), true);
  assert.equal(isTaskInPeriod({ workDate: "2025-12-31" }, "2025", "12"), true);
  assert.equal(isTaskInPeriod({ workDate: "2025-12-31" }, "2026", "01"), false);
  assert.equal(isTaskInPeriod({}, "2026", ""), true);
  assert.equal(isTaskInPeriod({}, "2026", "09"), false);
  assert.equal(taskDueDate({}), "");

  assert.deepEqual(taskStatusOptions, ["planned", "in-progress", "sent", "paid"]);
  assert.equal(taskStatus({ status: "todo" }), "planned");
  for (const status of ["completed", "done"] as const) {
    assert.equal(taskStatus({ status }), "in-progress");
    assert.equal(taskStatus({ status, sentAt: "2026-09-01" }), "sent");
  }
  assert.equal(taskStatus({ status: "cancelled" }), "cancelled");
  assert.equal(taskNextStatus.planned, "in-progress");
  assert.equal(taskNextStatus["in-progress"], "sent");
  assert.equal(taskNextStatus.sent, "paid");
  assert.equal(taskNextStatus.paid, "paid");

  const sheets = { 부수입: [
    ["작업일", "과정", "회차", "학교", "작업제목", "금액", "상태"],
    ["2026-09-12", "기존 과정", "1", "기존 학교", "완료 작업", "600", "완료"],
  ] };
  const imported = previewImportRows(sheets, { year: 2026 });
  assert.equal(imported.workItems.length, 1);
  const legacy = imported.workItems[0];
  assert.equal(taskStatus(legacy), "sent");
  assert.equal(taskDueDate(legacy), "2026-09-12");
  assert.equal(legacy.status, "completed", "displaying a legacy status preserves its source record");
  assert.equal(legacy.clientOrSchool, "기존 학교");
  const repeated = previewImportRows(sheets, { year: 2026, existingFingerprints: imported.records.map(record => record.fingerprint) });
  assert.equal(repeated.workItems.length, 0);
  assert.equal(repeated.counts.duplicates, 1);
});

test("local dates stay in the correct day, month and year before 09:00 in Korea", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Asia/Seoul";
  try {
    for (const date of ["2026-09-12", "2026-09-01", "2026-01-01"]) assert.equal(localDate(new Date(`${date}T00:30:00+09:00`)), date);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("unfinished tasks sort by legacy or current deadline before undated/paid tasks", () => {
  const task = (id: string, dueDate?: string) => ({ id, title: id, status: "in-progress" as const, dueDate });
  const sorted = sortTasksByDeadline([task("later", "2026-10-01"), task("undated"), { ...task("legacy"), workDate: "2026-09-01" }, task("late", "2026-08-01"), { ...task("paid", "2026-01-01"), status: "paid" as const }]);
  assert.deepEqual(sorted.map(item => item.id), ["late", "legacy", "later", "undated", "paid"]);
});

test("relativeDay returns only the relative part, never the date itself", () => {
  assert.equal(relativeDay("2026-09-06", today), "오늘");
  assert.equal(relativeDay("2026-09-07", today), "내일");
  assert.equal(relativeDay("2026-09-09", today), "3일 후");
  assert.equal(relativeDay("2026-09-19", today), "13일 후");
  // Two weeks out and further stays relative so callers can print the date once.
  assert.equal(relativeDay("2026-09-20", today), "D-14");
  assert.equal(relativeDay("2026-10-10", today), "D-34");
  assert.equal(relativeDay("2026-08-25", today), "12일 지남");
  assert.equal(relativeDay("nonsense", today), "");
});

test("formatMoney keeps each amount in its own currency", () => {
  assert.equal(formatMoney(12_000), "₩12,000");
  assert.equal(formatMoney(2_136_000, "KRW"), "₩2,136,000");
  assert.equal(formatMoney(1217.5, "USD"), "$1,217.50");
  assert.equal(formatMoney(1000, "eur"), "€1,000.00");
});

test("isForeignCurrency only flags codes other than the base currency", () => {
  assert.equal(isForeignCurrency(undefined), false);
  assert.equal(isForeignCurrency("KRW"), false);
  assert.equal(isForeignCurrency("krw"), false);
  assert.equal(isForeignCurrency("USD"), true);
});

test("totalByCurrency never mixes currencies into one sum", () => {
  const result = totalByCurrency([
    { amount: 2_136_000 },
    { amount: 100, currency: "krw" },
    { amount: 1217.5, currency: "USD" },
    { amount: 500, currency: "USD" },
    { amount: 20, currency: "EUR" },
  ]);

  assert.equal(result.base, 2_136_100);
  assert.deepEqual(result.foreign, [
    { code: "EUR", count: 1, total: 20 },
    { code: "USD", count: 2, total: 1717.5 },
  ]);
});

test("isAssetInYear keeps an open account through every year it spans", () => {
  const account = { date: "2024-01-10", maturityDate: "2026-10-10", recurring: true };

  assert.equal(isAssetInYear(account, "2026"), true, "opened earlier, matures this year");
  assert.equal(isAssetInYear(account, "2024"), true, "the year it was opened");
  assert.equal(isAssetInYear(account, "2027"), false, "already matured");
  assert.equal(isAssetInYear(account, "2023"), false, "not opened yet");
  assert.equal(
    isAssetInYear({ date: "2020-02-01", recurring: true }, "2026"),
    true,
    "an account with no maturity date stays open",
  );
});

test("isAssetInYear treats a one-off order as belonging to its own year", () => {
  assert.equal(isAssetInYear({ date: "2026-08-14" }, "2026"), true);
  assert.equal(isAssetInYear({ date: "2026-08-14" }, "2025"), false);
});

test("categorySubLabel drops a category that repeats the kind label", () => {
  assert.equal(categorySubLabel("급여", "급여"), undefined);
  assert.equal(categorySubLabel("부수입", " 부수입 "), undefined);
  assert.equal(categorySubLabel("일반 지출", "식비"), "식비");
  assert.equal(categorySubLabel("일반 지출", "  "), undefined);
  assert.equal(categorySubLabel("일반 지출", undefined), undefined);
});

test("previousMonthOf steps the month without a timezone shift", () => {
  assert.equal(previousMonthOf("2026-09"), "2026-08");
  assert.equal(previousMonthOf("2026-01"), "2025-12");
  assert.equal(previousMonthOf("2026-12"), "2026-11");
  assert.equal(previousMonthOf("nonsense"), "nonsense");
});

test("formatMoney survives a currency code Intl cannot parse", () => {
  assert.equal(formatMoney(1217.5, "US$"), "US$ 1,217.5");
  assert.equal(formatMoney(1000, 0 as unknown as string), "₩1,000");
  assert.equal(formatMoney(1000, "   "), "₩1,000");
});

test("addMonths keeps the day in timezones ahead of UTC", () => {
  assert.equal(addMonths("2026-09-06", 1), "2026-10-06");
  assert.equal(addMonths("2026-12-06", 1), "2027-01-06");
  assert.equal(addMonths("2026-09-06", -1), "2026-08-06");
});

test("savingsStatus stores only the ending and derives the rest", () => {
  const today = "2026-09-06";
  assert.equal(savingsStatus({ closedAt: "2026-03-01", maturityDate: "2027-01-01" }, today), "closed");
  assert.equal(savingsStatus({ maturityDate: "2026-09-05" }, today), "matured");
  assert.equal(savingsStatus({ maturityDate: "2026-09-20" }, today), "maturity-soon");
  assert.equal(savingsStatus({ maturityDate: "2026-10-06" }, today), "maturity-soon");
  assert.equal(savingsStatus({ maturityDate: "2027-01-01" }, today), "active");
  assert.equal(savingsStatus({}, today), "active");
});
