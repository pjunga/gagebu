/**
 * Canonical domain records used by both the local and Firebase repositories.
 *
 * The app deliberately keeps financial records separate from savings, orders,
 * and work tracking. This keeps UI concerns (such as a monthly summary) from
 * leaking into persistence and makes imports safe to repeat.
 */

export type EntityKind =
  | "transaction"
  | "savingsAccount"
  | "stockOrder"
  | "workItem"
  | "workCategory";

export type RecordSource = "manual" | "legacy" | "import";

export type TransactionType = "income" | "expense";

export type IncomeSource = "salary" | "side-income" | "other";

export interface IncomeDetails {
  source: IncomeSource;
  employer?: string;
  payer?: string;
  sourceName?: string;
  count?: number;
  grossAmount?: number;
  netAmount?: number;
  taxAmount?: number;
  paymentDate?: string;
  month?: string;
  recurring?: boolean;
  note?: string;
  workItemId?: string;
}

export interface EntityMetadata {
  source?: RecordSource;
  fingerprint?: string;
  import?: {
    sheet: string;
    row?: number;
    column?: string;
  };
}

export interface BaseEntity extends EntityMetadata {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transaction extends BaseEntity {
  type: TransactionType;
  category: string;
  amount: number;
  memo: string;
  date: string;
  incomeDetails?: IncomeDetails;
  /** Optional direct link for consumers that do not want to unpack incomeDetails. */
  workItemId?: string;
}

export type TransactionDraft = Omit<Transaction, "id"> & { id?: string };

export type SavingsAssetType = "deposit" | "savings";

export interface SavingsAccount extends BaseEntity {
  institution: string;
  accountName: string;
  assetType?: SavingsAssetType;
  principal?: number;
  balance?: number;
  monthlyContribution?: number;
  interestRate?: number;
  interestAmount?: number;
  startDate?: string;
  maturityDate?: string;
  /**
   * Set only when the user ends the account. Every other status ("만기 임박",
   * "만기 도래") is derived from the maturity date, so storing it would go stale.
   */
  closedAt?: string;
  memo?: string;
}

export type SavingsAccountDraft = Omit<SavingsAccount, "id"> & {
  id?: string;
};

export type StockOrderSide = "buy" | "sell";

export interface StockOrder extends BaseEntity {
  broker?: string;
  ticker: string;
  name?: string;
  side: StockOrderSide;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  principalOrBalance?: number;
  orderDate: string;
  fee?: number;
  currency?: string;
  memo?: string;
}

export type StockOrderDraft = Omit<StockOrder, "id"> & { id?: string };

export type WorkItemStatus =
  | "planned"
  | "in-progress"
  | "completed"
  | "sent"
  | "paid"
  // Legacy values are accepted so old local records remain editable.
  | "todo"
  | "done"
  | "cancelled";

export type WorkItemPriority = "low" | "normal" | "high" | "urgent";

/** Seed list written once for a user who has no category of their own yet. */
export const WORK_CATEGORIES = ["교수설계", "위시스프링", "레미제라블", "그외"] as const;

/** Categories are user-managed, so a work item may carry any saved name. */
export type WorkCategory = string;

/** A category the user added, renamed, or kept from the seed list. */
export interface WorkCategoryRecord extends BaseEntity {
  name: string;
  /** Lower sorts first; ties fall back to the name. */
  order?: number;
}

export type WorkCategoryDraft = Omit<WorkCategoryRecord, "id"> & { id?: string };

/**
 * Records saved before categories existed all came from the instructional
 * design ledger, so a missing category is read as 교수설계 until the user edits it.
 */
export const DEFAULT_WORK_CATEGORY: WorkCategory = "교수설계";

export interface WorkItem extends BaseEntity {
  title: string;
  category?: WorkCategory;
  workDate?: string;
  course?: string;
  courseNumber?: string;
  session?: string;
  clientOrSchool?: string;
  amount?: number;
  description?: string;
  status: WorkItemStatus;
  priority?: WorkItemPriority;
  dueDate?: string;
  sentAt?: string;
  completedAt?: string;
  sideIncomeTransactionId?: string;
  tags?: string[];
  memo?: string;
}

export type WorkItemDraft = Omit<WorkItem, "id"> & { id?: string };

export type DomainEntity =
  | Transaction
  | SavingsAccount
  | StockOrder
  | WorkItem
  | WorkCategoryRecord;

export type DraftByKind = {
  transaction: TransactionDraft;
  savingsAccount: SavingsAccountDraft;
  stockOrder: StockOrderDraft;
  workItem: WorkItemDraft;
  workCategory: WorkCategoryDraft;
};

export type EntityByKind = {
  transaction: Transaction;
  savingsAccount: SavingsAccount;
  stockOrder: StockOrder;
  workItem: WorkItem;
  workCategory: WorkCategoryRecord;
};

export const ENTITY_COLLECTIONS: Record<EntityKind, string> = {
  transaction: "transactions",
  savingsAccount: "savingsAccounts",
  stockOrder: "stockOrders",
  workItem: "workItems",
  workCategory: "workCategories",
};

export function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Transaction>;
  return (
    typeof item.id === "string" &&
    (item.type === "income" || item.type === "expense") &&
    typeof item.amount === "number" &&
    Number.isFinite(item.amount) &&
    typeof item.date === "string"
  );
}

export function isSavingsAccount(value: unknown): value is SavingsAccount {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavingsAccount>;
  return (
    typeof item.id === "string" &&
    typeof item.institution === "string" &&
    typeof item.accountName === "string"
  );
}

export function isStockOrder(value: unknown): value is StockOrder {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StockOrder>;
  return (
    typeof item.id === "string" &&
    typeof item.ticker === "string" &&
    (item.side === "buy" || item.side === "sell") &&
    typeof item.quantity === "number" &&
    typeof item.unitPrice === "number" &&
    typeof item.orderDate === "string"
  );
}

export function isWorkItem(value: unknown): value is WorkItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.status === "string"
  );
}

export function isWorkCategoryRecord(value: unknown): value is WorkCategoryRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkCategoryRecord> & { title?: unknown };
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    item.title === undefined
  );
}

export function entityKindOf(value: DomainEntity): EntityKind {
  if (isTransaction(value)) return "transaction";
  if (isSavingsAccount(value)) return "savingsAccount";
  if (isStockOrder(value)) return "stockOrder";
  if (isWorkCategoryRecord(value)) return "workCategory";
  return "workItem";
}

/** Sort order shown in every category picker. */
export function sortWorkCategories(items: WorkCategoryRecord[]): WorkCategoryRecord[] {
  return [...items].sort((left, right) => {
    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.name.localeCompare(right.name, "ko");
  });
}

export function createEntityId(prefix = "record"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function asFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s₩원$]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asNonEmptyString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
