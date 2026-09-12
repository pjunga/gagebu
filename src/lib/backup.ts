import type { SavingsAccount, StockOrder, Transaction, WorkCategoryRecord, WorkItem } from "./domain";
import { RepositoryError, type DomainRepositories } from "./repository-types";

export const backupCollections = ["transactions", "savingsAccounts", "stockOrders", "workCategories", "workItems"] as const;
export type BackupCollection = typeof backupCollections[number];
export const backupLabels: Record<BackupCollection, string> = { transactions: "수입·지출", savingsAccounts: "예금·적금", stockOrders: "주식 주문", workCategories: "카테고리", workItems: "작업" };
export type BackupData = { transactions: Transaction[]; savingsAccounts: SavingsAccount[]; stockOrders: StockOrder[]; workCategories: WorkCategoryRecord[]; workItems: WorkItem[] };
export type Backup = { format: "gagebu"; version: 1; exportedAt: string; data: BackupData };

type Check = (value: unknown) => boolean;
const text = (max: number, nonempty = false): Check => value => typeof value === "string" && value.length <= max && (!nonempty || Boolean(value.trim()));
const number = (max: number): Check => value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const money = number(1_000_000_000_000);
const choice = (...values: string[]): Check => value => typeof value === "string" && values.includes(value);
const date: Check = value => typeof value === "string" && /^\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?(?:[T ][0-9A-Za-z: +.-]+)?$/.test(value) && value.length <= 64;
const calendarDay: Check = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const shape = (fields: Record<string, Check>, required: string[] = []): Check => value => object(value)
  && required.every(key => key in value)
  && Object.entries(value).every(([key, child]) => Object.hasOwn(fields, key) && fields[key](child));
const incomeDetails = shape({
  source: choice("salary", "side-income", "sideincome", "other", "급여", "부수입"),
  employer: text(200), payer: text(200), sourceName: text(200), count: number(1_000_000), grossAmount: money, netAmount: money, taxAmount: money,
  paymentDate: text(100), month: value => typeof value === "string" && /^\d{4}[-/.]\d{1,2}$/.test(value), recurring: value => typeof value === "boolean", note: text(1000), workItemId: text(200, true),
}, ["source"]);
const metadata = {
  id: ((value: unknown) => text(200, true)(value) && !String(value).includes("/") && ![".", ".."].includes(String(value))) as Check,
  createdAt: date, updatedAt: date, source: choice("manual", "legacy", "import"), fingerprint: text(256),
  import: shape({ sheet: text(100, true), row: number(100_000_000), column: text(20) }, ["sheet"]),
};
const checks: Record<BackupCollection, Check> = {
  transactions: shape({ ...metadata, type: choice("income", "expense"), category: text(200), amount: money, memo: text(1000), date,
    incomeDetails, workItemId: text(200, true), expenseDetails: shape({ paymentMethod: text(200), merchant: text(200), note: text(1000) }),
  }, ["id", "type", "category", "amount", "memo", "date"]),
  savingsAccounts: shape({ ...metadata, institution: text(200, true), accountName: text(200, true), assetType: choice("deposit", "savings"),
    principal: money, balance: money, monthlyContribution: money, interestRate: number(100), interestAmount: money, startDate: date, maturityDate: date, closedAt: calendarDay, memo: text(1000),
  }, ["id", "institution", "accountName"]),
  stockOrders: shape({ ...metadata, broker: text(200), ticker: text(50, true), name: text(200), side: choice("buy", "sell"), quantity: money,
    unitPrice: money, totalAmount: money, principalOrBalance: money, orderDate: date, fee: money, currency: text(12), memo: text(1000),
  }, ["id", "ticker", "side", "quantity", "unitPrice", "totalAmount", "orderDate"]),
  workCategories: shape({ ...metadata, name: text(60, true), order: number(1_000_000) }, ["id", "name"]),
  workItems: shape({ ...metadata, title: text(300, true), category: text(60, true), categoryId: text(200, true), workDate: date,
    course: text(200), courseNumber: text(100), session: text(100), clientOrSchool: text(200), amount: money, description: text(2000),
    status: choice("planned", "in-progress", "completed", "sent", "paid", "todo", "done", "cancelled"), priority: choice("low", "normal", "high", "urgent"),
    dueDate: date, sentAt: date, completedAt: date, sideIncomeTransactionId: text(200, true), memo: text(1000), tags: value => Array.isArray(value) && value.length <= 50 && value.every(text(200)),
  }, ["id", "title", "status"]),
};

export function parseBackup(raw: string): Backup {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("JSON 파일을 읽을 수 없습니다."); }
  if (!object(value) || value.format !== "gagebu" || value.version !== 1 || !date(value.exportedAt) || !object(value.data)) {
    throw new Error("지원되는 가계부 백업 파일(version 1)이 아닙니다.");
  }
  if (Object.keys(value.data).some(key => !backupCollections.includes(key as BackupCollection))) throw new Error("알 수 없는 종류의 기록이 포함되어 있습니다.");
  for (const key of backupCollections) {
    const records = value.data[key];
    if (!Array.isArray(records)) throw new Error(`${backupLabels[key]} 목록이 없습니다.`);
    const ids = new Set<string>();
    records.forEach((record: unknown, index) => {
      if (!checks[key](record)) throw new Error(`${backupLabels[key]} ${index + 1}번째 기록의 형식이나 값이 올바르지 않습니다.`);
      const id = (record as { id: string }).id;
      if (ids.has(id)) throw new Error(`${backupLabels[key]}에 중복된 ID가 있습니다: ${id}`);
      ids.add(id);
    });
  }
  return value as Backup;
}

export async function readBackupData(repositories: DomainRepositories): Promise<BackupData> {
  const records = await Promise.all(backupCollections.map(key => repositories[key].list()));
  return Object.fromEntries(backupCollections.map((key, index) => [key, records[index]])) as BackupData;
}

export async function exportBackup(repositories: DomainRepositories): Promise<Backup> {
  return { format: "gagebu", version: 1, exportedAt: new Date().toISOString(), data: await readBackupData(repositories) };
}

export function previewBackup(backup: Backup, existing: BackupData) {
  return backupCollections.map(key => {
    const ids = new Set(existing[key].map(item => item.id));
    const fingerprints = new Set(existing[key].map(item => item.fingerprint).filter(Boolean));
    let added = 0;
    for (const item of backup.data[key]) {
      if (ids.has(item.id) || (item.fingerprint && fingerprints.has(item.fingerprint))) continue;
      added++;
      ids.add(item.id);
      if (item.fingerprint) fingerprints.add(item.fingerprint);
    }
    return { key, added, skipped: backup.data[key].length - added };
  });
}

export async function restoreBackup(backup: Backup, repositories: DomainRepositories): Promise<{ added: number; skipped: number }> {
  // Validate at the write boundary as well as during the preview.
  parseBackup(JSON.stringify(backup));
  let added = 0;
  const insert = async <T>(items: T[], write: (items: T[]) => Promise<T[]>) => { added += (await write(items)).length; };
  try {
    await insert(backup.data.workCategories, items => repositories.workCategories.insertMissing(items));
    await insert(backup.data.transactions, items => repositories.transactions.insertMissing(items));
    await insert(backup.data.savingsAccounts, items => repositories.savingsAccounts.insertMissing(items));
    await insert(backup.data.stockOrders, items => repositories.stockOrders.insertMissing(items));
    await insert(backup.data.workItems, items => repositories.workItems.insertMissing(items));
  } catch (cause) {
    added += cause instanceof RepositoryError ? cause.alreadySaved ?? 0 : 0;
    throw new RepositoryError(`복원을 완료하지 못했습니다. ${added}건은 추가되었습니다. 다시 시도하면 기존 기록은 건너뜁니다.`, { cause, alreadySaved: added });
  }
  return { added, skipped: backupCollections.reduce((sum, key) => sum + backup.data[key].length, 0) - added };
}
