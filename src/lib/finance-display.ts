/**
 * Formatting and filtering rules shared by the dashboard panels.
 *
 * These live outside the components so the rules that decide what a user reads
 * (relative dates, currency, which assets belong to a year) can be tested.
 */

const DAY_MS = 86_400_000;

function startOfDay(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00`).getTime();
}

/**
 * Relative day label only — never an absolute date. Callers that want the date
 * itself print it themselves, so this can be appended without repeating them.
 */
export function relativeDay(dateValue: string, today: string): string {
  const target = startOfDay(dateValue);
  const base = startOfDay(today);
  if (Number.isNaN(target) || Number.isNaN(base)) return "";
  const diff = Math.round((target - base) / DAY_MS);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff < 0) return `${Math.abs(diff)}일 지남`;
  if (diff < 14) return `${diff}일 후`;
  return `D-${diff}`;
}

export const DEFAULT_CURRENCY = "KRW";

/** Formats an amount in its own currency; never converts between currencies. */
export function formatMoney(amount: number, currencyCode = DEFAULT_CURRENCY): string {
  const code = currencyCode.trim().toUpperCase() || DEFAULT_CURRENCY;
  if (code === DEFAULT_CURRENCY) {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
}

export function isForeignCurrency(currencyCode?: string): boolean {
  return Boolean(currencyCode) && currencyCode!.trim().toUpperCase() !== DEFAULT_CURRENCY;
}

/**
 * Totals only the records kept in the base currency. Foreign amounts are
 * reported separately because the app has no exchange rate to convert them.
 */
export function totalByCurrency<T extends { amount: number; currency?: string }>(
  records: T[],
): { base: number; foreign: { code: string; count: number; total: number }[] } {
  let base = 0;
  const foreign = new Map<string, { code: string; count: number; total: number }>();
  for (const record of records) {
    if (!isForeignCurrency(record.currency)) {
      base += record.amount;
      continue;
    }
    const code = record.currency!.trim().toUpperCase();
    const entry = foreign.get(code) ?? { code, count: 0, total: 0 };
    entry.count += 1;
    entry.total += record.amount;
    foreign.set(code, entry);
  }
  return { base, foreign: [...foreign.values()].sort((left, right) => left.code.localeCompare(right.code)) };
}

/**
 * A savings account belongs to a year while it is open, not only in the year it
 * was opened; a one-off record (a stock order) belongs to the year it happened.
 */
export function isAssetInYear(
  record: { date: string; maturityDate?: string; recurring?: boolean },
  year: string,
): boolean {
  if (!record.recurring) return record.date.slice(0, 4) === year;
  const firstDay = `${year}-01-01`;
  const lastDay = `${year}-12-31`;
  if (record.date > lastDay) return false;
  return !record.maturityDate || record.maturityDate >= firstDay;
}

/**
 * Previous "YYYY-MM" for a month key. Date arithmetic through toISOString()
 * shifts the day into the previous month in timezones ahead of UTC, so the
 * month is stepped on its own.
 */
export function previousMonthOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return month;
  const previous = monthNumber === 1 ? { year: year - 1, month: 12 } : { year, month: monthNumber - 1 };
  return `${String(previous.year).padStart(4, "0")}-${String(previous.month).padStart(2, "0")}`;
}

/** Drops a category that only repeats the record's own kind label. */
export function categorySubLabel(kindLabel: string, category?: string): string | undefined {
  const trimmed = category?.trim();
  if (!trimmed || trimmed === kindLabel) return undefined;
  return trimmed;
}
