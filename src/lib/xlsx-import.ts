import type {
  DomainEntity,
  SavingsAccount,
  StockOrder,
  Transaction,
  WorkItem,
} from "./domain";
import { type IncomeDetails, type SavingsAssetType } from "./domain";
import type { DomainRepositories } from "./repository-types";

export type WorkbookCell = string | number | boolean | Date | null | undefined;
export type WorkbookRows = WorkbookCell[][];

export interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, WorkbookRows>;
}

export interface ImportWarning {
  sheet: string;
  row?: number;
  message: string;
}

export interface ImportRecord<T extends DomainEntity = DomainEntity> {
  entity: T;
  fingerprint: string;
  sheet: string;
  row: number;
  column?: string;
  duplicate: boolean;
}

export interface XlsxImportOptions {
  /** Year used for month-only rows such as `1월` when the sheet has no title year. */
  year?: number;
  /** Existing fingerprints can be supplied to mark likely duplicates in preview. */
  existingFingerprints?: Iterable<string>;
  /** Keep at most this many warning entries while retaining accurate counts. */
  maxWarnings?: number;
}

export interface XlsxImportPreview {
  sheetNames: string[];
  records: ImportRecord[];
  transactions: Transaction[];
  savingsAccounts: SavingsAccount[];
  stockOrders: StockOrder[];
  workItems: WorkItem[];
  warnings: ImportWarning[];
  duplicateFingerprints: string[];
  skippedRows: ImportWarning[];
  counts: {
    transactions: number;
    savingsAccounts: number;
    stockOrders: number;
    workItems: number;
    duplicates: number;
    warnings: number;
    skippedRows: number;
  };
}

export interface XlsxImportSaveResult extends XlsxImportPreview {
  saved: {
    transactions: number;
    savingsAccounts: number;
    stockOrders: number;
    workItems: number;
  };
  skippedExisting: number;
}

const IMPORT_ERROR_CODE = "xlsx/parse-failed";

function cleanText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim()
    : value === null || value === undefined
      ? ""
      : String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeHeader(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}:：]/g, "");
}

function canonicalValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${canonicalValue(key)}:${canonicalValue((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return cleanText(value).toLowerCase();
}

/** Stable, dependency-free content fingerprint suitable for import dedupe. */
export function stableFingerprint(namespace: string, value: unknown): string {
  const source = `${normalizeHeader(namespace)}|${canonicalValue(value)}`;
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x01000193);
  }
  return `v1-${(first >>> 0).toString(16).padStart(8, "0")}${
    (second >>> 0).toString(16).padStart(8, "0")
  }`;
}

export function importedId(kind: string, fingerprint: string): string {
  return `import_${normalizeHeader(kind)}_${fingerprint}`;
}

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date || value === null || value === undefined) return null;
  const original = cleanText(value);
  if (!original || /^(?:-|—|–|없음|없|n\/a|na|null)$/i.test(original)) return null;
  const negative = /^\(.*\)$/.test(original);
  const percent = original.includes("%");
  const unwrapped = original.replace(/^\((.*)\)$/, "$1");
  const withoutWonSuffix = unwrapped.replace(/원\s*$/, "");
  const koreanUnit = withoutWonSuffix.match(/(억|만)\s*$/);
  const numeric = withoutWonSuffix
    .replace(/[₩$€£,\s원]/g, "")
    .replace(/%/g, "")
    .replace(/억|만/g, "");
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;
  const multiplier = koreanUnit?.[1] === "억" ? 100_000_000 : koreanUnit?.[1] === "만" ? 10_000 : 1;
  const result = parsed * multiplier;
  return (negative ? -1 : 1) * (percent ? result / 100 : result);
}

function isoDateParts(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateValue(value: unknown, defaultYear?: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel's 1900 date system, including its historical leap-year quirk.
    if (value < 0 || value > 2_958_465) return null;
    const epoch = Date.UTC(1899, 11, 31);
    const adjustedValue = value >= 60 ? value - 1 : value;
    const date = new Date(epoch + Math.round(adjustedValue * 86_400_000));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  if (!text) return null;
  const korean = text.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/);
  if (korean) {
    return isoDateParts(Number(korean[1]), Number(korean[2]), Number(korean[3] ?? 1));
  }
  const ymd = text.match(/^(\d{4})[./-](\d{1,2})(?:[./-](\d{1,2}))?/);
  if (ymd) {
    return isoDateParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3] ?? 1));
  }
  const monthOnly = text.match(/^(\d{1,2})\s*월$/);
  if (monthOnly && defaultYear) {
    return isoDateParts(defaultYear, Number(monthOnly[1]), 1);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function monthFromValue(value: unknown): number | null {
  const text = cleanText(value);
  const match = text.match(/^(?:0?([1-9]|1[0-2]))\s*월$/);
  if (!match) return null;
  return Number(match[1]);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function warning(
  warnings: ImportWarning[],
  options: XlsxImportOptions,
  item: ImportWarning,
): void {
  const max = options.maxWarnings ?? 100;
  if (warnings.length < max) warnings.push(item);
}

function cell(row: WorkbookCell[] | undefined, index: number): WorkbookCell {
  return row?.[index];
}

function rowHasValue(row: WorkbookCell[] | undefined): boolean {
  return Boolean(row?.some((value) => cleanText(value)));
}

function headerForColumn(
  rows: WorkbookRows,
  column: number,
  beforeRow: number,
): string {
  for (let rowIndex = beforeRow - 1; rowIndex >= 0 && rowIndex >= beforeRow - 5; rowIndex -= 1) {
    const raw = cell(rows[rowIndex], column);
    // Data rows often sit directly above another data row. Only textual
    // labels can be headers; numeric values must never become categories.
    if (typeof raw !== "string") continue;
    const value = cleanText(raw);
    if (value && monthFromValue(value) === null && parseAmount(value) === null) return value;
  }
  return "";
}

function findColumn(
  rows: WorkbookRows,
  aliases: string[],
  fallback: number,
  maxRows = 5,
): number {
  const targets = aliases.map(normalizeHeader);
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, maxRows); rowIndex += 1) {
    for (let column = 0; column < (rows[rowIndex]?.length ?? 0); column += 1) {
      const value = normalizeHeader(cell(rows[rowIndex], column));
      if (value && targets.some((target) => value.includes(target))) return column;
    }
  }
  return fallback;
}

function findHeaderColumn(
  row: WorkbookCell[] | undefined,
  aliases: string[],
  start = 0,
): number {
  const targets = aliases.map(normalizeHeader);
  for (let column = Math.max(0, start); column < (row?.length ?? 0); column += 1) {
    const value = normalizeHeader(cell(row, column));
    if (value && targets.some((target) => value.includes(target))) return column;
  }
  return -1;
}

function rowYear(rows: WorkbookRows, fallback: number): number {
  for (const row of rows.slice(0, 5)) {
    for (const value of row) {
      const match = cleanText(value).match(/\b(20\d{2})\b/);
      if (match) return Number(match[1]);
    }
  }
  return fallback;
}

function yearForColumn(
  rows: WorkbookRows,
  column: number,
  beforeRow: number,
  fallback: number,
): number {
  for (let rowIndex = Math.min(beforeRow, 5) - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex] ?? [];
    for (let offset = 0; offset <= 1; offset += 1) {
      for (const candidateColumn of [column - offset, column + offset]) {
        if (candidateColumn < 0) continue;
        const match = cleanText(cell(row, candidateColumn)).match(/(?:^|\D)(20\d{2})(?:\D|$)/);
        if (match) return Number(match[1]);
      }
    }
  }
  return fallback;
}

function addSource<T extends DomainEntity>(
  entity: T,
  sheet: string,
  row: number,
  column: number | undefined,
  fingerprint: string,
  source: "import" = "import",
): T {
  return {
    ...entity,
    source,
    fingerprint,
    import: {
      sheet,
      row,
      ...(column === undefined ? {} : { column: columnName(column) }),
    },
  } as T;
}

function savingsAssetType(accountName: string): SavingsAssetType {
  return normalizeHeader(accountName).includes("예금") ? "deposit" : "savings";
}

function likelyInstitution(value: string): boolean {
  const normalized = normalizeHeader(value);
  return /은행|저축|증권|금융|뱅크|bank/.test(normalized);
}

interface StockSheetColumns {
  headerRow: number;
  brokerColumn: number;
  principalColumn: number;
  tickerColumn: number;
  unitPriceColumn: number;
  quantityColumn: number;
  totalColumn: number;
}

function findStockSheetColumns(rows: WorkbookRows): StockSheetColumns | null {
  const headerRow = rows.findIndex((row) =>
    row.some((value) => /주문내역|주당|원금 ?[\/·]? ?잔금|기업명/.test(normalizeHeader(value))),
  );
  if (headerRow < 0) return null;
  const header = rows[headerRow];
  const unitPriceColumn = findHeaderColumn(header, ["주당", "단가", "주가", "가격"]);
  const quantityColumn = findHeaderColumn(
    header,
    ["주문내역", "주문수량", "수량", "주문"],
    unitPriceColumn >= 0 ? unitPriceColumn + 1 : 0,
  );
  const tickerColumn = findHeaderColumn(
    header,
    ["기업명", "종목명", "종목", "티커"],
    unitPriceColumn >= 0 ? Math.max(0, unitPriceColumn - 3) : 0,
  );
  const totalColumn = findHeaderColumn(
    header,
    ["주문총액", "총액"],
    quantityColumn >= 0 ? quantityColumn + 1 : 0,
  );
  const principalColumn = findHeaderColumn(
    header,
    ["원금잔금", "원금", "잔금"],
    tickerColumn >= 0 ? Math.max(0, tickerColumn - 2) : 0,
  );
  const brokerColumn = findHeaderColumn(
    header,
    ["증권사", "구분", "기관", "금융기관"],
    tickerColumn >= 0 ? Math.max(0, tickerColumn - 3) : 0,
  );
  if (unitPriceColumn < 0 || quantityColumn < 0 || tickerColumn < 0) return null;
  return {
    headerRow,
    brokerColumn,
    principalColumn,
    tickerColumn,
    unitPriceColumn,
    quantityColumn,
    totalColumn,
  };
}

function parseSavingsSheet(
  rows: WorkbookRows,
  sheet: string,
  options: XlsxImportOptions,
  warnings: ImportWarning[],
): ImportRecord<SavingsAccount>[] {
  const result: ImportRecord<SavingsAccount>[] = [];
  const monthlyColumn = findColumn(rows, ["적금 금액", "월 납입", "월납입", "납입액"], 2);
  const balanceColumn = findColumn(rows, ["총 금액", "잔액", "누적액", "총액"], 3);
  const interestColumn = findColumn(rows, ["이자", "이율", "금리"], -1);
  const principalColumn = findColumn(rows, ["원금", "원금 잔금"], -1);
  const maturityColumn = findColumn(rows, ["만기일", "만기"], 4);
  const headerRow = Math.max(
    0,
    rows.findIndex((row) =>
      row.some((value) => /적금|잔액|총 ?금액|구분/.test(normalizeHeader(value))),
    ),
  );
  const stockColumns = findStockSheetColumns(rows);
  let institution = "";
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValue(row)) continue;
    const first = cleanText(cell(row, 0));
    const second = cleanText(cell(row, 1));
    const firstHeader = normalizeHeader(first);
    const secondHeader = normalizeHeader(second);
    if (/합계|총합계|총액|총 ?금액/.test(firstHeader) || /합계|총합계/.test(secondHeader)) {
      continue;
    }
    if (
      stockColumns &&
      rowIndex > stockColumns.headerRow &&
      [
        stockColumns.brokerColumn,
        stockColumns.principalColumn,
        stockColumns.tickerColumn,
        stockColumns.unitPriceColumn,
        stockColumns.quantityColumn,
        stockColumns.totalColumn,
      ].some((column) => column >= 0 && cleanText(cell(row, column)))
    ) {
      continue;
    }
    if (first && second) {
      // Institution names in the source are not always suffixed with
      // “은행/뱅크”, so a populated first + second column is the reliable
      // boundary between institution groups.
      institution = first;
    } else if (first && !/구분|합계|총액|총 ?금액/.test(firstHeader)) {
      if (likelyInstitution(first) || !institution) institution = first;
    }
    const accountName = second || (first && !likelyInstitution(first) ? first : "");
    const monthlyContribution = parseAmount(cell(row, monthlyColumn));
    const balance = parseAmount(cell(row, balanceColumn));
    const interestValue = interestColumn >= 0 ? parseAmount(cell(row, interestColumn)) : null;
    const principal = principalColumn >= 0 ? parseAmount(cell(row, principalColumn)) : null;
    const maturityDate = parseDateValue(cell(row, maturityColumn), options.year);
    if (!accountName && monthlyContribution === null && balance === null && principal === null) {
      continue;
    }
    if (!accountName || /^[-—–]+$/.test(accountName) || /^(?:주식|주문|stock)$/i.test(accountName)) {
      warning(warnings, options, {
        sheet,
        row: rowIndex + 1,
        message: "상품명이 없어 적금 행을 건너뛰었습니다.",
      });
      continue;
    }
    const account: SavingsAccount = {
      id: "",
      institution: institution || "미지정 금융기관",
      accountName,
      assetType: savingsAssetType(accountName),
      ...(principal === null ? {} : { principal }),
      ...(balance === null ? {} : { balance }),
      ...(monthlyContribution === null ? {} : { monthlyContribution }),
      ...(maturityDate ? { maturityDate } : {}),
      ...(interestValue === null
        ? {}
        : normalizeHeader(headerForColumn(rows, interestColumn, rowIndex)).includes("이자")
          ? { interestAmount: interestValue }
          : { interestRate: interestValue }),
    };
    const fingerprint = stableFingerprint("savings-account", {
      institution: account.institution,
      accountName: account.accountName,
      assetType: account.assetType,
      principal: account.principal,
      balance: account.balance,
      monthlyContribution: account.monthlyContribution,
      interestRate: account.interestRate,
      interestAmount: account.interestAmount,
    });
    result.push({
      entity: addSource(
        { ...account, id: importedId("savings", fingerprint) },
        sheet,
        rowIndex + 1,
        second ? 1 : 0,
        fingerprint,
      ),
      fingerprint,
      sheet,
      row: rowIndex + 1,
      column: second ? columnName(1) : columnName(0),
      duplicate: false,
    });
  }
  return result;
}

function parseStockSheet(
  rows: WorkbookRows,
  sheet: string,
  options: XlsxImportOptions,
  warnings: ImportWarning[],
): ImportRecord<StockOrder>[] {
  const columns = findStockSheetColumns(rows);
  if (!columns) return [];
  const result: ImportRecord<StockOrder>[] = [];
  const fallbackYear = options.year ?? new Date().getFullYear();
  let broker = "";
  for (let rowIndex = columns.headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValue(row)) continue;
    const brokerValue = cleanText(cell(row, columns.brokerColumn));
    if (brokerValue && !/구분|합계|총액/.test(normalizeHeader(brokerValue))) broker = brokerValue;
    const ticker = cleanText(cell(row, columns.tickerColumn));
    const unitPrice = parseAmount(cell(row, columns.unitPriceColumn));
    const quantity = parseAmount(cell(row, columns.quantityColumn));
    const providedTotal = columns.totalColumn >= 0 ? parseAmount(cell(row, columns.totalColumn)) : null;
    const principalOrBalance =
      columns.principalColumn >= 0 ? parseAmount(cell(row, columns.principalColumn)) : null;
    const hasStockValue =
      Boolean(ticker) ||
      unitPrice !== null ||
      quantity !== null ||
      providedTotal !== null ||
      principalOrBalance !== null;
    if (!hasStockValue) continue;
    if (!ticker || unitPrice === null || quantity === null || unitPrice <= 0 || quantity <= 0) {
      warning(warnings, options, {
        sheet,
        row: rowIndex + 1,
        message: "종목, 주문 단가, 수량을 모두 해석하지 못해 주식 주문 행을 건너뛰었습니다.",
      });
      continue;
    }
    const totalAmount = unitPrice * quantity;
    if (!Number.isFinite(totalAmount) || totalAmount > Number.MAX_SAFE_INTEGER) {
      warning(warnings, options, {
        sheet,
        row: rowIndex + 1,
        message: "주식 주문 총액이 안전한 숫자 범위를 벗어나 행을 건너뛰었습니다.",
      });
      continue;
    }
    const orderDate = parseDateValue(cell(row, 0), fallbackYear) ?? `${fallbackYear}-01-01`;
    const fingerprint = stableFingerprint("stock-order", {
      broker,
      ticker,
      side: "buy",
      quantity,
      unitPrice,
      principalOrBalance,
    });
    const order: StockOrder = {
      id: importedId("stock", fingerprint),
      broker: broker || undefined,
      ticker,
      name: ticker,
      side: "buy",
      quantity,
      unitPrice,
      totalAmount,
      ...(principalOrBalance === null ? {} : { principalOrBalance }),
      orderDate,
      currency: "KRW",
    };
    // A provided total is retained only as a consistency signal; the domain
    // total remains the auditable unit-price × quantity calculation.
    if (providedTotal !== null && providedTotal !== totalAmount) {
      warning(warnings, options, {
        sheet,
        row: rowIndex + 1,
        message: "주문 총액이 단가와 수량의 곱과 달라 자동 계산값을 사용했습니다.",
      });
    }
    result.push({
      entity: addSource(order, sheet, rowIndex + 1, columns.tickerColumn, fingerprint),
      fingerprint,
      sheet,
      row: rowIndex + 1,
      column: columnName(columns.tickerColumn),
      duplicate: false,
    });
  }
  return result;
}

function tableEnd(rows: WorkbookRows, monthColumn: number): number {
  // The source workbook has several side-income blocks on one sheet. Some
  // blocks contain blank columns inside the table, so a single blank header
  // cannot be treated as the end of the block. Prefer the next explicit year
  // or work-ledger marker, then fall back to two genuinely empty columns in
  // the first few rows.
  const topRows = rows.slice(0, Math.min(rows.length, 5));
  const upper = Math.min(26, Math.max(0, ...topRows.map((row) => row?.length ?? 0)));
  const boundaries = new Set<number>();
  for (const row of topRows) {
    for (let column = monthColumn + 1; column < upper; column += 1) {
      const normalized = normalizeHeader(cell(row, column));
      if (/20\d{2}(?:년)?$/.test(normalized) || /작업일시|발송날짜|작업일|작업현황/.test(normalized)) {
        boundaries.add(column);
      }
    }
  }
  if (boundaries.size) return Math.min(...boundaries);
  let blankRun = 0;
  for (let column = monthColumn + 1; column < upper; column += 1) {
    const hasValue = topRows.some((row) => Boolean(cleanText(cell(row, column))));
    if (!hasValue) {
      blankRun += 1;
      if (blankRun >= 2) return column - 1;
    } else {
      blankRun = 0;
    }
  }
  return upper;
}

function parseSideIncomeSheet(
  rows: WorkbookRows,
  sheet: string,
  options: XlsxImportOptions,
): ImportRecord<Transaction>[] {
  const result: ImportRecord<Transaction>[] = [];
  const fallbackYear = options.year ?? new Date().getFullYear();
  const tableEnds = new Map<number, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const monthColumns = (row ?? [])
      .map((value, column) => ({ month: monthFromValue(value), column }))
      .filter((item): item is { month: number; column: number } => item.month !== null);
    for (const { month, column: monthColumn } of monthColumns) {
      const end = tableEnds.get(monthColumn) ?? tableEnd(rows, monthColumn);
      tableEnds.set(monthColumn, end);
      const year = yearForColumn(rows, monthColumn, rowIndex, fallbackYear);
      let count: number | null = null;
      let lastHeader = "";
      for (let column = monthColumn + 1; column < end; column += 1) {
        const header = headerForColumn(rows, column, rowIndex);
        const normalizedHeader = normalizeHeader(header);
        if (header) lastHeader = header;
        const rawText = cleanText(cell(row, column));
        const amount = parseAmount(rawText);
        if (amount === null) continue;
        if (/건수|횟수|count/.test(normalizedHeader) || /(?:건|횟수|개)$/.test(rawText)) {
          count = amount;
          continue;
        }
        if (/합계|총액|소계/.test(normalizedHeader)) continue;
        const category = header || lastHeader || "부수입";
        const date = `${year}-${String(month).padStart(2, "0")}-01`;
        const incomeDetails: IncomeDetails = {
          source: "side-income",
          sourceName: category,
          ...(count === null ? {} : { count }),
          month: `${year}-${String(month).padStart(2, "0")}`,
        };
        const fingerprint = stableFingerprint("side-income", {
          sheet,
          year,
          month,
          column: columnName(column),
          category,
          amount,
          count,
        });
        const transaction: Transaction = {
          id: importedId("transaction", fingerprint),
          type: "income",
          category,
          amount: Math.abs(amount),
          memo: category,
          date,
          incomeDetails,
        };
        result.push({
          entity: addSource(transaction, sheet, rowIndex + 1, column, fingerprint),
          fingerprint,
          sheet,
          row: rowIndex + 1,
          column: columnName(column),
          duplicate: false,
        });
      }
    }
  }
  return result;
}

function parseSalarySheet(
  rows: WorkbookRows,
  sheet: string,
  options: XlsxImportOptions,
  warnings: ImportWarning[],
): ImportRecord<Transaction>[] {
  const result: ImportRecord<Transaction>[] = [];
  const year = rowYear(rows, options.year ?? new Date().getFullYear());
  const headerRow = rows.findIndex((row) => row.some((value) => /월급|실수령|급여|금액/.test(normalizeHeader(value))));
  for (let rowIndex = Math.max(0, headerRow + 1); rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const month = monthFromValue(cell(row, 0));
    if (!month) continue;
    const numericCells: Array<{ column: number; amount: number; header: string }> = [];
    for (let column = 1; column < (row?.length ?? 0); column += 1) {
      const amount = parseAmount(cell(row, column));
      if (amount !== null) numericCells.push({ column, amount, header: headerForColumn(rows, column, rowIndex) });
    }
    if (!numericCells.length) {
      warning(warnings, options, { sheet, row: rowIndex + 1, message: "급여 금액을 찾지 못해 행을 건너뛰었습니다." });
      continue;
    }
    const net = numericCells.find((item) => /실수령|세후|순수령|net/.test(normalizeHeader(item.header)));
    const gross = numericCells.find((item) => /세전|총급여|gross|기본급/.test(normalizeHeader(item.header)));
    const selected = net ?? gross ?? numericCells[0];
    const date = `${year}-${String(month).padStart(2, "0")}-01`;
    const incomeDetails: IncomeDetails = {
      source: "salary",
      ...(gross ? { grossAmount: Math.abs(gross.amount) } : {}),
      ...(net ? { netAmount: Math.abs(net.amount) } : { netAmount: Math.abs(selected.amount) }),
      month: `${year}-${String(month).padStart(2, "0")}`,
      paymentDate: date,
      recurring: true,
    };
    const fingerprint = stableFingerprint("salary", {
      sheet,
      year,
      month,
      amount: Math.abs(selected.amount),
      gross: gross?.amount,
      net: net?.amount,
    });
    result.push({
      entity: addSource(
        {
          id: importedId("transaction", fingerprint),
          type: "income",
          category: "급여",
          amount: Math.abs(selected.amount),
          memo: "월급",
          date,
          incomeDetails,
        },
        sheet,
        rowIndex + 1,
        selected.column,
        fingerprint,
      ),
      fingerprint,
      sheet,
      row: rowIndex + 1,
      column: columnName(selected.column),
      duplicate: false,
    });
  }
  return result;
}

function parseWorkItemsSheet(
  rows: WorkbookRows,
  sheet: string,
  options: XlsxImportOptions,
  warnings: ImportWarning[],
): ImportRecord<WorkItem>[] {
  const result: ImportRecord<WorkItem>[] = [];
  const headerRow = rows.findIndex((row) =>
    row.some((value) => /발송 ?날짜|작업일|과정|차시|학교|발주/.test(normalizeHeader(value))),
  );
  if (headerRow < 0) return result;
  // The supplied workbook's work ledger begins at the date header and then
  // stores course/session/client/title/amount in the following columns. If a
  // future workbook adds explicit headers, use those columns instead.
  const header = rows[headerRow] ?? [];
  const dateColumn = Math.max(
    0,
    header.findIndex((value) => /발송 ?날짜|작업일|날짜/.test(normalizeHeader(value))),
  );
  const courseColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["과정번호", "과정"], dateColumn + 1, 4);
  const sessionColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["차시", "회차"], dateColumn + 2, 4);
  const clientColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["발주처", "학교", "고객"], dateColumn + 3, 4);
  const titleColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["작업제목", "제목", "과목"], dateColumn + 4, 4);
  const amountColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["금액", "수입", "보수"], dateColumn + 5, 4);
  const statusColumn = findColumn(rows.slice(headerRow, headerRow + 4), ["작업현황", "상태"], amountColumn + 1, 4);
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValue(row)) continue;
    const sentAt = parseDateValue(cell(row, dateColumn));
    const courseNumber = cleanText(cell(row, courseColumn));
    const session = cleanText(cell(row, sessionColumn));
    const clientOrSchool = cleanText(cell(row, clientColumn));
    const title = cleanText(cell(row, titleColumn));
    const amount = parseAmount(cell(row, amountColumn));
    const rawStatus = cleanText(cell(row, statusColumn));
    const memoParts = (row ?? [])
      .slice(Math.max(titleColumn + 1, amountColumn + 1), amountColumn + 4)
      .map(cleanText)
      .filter(Boolean);
    if (!sentAt && !courseNumber && !session && !clientOrSchool && !title && amount === null) continue;
    if (!title && !courseNumber && !session && amount === null) {
      warning(warnings, options, {
        sheet,
        row: rowIndex + 1,
        message: "작업 제목과 금액을 찾지 못해 행을 건너뛰었습니다.",
      });
      continue;
    }
    const workDate = sentAt ?? parseDateValue(cell(row, dateColumn), options.year);
    const normalizedStatus = normalizeHeader(rawStatus);
    const status: WorkItem["status"] = /입금|지급|정산/.test(normalizedStatus)
      ? "paid"
      : /발송|송부/.test(normalizedStatus)
        ? "sent"
        : /완료|완성|끝/.test(normalizedStatus)
          ? "completed"
          : /진행|작업중|처리중/.test(normalizedStatus)
            ? "in-progress"
            : sentAt
              ? "sent"
              : "planned";
    const fingerprint = stableFingerprint("work-item", {
      sheet,
      workDate,
      courseNumber,
      session,
      clientOrSchool,
      title,
      amount,
      status,
      memo: memoParts.join(" "),
    });
    const workItem: WorkItem = {
      id: importedId("work", fingerprint),
      title: title || [courseNumber, session, clientOrSchool].filter(Boolean).join(" · ") || "작업",
      ...(workDate ? { workDate } : {}),
      ...(courseNumber ? { courseNumber } : {}),
      ...(session ? { session } : {}),
      ...(clientOrSchool ? { clientOrSchool } : {}),
      ...(amount === null ? {} : { amount: Math.abs(amount) }),
      status,
      ...(sentAt ? { sentAt } : {}),
      ...(memoParts.length ? { memo: memoParts.join(" ") } : {}),
    };
    result.push({
      entity: addSource(workItem, sheet, rowIndex + 1, titleColumn, fingerprint),
      fingerprint,
      sheet,
      row: rowIndex + 1,
      column: columnName(titleColumn),
      duplicate: false,
    });
  }
  return result;
}

function uniqueRecords<T extends DomainEntity>(
  records: ImportRecord<T>[],
  seen: Set<string>,
  duplicateFingerprints: Set<string>,
): ImportRecord<T>[] {
  return records.filter((record) => {
    const duplicate = seen.has(record.fingerprint);
    if (duplicate) {
      duplicateFingerprints.add(record.fingerprint);
      return false;
    }
    seen.add(record.fingerprint);
    record.duplicate = false;
    return true;
  });
}

export function previewWorkbookRows(
  workbook: ParsedWorkbook,
  options: XlsxImportOptions = {},
): XlsxImportPreview {
  const warnings: ImportWarning[] = [];
  const skippedRows: ImportWarning[] = [];
  const seen = new Set(options.existingFingerprints ?? []);
  const duplicateFingerprints = new Set<string>();
  const records: ImportRecord[] = [];
  const transactions: Transaction[] = [];
  const savingsAccounts: SavingsAccount[] = [];
  const stockOrders: StockOrder[] = [];
  const workItems: WorkItem[] = [];

  for (const sheet of workbook.sheetNames) {
    const rows = workbook.sheets[sheet] ?? [];
    const normalized = normalizeHeader(sheet);
    let sheetRecords: ImportRecord[] = [];
    if (normalized === "적금" || normalized.includes("적금")) {
      sheetRecords = [
        ...parseSavingsSheet(rows, sheet, options, warnings),
        ...parseStockSheet(rows, sheet, options, warnings),
      ];
    } else if (normalized === "부수입" || normalized.includes("부수입")) {
      sheetRecords = [
        ...parseSideIncomeSheet(rows, sheet, options),
        ...parseWorkItemsSheet(rows, sheet, options, warnings),
      ];
    } else if (normalized === "월급" || normalized.includes("월급")) {
      sheetRecords = parseSalarySheet(rows, sheet, options, warnings);
    } else {
      skippedRows.push({ sheet, message: "지원하지 않는 시트라 건너뛰었습니다." });
      continue;
    }
    for (const record of sheetRecords) {
      const duplicate = seen.has(record.fingerprint);
      if (duplicate) duplicateFingerprints.add(record.fingerprint);
      const unique = uniqueRecords([record], seen, duplicateFingerprints)[0];
      if (!unique) continue;
      records.push(unique);
      if ("type" in unique.entity) transactions.push(unique.entity as Transaction);
      else if ("accountName" in unique.entity) savingsAccounts.push(unique.entity as SavingsAccount);
      else if ("ticker" in unique.entity) stockOrders.push(unique.entity as StockOrder);
      else if ("title" in unique.entity) workItems.push(unique.entity as WorkItem);
    }
  }
  return {
    sheetNames: workbook.sheetNames,
    records,
    transactions,
    savingsAccounts,
    stockOrders,
    workItems,
    warnings,
    duplicateFingerprints: [...duplicateFingerprints],
    skippedRows,
    counts: {
      transactions: transactions.length,
      savingsAccounts: savingsAccounts.length,
      stockOrders: stockOrders.length,
      workItems: workItems.length,
      duplicates: duplicateFingerprints.size,
      warnings: warnings.length,
      skippedRows: skippedRows.length,
    },
  };
}

export function previewImportRows(
  sheets: Record<string, WorkbookRows>,
  options: XlsxImportOptions = {},
): XlsxImportPreview {
  return previewWorkbookRows(
    { sheetNames: Object.keys(sheets), sheets },
    options,
  );
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: Uint8Array;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    ) {
      return index;
    }
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Decompressor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;
  if (!Decompressor) {
    throw new Error("이 브라우저는 XLSX 압축 해제를 지원하지 않습니다.");
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new Decompressor("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) throw new Error("유효한 XLSX 압축 파일을 찾지 못했습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = readU16(view, end + 10);
  const centralOffset = readU32(view, end + 16);
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (readU32(view, offset) !== 0x02014b50) throw new Error("XLSX 색인을 읽지 못했습니다.");
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, method, compressed: bytes.slice(dataStart, dataStart + compressedSize) });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  const result = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.method === 0) result.set(entry.name, entry.compressed);
    else if (entry.method === 8) result.set(entry.name, await inflateRaw(entry.compressed));
    else throw new Error(`지원하지 않는 XLSX 압축 방식입니다: ${entry.method}`);
  }
  return result;
}

function elementChildren(root: Element | Document, name: string): Element[] {
  const elements = Array.from(root.getElementsByTagNameNS("*", name));
  return elements.length
    ? elements
    : Array.from(root.getElementsByTagName(name));
}

function firstElement(root: Element | Document, name: string): Element | null {
  return elementChildren(root, name)[0] ?? null;
}

function elementText(root: Element | null): string {
  return root?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function resolveSheetPath(target: string): string {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\//, "")}`;
}

function parseColumnReference(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0] ?? "A";
  let value = 0;
  for (const char of letters.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function parseCellReference(reference: string): { row: number; column: number } | null {
  const match = reference.trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  const row = Number(match[2]) - 1;
  if (!Number.isInteger(row) || row < 0) return null;
  return { row, column: parseColumnReference(match[1]) };
}

function expandMergedCells(xml: Document, rows: WorkbookRows): void {
  for (const mergeCell of elementChildren(xml, "mergeCell")) {
    const reference = mergeCell.getAttribute("ref");
    if (!reference) continue;
    const [startText, endText = startText] = reference.split(":");
    const start = parseCellReference(startText);
    const end = parseCellReference(endText);
    if (!start || !end || end.row < start.row || end.column < start.column) continue;
    const source = cell(rows[start.row], start.column);
    if (!cleanText(source)) continue;
    for (let rowIndex = start.row; rowIndex <= end.row; rowIndex += 1) {
      rows[rowIndex] ??= [];
      for (let column = start.column; column <= end.column; column += 1) {
        if (!cleanText(cell(rows[rowIndex], column))) rows[rowIndex][column] = source;
      }
    }
  }
}

function parseWorksheet(xmlText: string, sharedStrings: string[]): WorkbookRows {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  if (firstElement(xml, "parsererror")) throw new Error("XLSX 시트 XML을 읽지 못했습니다.");
  const rows: WorkbookRows = [];
  for (const rowElement of elementChildren(xml, "row")) {
    const rowIndex = Number(rowElement.getAttribute("r") ?? rows.length + 1) - 1;
    const row: WorkbookCell[] = [];
    for (const cellElement of elementChildren(rowElement, "c")) {
      const reference = cellElement.getAttribute("r") ?? "A1";
      const column = parseColumnReference(reference);
      const type = cellElement.getAttribute("t") ?? "";
      let value: WorkbookCell = null;
      if (type === "inlineStr") {
        value = elementText(firstElement(cellElement, "is"));
      } else {
        const valueElement = firstElement(cellElement, "v");
        const raw = elementText(valueElement);
        if (!raw) value = null;
        else if (type === "s") value = sharedStrings[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1" || raw.toLowerCase() === "true";
        else if (type === "str") value = raw;
        else if (type === "d") value = raw;
        else {
          const number = Number(raw);
          value = Number.isFinite(number) ? number : raw;
        }
      }
      row[column] = value;
    }
    rows[rowIndex] = row;
  }
  expandMergedCells(xml, rows);
  return rows;
}

export async function parseXlsxWorkbook(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<ParsedWorkbook> {
  try {
    const bytes =
      input instanceof Blob
        ? new Uint8Array(await input.arrayBuffer())
        : input instanceof Uint8Array
          ? input
          : new Uint8Array(input);
    const entries = await readZipEntries(bytes);
    const workbookXml = entries.get("xl/workbook.xml");
    if (!workbookXml) throw new Error("워크북 메타데이터가 없습니다.");
    const decoder = new TextDecoder();
    const workbook = new DOMParser().parseFromString(decoder.decode(workbookXml), "application/xml");
    const sharedXml = entries.get("xl/sharedStrings.xml");
    const sharedStrings: string[] = [];
    if (sharedXml) {
      const shared = new DOMParser().parseFromString(decoder.decode(sharedXml), "application/xml");
      for (const item of elementChildren(shared, "si")) {
        sharedStrings.push(elementChildren(item, "t").map(elementText).join(""));
      }
    }
    const relsBytes = entries.get("xl/_rels/workbook.xml.rels");
    const rels = relsBytes
      ? new DOMParser().parseFromString(decoder.decode(relsBytes), "application/xml")
      : null;
    const relationMap = new Map<string, string>();
    for (const relation of rels ? elementChildren(rels, "Relationship") : []) {
      const id = relation.getAttribute("Id");
      const target = relation.getAttribute("Target");
      if (id && target) relationMap.set(id, resolveSheetPath(target));
    }
    const sheets: Record<string, WorkbookRows> = {};
    const sheetNames: string[] = [];
    for (const sheet of elementChildren(workbook, "sheet")) {
      const name = sheet.getAttribute("name")?.trim();
      const relationship = sheet.getAttribute("r:id") ?? sheet.getAttribute("id");
      if (!name || !relationship) continue;
      const path = relationMap.get(relationship);
      if (!path || !entries.has(path)) continue;
      sheetNames.push(name);
      sheets[name] = parseWorksheet(decoder.decode(entries.get(path)!), sharedStrings);
    }
    if (!sheetNames.length) throw new Error("읽을 수 있는 시트가 없습니다.");
    return { sheetNames, sheets };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 XLSX 오류";
    throw Object.assign(new Error(`엑셀 파일을 읽지 못했습니다: ${message}`), {
      code: IMPORT_ERROR_CODE,
      cause: error,
    });
  }
}

export const parseXlsxFile = parseXlsxWorkbook;
export const parseWorkbook = parseXlsxWorkbook;

export async function previewXlsxImport(
  input: Blob | ArrayBuffer | Uint8Array,
  options: XlsxImportOptions = {},
): Promise<XlsxImportPreview> {
  const workbook = await parseXlsxWorkbook(input);
  return previewWorkbookRows(workbook, options);
}

export const previewImport = previewXlsxImport;

async function saveRecords(
  preview: XlsxImportPreview,
  repositories: DomainRepositories,
): Promise<XlsxImportSaveResult["saved"] & { skippedExisting: number }> {
  const [existingTransactions, existingSavings, existingStocks, existingWork] = await Promise.all([
    repositories.transactions.list(),
    repositories.savingsAccounts.list(),
    repositories.stockOrders.list(),
    repositories.workItems.list(),
  ]);
  const existingByType = [existingTransactions, existingSavings, existingStocks, existingWork];
  const sets = existingByType.map(
    (items) => new Set(items.map((item) => item.fingerprint).filter((value): value is string => Boolean(value))),
  );
  let skippedExisting = 0;
  const saved = { transactions: 0, savingsAccounts: 0, stockOrders: 0, workItems: 0 };
  const groups: Array<[DomainEntity[], (items: DomainEntity[]) => Promise<DomainEntity[]>, Set<string>, keyof typeof saved]> = [
    [preview.transactions, (items) => repositories.transactions.upsertMany(items as Transaction[]), sets[0], "transactions"],
    [preview.savingsAccounts, (items) => repositories.savingsAccounts.upsertMany(items as SavingsAccount[]), sets[1], "savingsAccounts"],
    [preview.stockOrders, (items) => repositories.stockOrders.upsertMany(items as StockOrder[]), sets[2], "stockOrders"],
    [preview.workItems, (items) => repositories.workItems.upsertMany(items as WorkItem[]), sets[3], "workItems"],
  ];
  for (const [items, save, known, key] of groups) {
    // Collect first: writing one at a time re-serialises the whole store and
    // re-renders every subscriber per record, which is quadratic on a big sheet.
    const pending: DomainEntity[] = [];
    for (const item of items) {
      if (item.fingerprint && known.has(item.fingerprint)) {
        skippedExisting += 1;
        continue;
      }
      if (item.fingerprint) known.add(item.fingerprint);
      pending.push(item);
    }
    if (!pending.length) continue;
    // Count what the repository stored, not what was handed to it.
    saved[key] += (await save(pending)).length;
  }
  return { ...saved, skippedExisting };
}

export async function importXlsxFile(
  input: Blob | ArrayBuffer | Uint8Array,
  repositories: DomainRepositories,
  options: XlsxImportOptions = {},
): Promise<XlsxImportSaveResult> {
  const preview = await previewXlsxImport(input, options);
  const savedResult = await saveRecords(preview, repositories);
  const { skippedExisting, ...saved } = savedResult;
  return { ...preview, saved, skippedExisting };
}

export const importWorkbook = importXlsxFile;
