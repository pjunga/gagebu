import type { SavingsAssetType } from "./domain";
import { addMonths, localDate, type AssetStatus } from "./finance-display";

export type EntryKind =
  | "expense"
  | "income"
  | "salary"
  | "side-income"
  | "savings"
  | "stock-order";
export type FinanceRecord = {
  id: string;
  kind: EntryKind;
  title: string;
  amount: number;
  date: string;
  category?: string;
  source?: string;
  institution?: string;
  account?: string;
  maturityDate?: string;
  status?: AssetStatus;
  note?: string;
  assetType?: SavingsAssetType;
  monthlyContribution?: number;
  principal?: number;
  balance?: number;
  principalOrBalance?: number;
  payMonth?: string;
  paymentDate?: string;
  netAmount?: number;
  count?: number;
  workItemId?: string;
  side?: "buy" | "sell";
  currency?: string;
  ticker?: string;
  quantity?: number;
  unitPrice?: number;
};

export type EntryDraft = {
  kind: EntryKind;
  title: string;
  amount: string;
  date: string;
  category: string;
  source: string;
  institution: string;
  account: string;
  maturityDate: string;
  assetType: SavingsAssetType;
  monthlyContribution: string;
  balance: string;
  status: AssetStatus;
  note: string;
  payMonth: string;
  paymentDate: string;
  netAmount: string;
  count: string;
  workItemId: string;
  principalOrBalance: string;
  side: "buy" | "sell";
  currency: string;
  ticker: string;
  quantity: string;
  unitPrice: string;
};

const currentDate = localDate;
const currentMonth = () => currentDate().slice(0, 7);

export const expenseCategories = [
  "식비",
  "교통",
  "주거·관리비",
  "건강·의료",
  "문화·여가",
  "쇼핑",
  "교육",
  "기타",
];

export const draftAmount = (draft: EntryDraft): number =>
  draft.kind === "stock-order"
    ? Number(draft.quantity) * Number(draft.unitPrice)
    : Number(draft.kind === "salary" ? draft.netAmount : draft.amount);

export const defaultDraft = (kind: EntryKind = "expense"): EntryDraft => ({
  kind,
  title: "",
  amount: "",
  date: currentDate(),
  category: expenseCategories[0],
  source: "",
  institution: "",
  account: "",
  maturityDate: addMonths(currentDate(), 12),
  assetType: "deposit",
  monthlyContribution: "",
  balance: "",
  status: "active",
  note: "",
  payMonth: currentMonth(),
  paymentDate: currentDate(),
  netAmount: "",
  count: "1",
  workItemId: "",
  principalOrBalance: "",
  side: "buy",
  currency: "KRW",
  ticker: "",
  quantity: "",
  unitPrice: "",
});

export const recordToDraft = (record: FinanceRecord): EntryDraft => ({
  kind: record.kind,
  title: record.title,
  amount: String(record.principal ?? record.amount),
  date: record.date,
  category: record.category ?? expenseCategories[0],
  source: record.source ?? "",
  institution: record.institution ?? "",
  account: record.account ?? "",
  maturityDate: record.maturityDate ?? addMonths(record.date, 12),
  assetType: record.assetType ?? "deposit",
  monthlyContribution: record.monthlyContribution !== undefined ? String(record.monthlyContribution) : "",
  balance: record.balance === undefined ? "" : String(record.balance),
  status: record.status ?? "active",
  note: record.note ?? "",
  payMonth: record.payMonth ?? record.date.slice(0, 7),
  paymentDate: record.paymentDate ?? record.date,
  netAmount: record.netAmount !== undefined ? String(record.netAmount) : String(record.amount),
  count: record.count !== undefined ? String(record.count) : "1",
  workItemId: record.workItemId ?? "",
  principalOrBalance: record.principalOrBalance !== undefined ? String(record.principalOrBalance) : "",
  side: record.side ?? "buy",
  currency: record.currency || "KRW",
  ticker: record.ticker ?? "",
  quantity: record.quantity !== undefined ? String(record.quantity) : "",
  unitPrice: record.unitPrice !== undefined ? String(record.unitPrice) : "",
});
