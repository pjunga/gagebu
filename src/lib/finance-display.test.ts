import assert from "node:assert/strict";
import test from "node:test";
import {
  categorySubLabel,
  formatMoney,
  isAssetInYear,
  isForeignCurrency,
  previousMonthOf,
  relativeDay,
  totalByCurrency,
} from "./finance-display";

const today = "2026-09-06";

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
