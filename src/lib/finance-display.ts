/**
 * Formatting and filtering rules shared by the dashboard panels.
 *
 * These live outside the components so the rules that decide what a user reads
 * (relative dates, currency, which assets belong to a year) can be tested.
 */

import type { WorkItem } from "./domain";

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

/**
 * Stored records reach us from imports and older documents, so a currency can be
 * missing, blank, or not a string at all. Everything here goes through this.
 */
function normalizeCurrency(currencyCode: unknown): string {
  return typeof currencyCode === "string" ? currencyCode.trim().toUpperCase() : "";
}

/** Formats an amount in its own currency; never converts between currencies. */
export function formatMoney(amount: number, currencyCode: unknown = DEFAULT_CURRENCY): string {
  const code = normalizeCurrency(currencyCode) || DEFAULT_CURRENCY;
  if (code === DEFAULT_CURRENCY) {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    // Intl throws on anything that is not a well-formed ISO 4217 code, and one
    // bad record must not take the whole dashboard down.
    return `${code} ${new Intl.NumberFormat("en-US").format(amount)}`;
  }
}

export function isForeignCurrency(currencyCode?: unknown): boolean {
  const code = normalizeCurrency(currencyCode);
  return Boolean(code) && code !== DEFAULT_CURRENCY;
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
    const code = normalizeCurrency(record.currency);
    const entry = foreign.get(code) ?? { code, count: 0, total: 0 };
    entry.count += 1;
    entry.total += record.amount;
    foreign.set(code, entry);
  }
  return { base, foreign: [...foreign.values()].sort((left, right) => left.code.localeCompare(right.code)) };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function toLocalIsoDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Shifts a date by whole months. Reading the parts back through toISOString()
 * moves the day one back in timezones ahead of UTC, so the parts are read local.
 */
export function addMonths(dateValue: string, amount: number): string {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  date.setMonth(date.getMonth() + amount);
  return toLocalIsoDate(date);
}

export type AssetStatus = "active" | "maturity-soon" | "matured" | "closed";

export const taskStatusOptions = ["planned", "in-progress", "sent", "paid"] as const;

export const taskStatusLabels = {
  planned: "예정",
  "in-progress": "진행 중",
  sent: "발송완료",
  paid: "입금 완료",
  cancelled: "취소",
};

export const taskNextStatus = {
  planned: "in-progress",
  "in-progress": "sent",
  sent: "paid",
  paid: "paid",
  cancelled: "planned",
} as const;

/** A completed legacy task is only sent when a sending date was recorded. */
export function taskStatus(task: Pick<WorkItem, "status" | "sentAt">): keyof typeof taskStatusLabels {
  if (task.status === "todo") return "planned";
  if (task.status === "completed" || task.status === "done") {
    return task.sentAt ? "sent" : "in-progress";
  }
  return task.status;
}

export function taskDueDate(task: Pick<WorkItem, "dueDate" | "workDate">): string {
  return task.dueDate || task.workDate || "";
}

/** Undated tasks remain accessible under all months, never an arbitrary month. */
export function isTaskInPeriod(task: Pick<WorkItem, "dueDate" | "workDate">, year: string, month: string): boolean {
  const date = taskDueDate(task);
  if (!date) return !month;
  return date.slice(0, 4) === year && (!month || date.slice(5, 7) === month);
}

/**
 * Only the ending of an account is a stored fact; the rest follows from the
 * maturity date and today, so it is derived on every read instead of saved.
 */
export function savingsStatus(
  account: { closedAt?: string; maturityDate?: string },
  today: string,
): AssetStatus {
  if (account.closedAt) return "closed";
  if (!account.maturityDate) return "active";
  if (account.maturityDate < today) return "matured";
  return account.maturityDate <= addMonths(today, 1) ? "maturity-soon" : "active";
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
