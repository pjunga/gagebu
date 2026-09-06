"use client";

import { AuthAccountControls } from "@/components/auth-gate";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  createEntityId,
  type SavingsAccount,
  type SavingsAssetType,
  type StockOrder,
  type Transaction as DomainTransaction,
  type WorkItem as DomainWorkItem,
  type WorkItemStatus,
} from "@/lib/domain";
import {
  categorySubLabel,
  formatMoney,
  isAssetInYear,
  previousMonthOf,
  relativeDay,
  totalByCurrency,
  addMonths,
  savingsStatus,
  type AssetStatus,
} from "@/lib/finance-display";
import { createDataRepositories } from "@/lib/repositories";
import {
  importXlsxFile,
  previewXlsxImport,
  type XlsxImportPreview,
} from "@/lib/xlsx-import";
import { Icon, type IconName } from "./icons";
import ThemeToggle from "./theme-toggle";

export type ViewKey = "overview" | "transactions" | "assets" | "tasks";
export type EntryKind =
  | "expense"
  | "salary"
  | "side-income"
  | "savings"
  | "stock-order";
export type { AssetStatus };
export type WorkStatus = WorkItemStatus;

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

type WorkItem = DomainWorkItem;

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
  ticker: string;
  quantity: string;
  unitPrice: string;
};

const currentDate = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => currentDate().slice(0, 7);
const currentYear = () => currentDate().slice(0, 4);

const entryLabels: Record<EntryKind, string> = {
  expense: "일반 지출",
  salary: "급여",
  "side-income": "부수입",
  savings: "예금·적금",
  "stock-order": "주식 주문",
};

const entryIcons: Record<EntryKind, IconName> = {
  expense: "arrow-down",
  salary: "briefcase",
  "side-income": "sparkles",
  savings: "wallet",
  "stock-order": "pie-chart",
};

const entryTones: Record<EntryKind, string> = {
  expense: "rose",
  salary: "emerald",
  "side-income": "amber",
  savings: "sky",
  "stock-order": "violet",
};

const entrySelectedBorders: Record<EntryKind, string> = {
  expense: "border-rose-400/60",
  salary: "border-emerald-400/60",
  "side-income": "border-amber-400/60",
  savings: "border-sky-400/60",
  "stock-order": "border-violet-400/60",
};

const expenseCategories = [
  "식비",
  "교통",
  "주거·관리비",
  "건강·의료",
  "문화·여가",
  "쇼핑",
  "교육",
  "기타",
];

const sourceOptions = ["전체 출처", "급여", "프리랜스", "환급", "기타 수입"];
const institutionOptions = ["전체 기관", "주거래 은행", "저축 은행", "증권사"];
const assetStatusLabels: Record<AssetStatus, string> = {
  active: "운영 중",
  "maturity-soon": "만기 임박",
  matured: "만기 도래",
  closed: "종료",
};

/** The only statuses a user picks; the rest follow from the maturity date. */
const savingsStatusOptions: AssetStatus[] = ["active", "closed"];

const currency = (value: number, currencyCode?: string) => formatMoney(value, currencyCode);

const compactCurrency = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (absolute >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return currency(value);
};

const dateText = (value?: string) => {
  if (!value) return "날짜 없음";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
};

const monthText = (value: string) => {
  const date = new Date(`${value}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
};

const defaultDraft = (kind: EntryKind = "expense"): EntryDraft => ({
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
  ticker: "",
  quantity: "",
  unitPrice: "",
});

const recordToDraft = (record: FinanceRecord): EntryDraft => ({
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
  monthlyContribution: record.monthlyContribution ? String(record.monthlyContribution) : "",
  balance: record.balance ? String(record.balance) : "",
  status: record.status ?? "active",
  note: record.note ?? "",
  payMonth: record.payMonth ?? record.date.slice(0, 7),
  paymentDate: record.paymentDate ?? record.date,
  netAmount: record.netAmount ? String(record.netAmount) : String(record.amount),
  count: record.count ? String(record.count) : "1",
  workItemId: record.workItemId ?? "",
  principalOrBalance: record.principalOrBalance ? String(record.principalOrBalance) : "",
  side: record.side ?? "buy",
  ticker: record.ticker ?? "",
  quantity: record.quantity ? String(record.quantity) : "",
  unitPrice: record.unitPrice ? String(record.unitPrice) : "",
});

function toneClasses(tone: string, soft = false) {
  const map: Record<string, string> = {
    rose: soft
      ? "bg-rose-500/12 text-rose-200 ring-1 ring-inset ring-rose-400/25"
      : "bg-rose-400 text-rose-950",
    emerald: soft
      ? "bg-emerald-500/12 text-emerald-200 ring-1 ring-inset ring-emerald-400/25"
      : "bg-emerald-400 text-emerald-950",
    amber: soft
      ? "bg-amber-500/12 text-amber-200 ring-1 ring-inset ring-amber-400/25"
      : "bg-amber-400 text-amber-950",
    sky: soft
      ? "bg-sky-500/12 text-sky-200 ring-1 ring-inset ring-sky-400/25"
      : "bg-sky-400 text-sky-950",
    violet: soft
      ? "bg-violet-500/12 text-violet-200 ring-1 ring-inset ring-violet-400/25"
      : "bg-violet-400 text-violet-950",
  };
  return map[tone] ?? map.emerald;
}

function StatusBadge({ status }: { status?: AssetStatus | WorkStatus }) {
  const labels: Record<string, string> = {
    active: "운영 중",
    "maturity-soon": "만기 임박",
    matured: "만기 도래",
    closed: "종료",
    "planned": "예정",
    "in-progress": "진행 중",
    "completed": "완료",
    sent: "발송",
    paid: "입금 완료",
    todo: "예정",
    done: "완료",
    cancelled: "취소",
  };
  const styles: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20",
    "maturity-soon": "bg-amber-500/10 text-amber-200 ring-amber-400/20",
    matured: "bg-rose-500/10 text-rose-200 ring-rose-400/20",
    closed: "bg-slate-500/10 text-body ring-slate-400/20",
    planned: "bg-slate-500/10 text-body ring-slate-400/20",
    "in-progress": "bg-sky-500/10 text-sky-200 ring-sky-400/20",
    completed: "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20",
    sent: "bg-violet-500/10 text-violet-200 ring-violet-400/20",
    paid: "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20",
    todo: "bg-slate-500/10 text-body ring-slate-400/20",
    done: "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20",
    cancelled: "bg-rose-500/10 text-rose-200 ring-rose-400/20",
  };
  if (!status) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${styles[status]}`}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

function SideBadge({ side }: { side: "buy" | "sell" }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${toneClasses("violet", true)}`}>
      {side === "buy" ? "매수" : "매도"}
    </span>
  );
}

function KindBadge({ kind }: { kind: EntryKind }) {
  const tone = entryTones[kind];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-body">
      <span className={`flex h-6 w-6 items-center justify-center rounded-xl ${toneClasses(tone, true)}`}>
        <Icon name={entryIcons[kind]} size={13} />
      </span>
      {entryLabels[kind]}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{eyebrow}</p>}
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="animate-pulse rounded-3xl border border-line bg-card p-5">
      <div className="h-3 w-20 rounded bg-card-strong" />
      <div className="mt-4 h-8 w-32 rounded bg-card-strong" />
      <div className="mt-3 h-2 w-24 rounded bg-card" />
    </div>
  );
}

/** Keeps keyboard users inside each dialog and returns focus to its opener. */
function useDialogFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const first = dialog?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return dialogRef;
}

function EmptyState({
  icon = "file",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-3xl border border-dashed border-line-strong bg-card-soft px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-3xl bg-card-strong text-muted">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="text-sm font-medium text-body">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-faint">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  tone,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  subtext: string;
  tone: string;
  icon: IconName;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl sm:h-8 sm:w-8 ${toneClasses(tone, true)}`}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight text-ink sm:mt-4 sm:text-2xl">{value}</p>
      <p className="mt-2 text-[11px] leading-4 text-faint">{subtext}</p>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group rounded-3xl border border-line bg-card p-4 text-left shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-card-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-3xl border border-line bg-card p-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
      {content}
    </div>
  );
}

const fieldClass =
  "mt-2 h-11 w-full rounded-2xl border border-line bg-field px-3.5 text-sm text-ink outline-none transition placeholder:text-faint hover:border-line-strong focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15";
const selectClass = `${fieldClass} appearance-none pr-9`;

function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-body">
      {children}
      {required && <span className="ml-1 text-rose-300" aria-hidden="true">*</span>}
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  compact?: boolean | "sm";
}) {
  return (
    <div className={compact ? "relative min-w-0 flex-1 md:w-[138px] md:flex-none" : "relative"}>
      {compact ? (
        <label htmlFor={id} className="sr-only">{label}</label>
      ) : (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      )}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={compact
          ? `${compact === "sm" ? "h-9 rounded-xl px-3 text-xs" : "h-10 rounded-2xl px-3.5 text-sm"} w-full appearance-none border border-line bg-field pr-9 text-ink outline-none transition hover:border-line-strong focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15`
          : selectClass}
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-surface">
            {option}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={15} className={`pointer-events-none absolute right-3 text-faint ${compact ? "top-1/2 -translate-y-1/2" : "top-[34px]"}`} />
    </div>
  );
}

function EntryModal({
  open,
  initial,
  editingId,
  workItems,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: EntryDraft;
  editingId?: string | null;
  workItems: WorkItem[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: EntryDraft) => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [validationError, setValidationError] = useState("");
  const dialogRef = useDialogFocus(open, onClose);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset dialog-local state when a new record is opened */
    setDraft(initial);
    setValidationError("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initial, onClose, open]);

  if (!open) return null;

  const update = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setValidationError("");
  };

  const handleKindChange = (kind: EntryKind) => {
    setDraft((previous) => ({
      ...previous,
      kind,
      title: previous.title === entryLabels[previous.kind] ? "" : previous.title,
      category: kind === "expense" ? previous.category || expenseCategories[0] : previous.category,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount =
      draft.kind === "stock-order"
        ? Number(draft.quantity) * Number(draft.unitPrice)
        : Number(draft.kind === "salary" ? draft.netAmount : draft.amount);
    if (!draft.title.trim()) {
      setValidationError("내역 이름을 입력해주세요.");
      return;
    }
    if (!draft.date) {
      setValidationError("날짜를 선택해주세요.");
      return;
    }
    if (!amount || amount <= 0) {
      setValidationError(
        draft.kind === "stock-order"
          ? "수량과 주문 단가를 0보다 크게 입력해주세요."
          : "금액을 0보다 크게 입력해주세요.",
      );
      return;
    }
    if (draft.kind === "stock-order" && !draft.ticker.trim()) {
      setValidationError("종목 코드를 입력해주세요.");
      return;
    }
    onSave(draft);
  };

  const isEditing = Boolean(editingId);
  const stockTotal = Number(draft.quantity) * Number(draft.unitPrice);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black/50 sm:max-h-[90vh] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">기록하기</p>
            <h2 id="entry-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">
              {isEditing ? "내역 수정" : "새 내역 추가"}
            </h2>
            <p className="mt-1 text-xs text-faint">먼저 기록 유형을 선택하면 필요한 항목만 표시됩니다.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="내역 추가 닫기"
            className="rounded-2xl p-2 text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <fieldset>
            <legend className="text-xs font-medium text-body">기록 유형</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(Object.keys(entryLabels) as EntryKind[]).map((kind) => {
                const selected = draft.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleKindChange(kind)}
                    className={`flex min-h-[74px] flex-col items-start justify-between rounded-3xl border px-3 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
                      selected
                        ? `${entrySelectedBorders[kind]} ${toneClasses(entryTones[kind], true)}`
                        : "border-line bg-card-soft text-faint hover:border-line-strong hover:bg-card"
                    }`}
                  >
                    <Icon name={entryIcons[kind]} size={17} />
                    <span className="text-[11px] font-medium leading-4">{entryLabels[kind]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="entry-title" required>내역 이름</FieldLabel>
              <input
                id="entry-title"
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                className={fieldClass}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? "entry-validation-error" : undefined}
                placeholder={
                  draft.kind === "expense"
                    ? "예: 점심 식사"
                    : draft.kind === "salary"
                      ? "예: 월급"
                      : draft.kind === "side-income"
                        ? "예: 프로젝트 정산"
                        : draft.kind === "savings"
                          ? "예: 정기예금"
                          : "예: ETF 매수"
                }
              />
            </div>

            {draft.kind !== "stock-order" ? (
              <div>
                <FieldLabel htmlFor="entry-amount" required>
                  {draft.kind === "salary" ? "순수령액" : draft.kind === "savings" ? "원금·예치 금액" : "금액"}
                </FieldLabel>
                <div className="relative">
                  <input
                    id="entry-amount"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    value={draft.kind === "salary" ? draft.netAmount : draft.amount}
                    onChange={(event) => update(draft.kind === "salary" ? "netAmount" : "amount", event.target.value)}
                    className={`${fieldClass} pr-12 text-right tabular-nums`}
                    placeholder="0"
                    aria-invalid={Boolean(validationError)}
                    aria-describedby={validationError ? "entry-validation-error" : undefined}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">원</span>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-body">주문 금액</p>
                <div className="mt-2 flex h-11 items-center justify-end rounded-2xl border border-line bg-field px-3.5 text-sm font-semibold tabular-nums text-violet-200">
                  {stockTotal > 0 ? currency(stockTotal) : "수량 × 주문 단가"}
                </div>
              </div>
            )}
            <div>
              <FieldLabel htmlFor="entry-date" required>{draft.kind === "salary" ? "지급일" : draft.kind === "side-income" ? "발생일" : "날짜"}</FieldLabel>
              <input id="entry-date" type="date" value={draft.kind === "salary" ? draft.paymentDate : draft.date} onChange={(event) => { const value = event.target.value; setDraft((previous) => ({ ...previous, date: value, paymentDate: value })); }} className={fieldClass} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "entry-validation-error" : undefined} />
            </div>

            {draft.kind === "expense" && (
              <>
                <SelectField id="entry-category" label="카테고리" value={draft.category} onChange={(value) => update("category", value)} options={expenseCategories} />
                <div>
                  <FieldLabel htmlFor="entry-account">결제 수단</FieldLabel>
                  <input id="entry-account" value={draft.account} onChange={(event) => update("account", event.target.value)} className={fieldClass} placeholder="예: 생활비 카드" />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="entry-source">상점·출처</FieldLabel>
                  <input id="entry-source" value={draft.source} onChange={(event) => update("source", event.target.value)} className={fieldClass} placeholder="예: 동네 마트, 자동이체" />
                </div>
              </>
            )}

            {draft.kind === "salary" && (
              <>
                <div>
                  <FieldLabel htmlFor="salary-pay-month" required>귀속 월</FieldLabel>
                  <input id="salary-pay-month" type="month" value={draft.payMonth} onChange={(event) => update("payMonth", event.target.value)} className={fieldClass} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "entry-validation-error" : undefined} />
                </div>
                <div>
                  <FieldLabel htmlFor="salary-source">급여 출처</FieldLabel>
                  <input id="salary-source" value={draft.source} onChange={(event) => update("source", event.target.value)} className={fieldClass} placeholder="예: 회사 급여" />
                </div>
                <div>
                  <FieldLabel htmlFor="salary-account">입금 계좌</FieldLabel>
                  <input id="salary-account" value={draft.account} onChange={(event) => update("account", event.target.value)} className={fieldClass} placeholder="예: 주거래 통장" />
                </div>
              </>
            )}

            {draft.kind === "side-income" && (
              <>
                <div>
                  <FieldLabel htmlFor="side-occurrence-month" required>발생 월</FieldLabel>
                  <input id="side-occurrence-month" type="month" value={draft.payMonth} onChange={(event) => update("payMonth", event.target.value)} className={fieldClass} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "entry-validation-error" : undefined} />
                </div>
                <div>
                  <FieldLabel htmlFor="side-count">건수</FieldLabel>
                  <input id="side-count" type="number" min="1" step="1" value={draft.count} onChange={(event) => update("count", event.target.value)} className={`${fieldClass} text-right tabular-nums`} placeholder="1" />
                </div>
                <div>
                  <FieldLabel htmlFor="side-source">수입원 이름</FieldLabel>
                  <input id="side-source" value={draft.source} onChange={(event) => update("source", event.target.value)} className={fieldClass} placeholder="예: 프리랜스, 환급" />
                </div>
                <div>
                  <FieldLabel htmlFor="side-account">입금 계좌</FieldLabel>
                  <input id="side-account" value={draft.account} onChange={(event) => update("account", event.target.value)} className={fieldClass} placeholder="예: 주거래 통장" />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="side-work-item">연결 작업 (선택)</FieldLabel>
                  <div className="relative">
                    <select id="side-work-item" value={draft.workItemId} onChange={(event) => update("workItemId", event.target.value)} className={selectClass}>
                      <option value="" className="bg-surface">연결하지 않음</option>
                      {workItems.filter((item) => item.status !== "cancelled").map((item) => <option key={item.id} value={item.id} className="bg-surface">{item.title}</option>)}
                    </select>
                    <Icon name="chevron-down" size={15} className="pointer-events-none absolute right-3 top-[34px] text-faint" />
                  </div>
                </div>
              </>
            )}

            {draft.kind === "savings" && (
              <>
                <SelectField id="savings-asset-type" label="자산 유형" value={draft.assetType === "savings" ? "적금" : "예금"} onChange={(value) => update("assetType", value === "적금" ? "savings" : "deposit")} options={["예금", "적금"]} />
                <div>
                  <FieldLabel htmlFor="savings-institution">금융 기관</FieldLabel>
                  <input id="savings-institution" value={draft.institution} onChange={(event) => update("institution", event.target.value)} className={fieldClass} placeholder="예: 저축 은행" />
                </div>
                <div>
                  <FieldLabel htmlFor="savings-account">상품·계좌</FieldLabel>
                  <input id="savings-account" value={draft.account} onChange={(event) => update("account", event.target.value)} className={fieldClass} placeholder="예: 정기예금" />
                </div>
                <div>
                  <FieldLabel htmlFor="savings-maturity">만기일</FieldLabel>
                  <input id="savings-maturity" type="date" value={draft.maturityDate} onChange={(event) => update("maturityDate", event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <FieldLabel htmlFor="savings-monthly">월 납입액</FieldLabel>
                  <div className="relative"><input id="savings-monthly" type="number" min="0" step="1000" value={draft.monthlyContribution} onChange={(event) => update("monthlyContribution", event.target.value)} className={`${fieldClass} pr-12 text-right tabular-nums`} placeholder="0" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">원</span></div>
                </div>
                <div>
                  <FieldLabel htmlFor="savings-balance">현재 잔액</FieldLabel>
                  <div className="relative"><input id="savings-balance" type="number" min="0" step="1000" value={draft.balance} onChange={(event) => update("balance", event.target.value)} className={`${fieldClass} pr-12 text-right tabular-nums`} placeholder="예치 금액과 같으면 비워두세요" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">원</span></div>
                </div>
                <SelectField id="savings-status" label="상태" value={assetStatusLabels[savingsStatusOptions.includes(draft.status) ? draft.status : "active"]} onChange={(value) => update("status", savingsStatusOptions.find((status) => assetStatusLabels[status] === value) || "active")} options={savingsStatusOptions.map((status) => assetStatusLabels[status])} />
              </>
            )}

            {draft.kind === "stock-order" && (
              <>
                <div>
                  <FieldLabel htmlFor="stock-institution">증권사</FieldLabel>
                  <input id="stock-institution" value={draft.institution} onChange={(event) => update("institution", event.target.value)} className={fieldClass} placeholder="예: 증권사" />
                </div>
                <div>
                  <FieldLabel htmlFor="stock-ticker" required>종목 코드</FieldLabel>
                  <input id="stock-ticker" value={draft.ticker} onChange={(event) => update("ticker", event.target.value)} className={`${fieldClass} uppercase`} placeholder="예: ETF" />
                </div>
                <div>
                  <FieldLabel htmlFor="stock-quantity" required>수량</FieldLabel>
                  <input id="stock-quantity" type="number" min="0" step="1" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} className={`${fieldClass} text-right tabular-nums`} placeholder="0" />
                </div>
                <div>
                  <FieldLabel htmlFor="stock-unit-price" required>주문 단가</FieldLabel>
                  <div className="relative">
                    <input id="stock-unit-price" type="number" min="0" step="100" value={draft.unitPrice} onChange={(event) => update("unitPrice", event.target.value)} className={`${fieldClass} pr-12 text-right tabular-nums`} placeholder="0" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">원</span>
                  </div>
                </div>
                <div>
                  <FieldLabel htmlFor="stock-principal">주문 후 원금·잔액</FieldLabel>
                  <div className="relative"><input id="stock-principal" type="number" min="0" step="1000" value={draft.principalOrBalance} onChange={(event) => update("principalOrBalance", event.target.value)} className={`${fieldClass} pr-12 text-right tabular-nums`} placeholder="선택 입력" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">원</span></div>
                </div>
                <fieldset className="sm:col-span-2">
                  <legend className="text-xs font-medium text-body">주문 구분</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["buy", "sell"] as const).map((side) => (
                      <label key={side} className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-3.5 py-3 text-sm transition ${draft.side === side ? "border-violet-400/50 bg-violet-500/10 text-violet-100" : "border-line text-muted hover:border-line-strong"}`}>
                        <input type="radio" name="stock-side" value={side} checked={draft.side === side} onChange={() => update("side", side)} className="accent-violet-400" />
                        {side === "buy" ? "매수" : "매도"}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="sm:col-span-2">
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <FieldLabel htmlFor="entry-note">메모</FieldLabel>
              <textarea id="entry-note" rows={3} value={draft.note} onChange={(event) => update("note", event.target.value)} className={`${fieldClass} h-auto resize-none py-3`} placeholder="필요한 내용을 간단히 남겨보세요." />
            </div>
          </div>

          {validationError && (
            <p id="entry-validation-error" role="alert" className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
              <Icon name="info" size={15} />
              {validationError}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="h-11 rounded-2xl px-5 text-sm font-medium text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">취소</button>
            <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
              {saving && <Icon name="refresh" size={16} className="animate-spin" />}
              {saving ? "저장 중…" : isEditing ? "변경 저장" : "내역 저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailModal({
  record,
  onClose,
  onEdit,
  onDelete,
}: {
  record: FinanceRecord | null;
  onClose: () => void;
  onEdit: (record: FinanceRecord) => void;
  onDelete: (record: FinanceRecord) => void;
}) {
  useEffect(() => {
    if (!record) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose, record]);

  if (!record) return null;
  const detailRows = [
    ["기록 유형", entryLabels[record.kind]],
    ["날짜", dateText(record.date)],
    record.category ? ["카테고리", record.category] : null,
    record.source ? ["출처", record.source] : null,
    record.institution ? ["기관", record.institution] : null,
    record.account ? ["계좌·수단", record.account] : null,
    record.maturityDate ? ["만기일", dateText(record.maturityDate)] : null,
    record.ticker ? ["종목 코드", record.ticker] : null,
    record.quantity ? ["수량", `${record.quantity.toLocaleString("ko-KR")}주`] : null,
    record.unitPrice ? ["주문 단가", currency(record.unitPrice, record.currency)] : null,
    record.side ? ["주문 구분", record.side === "buy" ? "매수" : "매도"] : null,
    record.kind !== "stock-order" && record.status && assetStatusLabels[record.status as AssetStatus]
      ? ["상태", assetStatusLabels[record.status as AssetStatus]]
      : null,
  ].filter(Boolean) as string[][];

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="detail-dialog-title" className="w-full max-w-lg overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black/50 sm:rounded-3xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <KindBadge kind={record.kind} />
            <h2 id="detail-dialog-title" className="mt-3 truncate text-xl font-semibold text-ink">{record.title}</h2>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${record.kind === "expense" ? "text-rose-200" : "text-emerald-200"}`}>
              {record.kind === "expense" ? "−" : record.kind === "stock-order" && record.side === "sell" ? "+" : "+"}{currency(record.amount, record.currency)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="rounded-2xl p-2 text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><Icon name="close" size={20} /></button>
        </div>
        <div className="px-5 py-5 sm:px-7">
          <dl className="divide-y divide-line rounded-3xl border border-line bg-card-soft px-4">
            {detailRows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
                <dt className="text-faint">{label}</dt>
                <dd className="text-right text-body">{value}</dd>
              </div>
            ))}
          </dl>
          {record.note && <p className="mt-4 rounded-3xl bg-card px-4 py-3 text-sm leading-6 text-muted">{record.note}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => onDelete(record)} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rose-400/20 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"><Icon name="trash" size={16} /> 삭제</button>
            <button type="button" onClick={() => onEdit(record)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-card-strong px-4 text-sm font-medium text-ink transition hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><Icon name="edit" size={16} /> 수정</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({
  record,
  onClose,
  onConfirm,
}: {
  record: FinanceRecord | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!record) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, record]);
  if (!record) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-5 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-copy" className="w-full max-w-sm rounded-3xl border border-line-strong bg-surface p-6 shadow-2xl shadow-black/60">
        <span className="flex h-11 w-11 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-200"><Icon name="trash" size={20} /></span>
        <h2 id="delete-title" className="mt-5 text-lg font-semibold text-ink">내역을 삭제할까요?</h2>
        <p id="delete-copy" className="mt-2 text-sm leading-6 text-muted"><span className="font-medium text-body">{record.title}</span> 내역을 삭제하면 다시 복구할 수 없습니다.</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="h-11 rounded-2xl px-4 text-sm font-medium text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">취소</button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-2xl bg-rose-500 px-5 text-sm font-semibold text-ink transition hover:bg-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">삭제하기</button>
        </div>
      </div>
    </div>
  );
}

type ImportPreview = XlsxImportPreview & {
  fileName: string;
};

function ImportModal({
  open,
  onClose,
  onImport,
  existingFingerprints = [],
}: {
  open: boolean;
  onClose: () => void;
  onImport: (file: File, preview: ImportPreview) => void;
  existingFingerprints?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"select" | "preview">("select");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the import wizard for each open */
    setStage("select");
    setPreview(null);
    setConfirmed(false);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose, open]);

  if (!open) return null;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isSupported = /\.xlsx$/i.test(file.name);
    if (!isSupported) {
      setError("현재는 XLSX 파일만 선택할 수 있습니다.");
      return;
    }
    setError("");
    try {
      const parsed = await previewXlsxImport(file, { existingFingerprints });
      setPreview({ ...parsed, fileName: file.name });
      setStage("preview");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "엑셀 파일을 읽지 못했습니다.");
    }
  };

  const backToSelect = () => {
    setStage("select");
    setPreview(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" className="w-full max-w-xl overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black/50 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300/80">데이터 가져오기</p>
            <h2 id="import-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">엑셀 내역 불러오기</h2>
            <p className="mt-1 text-xs text-faint">파일은 이 기기에서 미리보기한 뒤 확인 후 저장합니다.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="가져오기 닫기" className="rounded-2xl p-2 text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="close" size={20} /></button>
        </div>

        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <div className="mb-6 flex items-center gap-2 text-[11px] font-medium">
            <span className={`flex items-center gap-2 ${stage === "select" ? "text-sky-200" : "text-emerald-200"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15">1</span> 파일 선택</span>
            <span className="h-px w-8 bg-card-strong" />
            <span className={`flex items-center gap-2 ${stage === "preview" ? "text-sky-200" : "text-faint"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-card-strong">2</span> 미리보기 확인</span>
          </div>

          {stage === "select" && (
            <div>
              <input ref={inputRef} id="workbook-file" type="file" accept=".xlsx" onChange={handleFile} className="sr-only" />
              <label htmlFor="workbook-file" className="group flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-sky-400/30 bg-sky-500/[0.04] px-6 py-10 text-center transition hover:border-sky-300/60 hover:bg-sky-500/[0.08] focus-within:ring-2 focus-within:ring-sky-300">
                <span className="flex h-12 w-12 items-center justify-center rounded-3xl bg-sky-500/10 text-sky-200"><Icon name="upload" size={22} /></span>
                <span className="mt-4 text-sm font-medium text-body">엑셀 파일을 선택하세요</span>
              <span className="mt-1 text-xs text-faint">.xlsx 지원 · 저장 전에 시트와 행을 미리 확인합니다</span>
              </label>
              {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-card px-3 py-3 text-xs leading-5 text-faint"><Icon name="info" size={15} className="mt-0.5 text-muted" />개인정보가 포함된 파일은 필요한 범위만 선택하고, 저장 전 인식 결과를 확인하세요.</p>
            </div>
          )}

          {stage === "preview" && preview && (
            <div>
              <div className="flex items-center gap-3 rounded-3xl border border-line bg-card px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-200"><Icon name="file" size={17} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-body">{preview.fileName}</p><p className="mt-0.5 text-[11px] text-faint">파일 선택 완료 · 로컬 미리보기</p></div>
                <button type="button" onClick={backToSelect} className="text-xs text-sky-200 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">변경</button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["인식 행", `${preview.records.length}건`], ["인식 시트", `${preview.sheetNames.length}개`], ["건너뛸 행", `${preview.counts.skippedRows}건`], ["중복 의심", `${preview.counts.duplicates}건`]].map(([label, value]) => <div key={label} className="rounded-3xl border border-line bg-card-soft px-3 py-3"><p className="text-[11px] text-faint">{label}</p><p className="mt-1 text-base font-semibold text-ink">{value}</p></div>)}
              </div>
              <div className="mt-4 rounded-3xl border border-line px-4 py-4">
                <p className="text-xs font-medium text-body">인식된 시트</p>
                <div className="mt-2 flex flex-wrap gap-2">{preview.sheetNames.map((sheet) => <span key={sheet} className="rounded-xl bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-200">{sheet}</span>)}</div>
                <p className="mt-3 text-xs leading-5 text-faint">지원되는 시트의 데이터만 저장 대상으로 포함하고, 형식이 맞지 않는 행은 건너뜁니다.</p>
                {!!preview.warnings.length && <p className="mt-2 text-xs text-amber-200">주의 {preview.warnings.length}건 · 일부 행을 확인해주세요.</p>}
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-3xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3.5">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line-strong bg-surface accent-emerald-400" />
                <span className="text-xs leading-5 text-amber-100/80">미리보기 결과를 확인했으며, 인식된 내역을 저장하겠습니다. 중복·건너뛸 행은 저장 대상에서 제외됩니다.</span>
              </label>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={onClose} className="h-11 rounded-2xl px-5 text-sm font-medium text-muted transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">취소</button>
                <button type="button" disabled={!confirmed} onClick={() => onImport((inputRef.current?.files?.[0]) as File, preview)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-sky-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"><Icon name="upload" size={16} /> 확인 후 저장</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const navItems: { key: ViewKey; label: string; icon: IconName; description: string }[] = [
  { key: "overview", label: "한눈에 보기", icon: "home", description: "월간 흐름과 알림" },
  { key: "transactions", label: "수입·지출", icon: "wallet", description: "거래 내역" },
  { key: "assets", label: "자산", icon: "pie-chart", description: "예금과 투자" },
  { key: "tasks", label: "작업 관리", icon: "briefcase", description: "수입 연결 작업" },
];

function formatRelativeDue(dateValue: string) {
  return relativeDay(dateValue, currentDate());
}

function MiniBar({ value, max, tone = "emerald" }: { value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 4;
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-strong">
      <div className={`h-full rounded-full ${toneClasses(tone)}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function OverviewPanel({
  records,
  tasks,
  month,
  loading,
  onNavigate,
  onAdd,
  onOpenImport,
  onOpenDetail,
}: {
  records: FinanceRecord[];
  tasks: WorkItem[];
  month: string;
  loading: boolean;
  onNavigate: (view: ViewKey) => void;
  onAdd: (kind?: EntryKind) => void;
  onOpenImport: () => void;
  onOpenDetail: (record: FinanceRecord) => void;
}) {
  const sumIncome = (items: FinanceRecord[]) =>
    items.filter((record) => ["salary", "side-income"].includes(record.kind)).reduce((sum, record) => sum + record.amount, 0);
  const sumExpense = (items: FinanceRecord[]) =>
    items.filter((record) => record.kind === "expense").reduce((sum, record) => sum + record.amount, 0);
  const monthRecords = records.filter((record) => record.date.startsWith(month));
  const income = sumIncome(monthRecords);
  const expense = sumExpense(monthRecords);
  const previousMonth = previousMonthOf(month);
  const previousRecords = records.filter((record) => record.date.startsWith(previousMonth));
  const previousNet = sumIncome(previousRecords) - sumExpense(previousRecords);
  const netChange = income - expense - previousNet;
  const assets = records.filter((record) => ["savings", "stock-order"].includes(record.kind));
  const netAssets = totalByCurrency(assets).base;
  const categoryTotals = monthRecords.filter((record) => record.kind === "expense").reduce<Record<string, number>>((result, record) => {
    const category = record.category || "기타";
    result[category] = (result[category] || 0) + record.amount;
    return result;
  }, {});
  const categories = Object.entries(categoryTotals).sort(([, left], [, right]) => right - left).slice(0, 4);
  const maxCategory = categories[0]?.[1] ?? 0;
  const maturities = records.filter((record) => record.kind === "savings" && record.maturityDate && record.status !== "closed").sort((left, right) => (left.maturityDate || "").localeCompare(right.maturityDate || "")).slice(0, 3);
  const ongoing = tasks.filter((task) => task.status === "in-progress" || task.status === "planned" || task.status === "sent").slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {loading ? <><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /></> : <>
          <StatCard label={`${monthText(month)} 수입`} value={compactCurrency(income)} subtext={`${currency(income)} · 전월 대비 확인`} tone="emerald" icon="arrow-up" onClick={() => onNavigate("transactions")} />
          <StatCard label={`${monthText(month)} 지출`} value={compactCurrency(expense)} subtext={`${currency(expense)} · 카테고리별 보기`} tone="rose" icon="arrow-down" onClick={() => onNavigate("transactions")} />
          <StatCard label="전월 대비" value={previousRecords.length ? `${netChange >= 0 ? "+" : "−"}${compactCurrency(Math.abs(netChange))}` : "—"} subtext={previousRecords.length ? `${netChange >= 0 ? "+" : "−"}${currency(Math.abs(netChange))} · ${monthText(previousMonth)} 순현금 ${currency(previousNet)}` : `${monthText(previousMonth)} 기록 없음`} tone={previousRecords.length && netChange < 0 ? "rose" : "sky"} icon="wallet" />
          <StatCard label="순자산 기록" value={compactCurrency(netAssets)} subtext={`${assets.length}개 자산 기록`} tone="violet" icon="pie-chart" onClick={() => onNavigate("assets")} />
        </>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <section className="rounded-3xl border border-line bg-card p-5 sm:p-6">
          <SectionHeading eyebrow="Monthly flow" title="이번 달 흐름" action={<button type="button" onClick={() => onNavigate("transactions")} className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">상세 보기 <Icon name="chevron-right" size={14} /></button>} />
          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_0.9fr] md:items-center">
            <div>
              <div className="flex items-end justify-between gap-4">
                <div><p className="text-xs text-faint">순현금 흐름</p><p className={`mt-1 text-3xl font-semibold tracking-tight ${income - expense >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{income - expense >= 0 ? "+" : "−"}{currency(Math.abs(income - expense))}</p></div>
                <span className="rounded-full bg-card-strong px-2.5 py-1 text-[11px] text-muted">{monthText(month)}</span>
              </div>
              <div className="mt-7 space-y-4">
                <div><div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted"><i className="h-2 w-2 rounded-full bg-emerald-300" />수입</span><span className="font-medium tabular-nums text-body">{currency(income)}</span></div><div className="h-2 overflow-hidden rounded-full bg-card-strong"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${income ? Math.min(100, (income / Math.max(income, expense)) * 100) : 0}%` }} /></div></div>
                <div><div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted"><i className="h-2 w-2 rounded-full bg-rose-300" />지출</span><span className="font-medium tabular-nums text-body">{currency(expense)}</span></div><div className="h-2 overflow-hidden rounded-full bg-card-strong"><div className="h-full rounded-full bg-rose-400" style={{ width: `${expense ? Math.min(100, (expense / Math.max(income, expense)) * 100) : 0}%` }} /></div></div>
              </div>
            </div>
            <div className="rounded-3xl border border-line bg-card-soft p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-medium text-body">지출 카테고리</p><p className="mt-0.5 text-[11px] tabular-nums text-faint">합계 {currency(expense)}</p></div><Icon name="pie-chart" size={16} className="text-faint" /></div>{categories.length ? <div className="mt-4 space-y-3">{categories.map(([category, value], index) => <div key={category}><div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px]"><span className="min-w-0 truncate text-muted">{category}<span className="ml-1.5 tabular-nums text-faint">{expense ? Math.round((value / expense) * 100) : 0}%</span></span><span className="shrink-0 tabular-nums text-body">{currency(value)}</span></div><MiniBar value={value} max={maxCategory} tone={["rose", "amber", "sky", "violet"][index] || "rose"} /></div>)}</div> : <p className="mt-5 text-xs leading-5 text-faint">아직 지출 기록이 없습니다.<br />첫 기록을 추가해보세요.</p>}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-card p-5 sm:p-6">
          <SectionHeading eyebrow="Quick start" title="빠른 기록" />
          <div className="mt-5 grid grid-cols-2 gap-2">
            {(["expense", "salary", "side-income", "savings"] as EntryKind[]).map((kind) => <button key={kind} type="button" onClick={() => onAdd(kind)} className="group flex items-center gap-3 rounded-3xl border border-line bg-card-soft px-3 py-3 text-left transition hover:border-line-strong hover:bg-card-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><span className={`flex h-8 w-8 items-center justify-center rounded-2xl ${toneClasses(entryTones[kind], true)}`}><Icon name={entryIcons[kind]} size={16} /></span><span className="min-w-0"><span className="block truncate text-xs font-medium text-body">{entryLabels[kind]}</span><span className="mt-0.5 block text-[10px] text-faint">바로 입력</span></span></button>)}
          </div>
          <div className="mt-5 border-t border-line pt-5"><button type="button" onClick={onOpenImport} className="flex w-full items-center gap-3 rounded-3xl border border-sky-400/20 bg-sky-500/[0.05] px-4 py-3 text-left transition hover:bg-sky-500/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-200"><Icon name="upload" size={16} /></span><span><span className="block text-xs font-medium text-sky-100">엑셀에서 가져오기</span><span className="mt-0.5 block text-[10px] text-faint">기존 기록을 한 번에 추가</span></span><Icon name="chevron-right" size={15} className="ml-auto text-sky-300/60" /></button></div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-line bg-card p-5 sm:p-6">
          <SectionHeading eyebrow="Maturity watch" title="다가오는 만기" action={<button type="button" onClick={() => onNavigate("assets")} className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-sky-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">자산 보기 <Icon name="chevron-right" size={14} /></button>} />
          <div className="mt-4 space-y-2">{maturities.length ? maturities.map((record) => <button type="button" key={record.id} onClick={() => onOpenDetail(record)} className="flex w-full items-center gap-3 rounded-3xl border border-line bg-card-soft px-3.5 py-3 text-left transition hover:border-amber-300/30 hover:bg-amber-500/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"><span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-200"><Icon name="calendar" size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-body">{record.title}</span><span className="mt-0.5 block text-[11px] text-faint">{dateText(record.maturityDate)} · {formatRelativeDue(record.maturityDate || record.date)}</span></span><span className="text-sm font-medium tabular-nums text-body">{compactCurrency(record.amount)}</span></button>) : <EmptyState icon="calendar" title="예정된 만기가 없습니다" description="예금·적금 기록에 만기일을 입력하면 이곳에서 알려드려요." action={<button type="button" onClick={() => onAdd("savings")} className="rounded-2xl bg-sky-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">자산 기록하기</button>} />}</div>
        </section>
        <section className="rounded-3xl border border-line bg-card p-5 sm:p-6">
          <SectionHeading eyebrow="To do" title="진행 중인 작업" action={<button type="button" onClick={() => onNavigate("tasks")} className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">작업 관리 <Icon name="chevron-right" size={14} /></button>} />
          <div className="mt-4 space-y-2">{ongoing.length ? ongoing.map((task) => <button type="button" key={task.id} onClick={() => onNavigate("tasks")} className="flex w-full items-center gap-3 rounded-3xl border border-line bg-card-soft px-3.5 py-3 text-left transition hover:border-emerald-300/30 hover:bg-emerald-500/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><span className={`flex h-9 w-9 items-center justify-center rounded-2xl ${task.status === "in-progress" ? "bg-sky-500/10 text-sky-200" : "bg-amber-500/10 text-amber-200"}`}><Icon name={task.status === "in-progress" ? "refresh" : "calendar"} size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-body">{task.title}</span><span className="mt-0.5 block truncate text-[11px] text-faint">{[task.dueDate ? `마감 ${dateText(task.dueDate)}` : task.workDate ? dateText(task.workDate) : "", task.amount ? currency(task.amount) : "", task.description ?? ""].filter(Boolean).join(" · ") || "세부 정보 없음"}</span></span><StatusBadge status={task.status} /></button>) : <EmptyState icon="check" title="진행 중인 작업이 없습니다" description="새로운 작업을 추가하면 이곳에서 관리할 수 있어요." />}</div>
        </section>
      </div>
    </div>
  );
}

function TransactionsPanel({
  records,
  month,
  setMonth,
  year,
  setYear,
  onAdd,
  onOpenDetail,
  onOpenImport,
}: {
  records: FinanceRecord[];
  month: string;
  setMonth: (value: string) => void;
  year: string;
  setYear: (value: string) => void;
  onAdd: (kind?: EntryKind) => void;
  onOpenDetail: (record: FinanceRecord) => void;
  onOpenImport: () => void;
}) {
  const [range, setRange] = useState<"month" | "year">("month");
  const [kind, setKind] = useState<"all" | EntryKind>("all");
  const [source, setSource] = useState("전체 출처");
  const [query, setQuery] = useState("");
  const transactionKinds: EntryKind[] = ["expense", "salary", "side-income"];
  const transactionRecords = records.filter((record) => transactionKinds.includes(record.kind));
  const visible = transactionRecords.filter((record) => {
    if (range === "month" ? !record.date.startsWith(month) : !record.date.startsWith(year)) return false;
    if (kind !== "all" && record.kind !== kind) return false;
    if (source !== "전체 출처" && record.source !== source) return false;
    if (query && ![record.title, record.note, record.category, record.source].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const income = visible.filter((record) => record.kind !== "expense").reduce((sum, record) => sum + record.amount, 0);
  const expense = visible.filter((record) => record.kind === "expense").reduce((sum, record) => sum + record.amount, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-2"><p className="text-xs text-emerald-200/70">조회 기간 수입</p><p className="mt-1 text-base font-semibold tabular-nums text-emerald-100">{currency(income)}</p></div>
        <div className="rounded-3xl border border-rose-400/15 bg-rose-500/[0.05] px-4 py-2"><p className="text-xs text-rose-200/70">조회 기간 지출</p><p className="mt-1 text-base font-semibold tabular-nums text-rose-100">{currency(expense)}</p></div>
        <div className="rounded-3xl border border-line bg-card px-4 py-2"><p className="text-xs text-faint">순현금 흐름</p><p className={`mt-1 text-base font-semibold tabular-nums ${income >= expense ? "text-sky-100" : "text-rose-100"}`}>{income >= expense ? "+" : "−"}{currency(Math.abs(income - expense))}</p></div>
      </div>
      <section className="rounded-3xl border border-line bg-card">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:px-5 sm:py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-1 rounded-2xl bg-card-strong p-1" role="group" aria-label="조회 범위">
              <button type="button" onClick={() => setRange("month")} aria-pressed={range === "month"} className={`rounded-xl px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${range === "month" ? "bg-emerald-400/20 text-ink shadow-sm text-ink" : "text-faint hover:text-ink"}`}>월별</button>
              <button type="button" onClick={() => setRange("year")} aria-pressed={range === "year"} className={`rounded-xl px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${range === "year" ? "bg-emerald-400/20 text-ink shadow-sm text-ink" : "text-faint hover:text-ink"}`}>연간</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {range === "month" ? <input aria-label="조회 월" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 rounded-xl border border-line bg-field px-3 text-xs text-body outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15" /> : <select aria-label="조회 연도" value={year} onChange={(event) => setYear(event.target.value)} className="h-9 rounded-xl border border-line bg-field px-3 text-xs text-body outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15"><option>{year}</option><option>{String(Number(year) - 1)}</option><option>{String(Number(year) + 1)}</option></select>}
              <button type="button" onClick={onOpenImport} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-400/20 px-3 text-xs font-medium text-sky-200 transition hover:bg-sky-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="upload" size={14} /> 가져오기</button>
              <button type="button" onClick={() => onAdd("expense")} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"><Icon name="plus" size={14} /> 내역 추가</button>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <label className="relative flex-1"><span className="sr-only">내역 검색</span><Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="내역, 카테고리, 출처 검색" className="h-9 w-full rounded-2xl border border-line bg-field pl-9 pr-3 text-xs text-body outline-none placeholder:text-faint focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15" /></label>
            <div className="flex gap-2"><SelectField compact id="transaction-kind" label="유형" value={kind === "all" ? "전체 유형" : entryLabels[kind]} onChange={(value) => setKind(value === "전체 유형" ? "all" : (Object.keys(entryLabels) as EntryKind[]).find((entryKind) => entryLabels[entryKind] === value) || "all")} options={["전체 유형", ...transactionKinds.map((entryKind) => entryLabels[entryKind])]} /><SelectField compact id="transaction-source" label="출처" value={source} onChange={setSource} options={sourceOptions} /></div>
          </div>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[680px] text-left text-sm"><caption className="sr-only">수입·지출 내역</caption><thead className="border-b border-line text-[11px] text-faint"><tr><th scope="col" className="px-5 py-2.5 font-medium">날짜</th><th scope="col" className="px-3 py-2.5 font-medium">유형</th><th scope="col" className="px-3 py-2.5 font-medium">내역</th><th scope="col" className="px-3 py-2.5 font-medium">출처·수단</th><th scope="col" className="px-3 py-2.5 text-right font-medium">금액</th><th scope="col" className="px-5 py-2.5 text-right font-medium">상세</th></tr></thead><tbody className="divide-y divide-line">{visible.map((record) => <tr key={record.id} className="group transition hover:bg-card-soft"><td className="whitespace-nowrap px-5 py-2 text-xs tabular-nums text-faint">{dateText(record.date)}</td><td className="px-3 py-2"><KindBadge kind={record.kind} /></td><td className="px-3 py-2"><p className="font-medium text-body">{record.title}</p>{categorySubLabel(entryLabels[record.kind], record.category) && <p className="mt-0.5 text-xs text-faint">{categorySubLabel(entryLabels[record.kind], record.category)}</p>}</td><td className="px-3 py-2 text-xs text-muted">{record.source || record.account || "—"}</td><td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${record.kind === "expense" ? "text-rose-200" : "text-emerald-200"}`}>{record.kind === "expense" ? "−" : "+"}{currency(record.amount)}</td><td className="px-5 py-2 text-right"><button type="button" onClick={() => onOpenDetail(record)} className="rounded-xl p-2 text-faint opacity-70 transition hover:bg-card-strong hover:text-ink focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" aria-label={`${record.title} 상세 보기`}><Icon name="more" size={17} /></button></td></tr>)}</tbody></table>
        </div>
        <div className="divide-y divide-line md:hidden">{visible.map((record) => <button type="button" key={record.id} onClick={() => onOpenDetail(record)} className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300"><span className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl ${toneClasses(entryTones[record.kind], true)}`}><Icon name={entryIcons[record.kind]} size={16} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-body">{record.title}</span><span className={`shrink-0 text-sm font-semibold tabular-nums ${record.kind === "expense" ? "text-rose-200" : "text-emerald-200"}`}>{record.kind === "expense" ? "−" : "+"}{currency(record.amount)}</span></span><span className="mt-1 block text-[11px] text-faint">{dateText(record.date)} · {entryLabels[record.kind]}{categorySubLabel(entryLabels[record.kind], record.category) ? ` · ${categorySubLabel(entryLabels[record.kind], record.category)}` : ""}</span></span></button>)}</div>
        {!visible.length && <div className="p-4 sm:p-5"><EmptyState icon="search" title="조건에 맞는 내역이 없습니다" description="조회 기간이나 필터를 바꾸거나, 새 내역을 추가해보세요." action={<button type="button" onClick={() => onAdd("expense")} className="rounded-2xl bg-emerald-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">내역 추가</button>} /></div>}
        <div className="border-t border-line px-4 py-2 text-[11px] text-faint sm:px-5">총 {visible.length}건 · 금액은 원화 기준으로 표시됩니다.</div>
      </section>
    </div>
  );
}

function AssetsPanel({
  records,
  year,
  setYear,
  onAdd,
  onOpenDetail,
}: {
  records: FinanceRecord[];
  year: string;
  setYear: (value: string) => void;
  onAdd: (kind?: EntryKind) => void;
  onOpenDetail: (record: FinanceRecord) => void;
}) {
  const [institution, setInstitution] = useState("전체 기관");
  const [status, setStatus] = useState("전체 상태");
  const assets = records.filter((record) => record.kind === "savings" || record.kind === "stock-order");
  const visible = assets.filter((record) => {
    if (!isAssetInYear({ ...record, recurring: record.kind === "savings" }, year)) return false;
    if (institution !== "전체 기관" && record.institution !== institution) return false;
    if (status !== "전체 상태" && record.status !== status) return false;
    return true;
  });
  const visibleTotals = totalByCurrency(visible);
  const savings = totalByCurrency(visible.filter((record) => record.kind === "savings")).base;
  const stockTotals = totalByCurrency(visible.filter((record) => record.kind === "stock-order"));
  const stocks = stockTotals.base;
  const foreignNote = (foreign: typeof visibleTotals.foreign) =>
    foreign.length ? `${foreign.map((entry) => `${entry.code} ${entry.count}건`).join(" · ")} 별도` : "";
  const totalNote = foreignNote(visibleTotals.foreign);
  const stockNote = foreignNote(stockTotals.foreign);
  const maturities = assets.filter((record) => record.kind === "savings" && record.maturityDate && record.status !== "closed").sort((left, right) => (left.maturityDate || "").localeCompare(right.maturityDate || ""));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-3xl border border-sky-400/15 bg-sky-500/[0.05] p-4"><p className="text-xs text-sky-200/70">기록된 자산</p><p className="mt-2 text-xl font-semibold tabular-nums text-sky-100">{currency(visibleTotals.base)}</p>{totalNote && <p className="mt-1 text-[11px] text-sky-200/70">{totalNote}</p>}</div><div className="rounded-3xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"><p className="text-xs text-emerald-200/70">예금·적금</p><p className="mt-2 text-xl font-semibold tabular-nums text-emerald-100">{currency(savings)}</p></div><div className="rounded-3xl border border-violet-400/15 bg-violet-500/[0.05] p-4"><p className="text-xs text-violet-200/70">주식 주문 누적</p><p className="mt-2 text-xl font-semibold tabular-nums text-violet-100">{currency(stocks)}</p>{stockNote && <p className="mt-1 text-[11px] text-violet-200/70">{stockNote}</p>}</div></div>
      <section className="rounded-3xl border border-line bg-card">
        <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Portfolio</p><h2 className="mt-1 text-lg font-semibold text-ink">자산 목록</h2></div><div className="flex flex-wrap gap-2"><select aria-label="자산 연도" value={year} onChange={(event) => setYear(event.target.value)} className="h-9 rounded-xl border border-line bg-field px-3 text-xs text-body outline-none focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/15"><option>{year}</option><option>{String(Number(year) - 1)}</option><option>{String(Number(year) + 1)}</option></select><button type="button" onClick={() => onAdd("savings")} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-400 px-3 text-xs font-semibold text-slate-950 transition hover:bg-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"><Icon name="plus" size={14} /> 자산 추가</button></div></div><div className="flex flex-wrap items-center gap-2"><SelectField compact="sm" id="asset-institution" label="기관" value={institution} onChange={setInstitution} options={institutionOptions} /><SelectField compact="sm" id="asset-status" label="상태" value={status === "전체 상태" ? "전체 상태" : assetStatusLabels[status as AssetStatus]} onChange={(value) => setStatus(value === "전체 상태" ? "전체 상태" : (Object.keys(assetStatusLabels) as AssetStatus[]).find((assetStatus) => assetStatusLabels[assetStatus] === value) || "전체 상태")} options={["전체 상태", ...Object.values(assetStatusLabels)]} /></div></div>
        <div className="divide-y divide-line">{visible.map((record) => <button type="button" key={record.id} onClick={() => onOpenDetail(record)} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-card-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 sm:px-5"><span className={`flex h-10 w-10 items-center justify-center rounded-3xl ${toneClasses(entryTones[record.kind], true)}`}><Icon name={entryIcons[record.kind]} size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-body">{record.title}</span><span className="mt-1 block truncate text-xs text-faint">{record.institution || "기관 미입력"} · {record.account || record.ticker || entryLabels[record.kind]}</span></span><span className="hidden sm:block">{record.kind === "stock-order" ? record.side && <SideBadge side={record.side} /> : <StatusBadge status={record.status} />}</span><span className="text-right"><span className="block text-sm font-semibold tabular-nums text-ink">{currency(record.amount, record.currency)}</span><span className="mt-1 block text-[11px] text-faint">{record.maturityDate ? `만기 ${dateText(record.maturityDate)}` : dateText(record.date)}</span></span></button>)}{!visible.length && <div className="p-4 sm:p-5"><EmptyState icon="pie-chart" title="조건에 맞는 자산이 없습니다" description="자산 기록을 추가하거나 필터를 조정해보세요." action={<button type="button" onClick={() => onAdd("savings")} className="rounded-2xl bg-sky-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">자산 추가</button>} /></div>}</div>
        <div className="border-t border-line px-4 py-3 text-[11px] text-faint sm:px-5">총 {visible.length}개 · 상세를 누르면 수정·삭제할 수 있습니다.</div>
      </section>
      <section className="rounded-3xl border border-amber-400/15 bg-amber-500/[0.04] p-5 sm:p-6"><SectionHeading eyebrow="Maturity watch" title="만기 일정" /><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{maturities.slice(0, 6).map((record) => <button type="button" key={record.id} onClick={() => onOpenDetail(record)} className="rounded-3xl border border-amber-300/15 bg-card-soft px-3.5 py-3 text-left transition hover:border-amber-300/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-amber-100">{record.title}</span><Icon name="chevron-right" size={14} className="text-amber-200/60" /></div><p className="mt-2 text-xs text-amber-100/60">{dateText(record.maturityDate)} · {formatRelativeDue(record.maturityDate || record.date)}</p></button>)}{!maturities.length && <p className="text-xs text-faint">등록된 만기 일정이 없습니다. 예금·적금에 만기일을 추가해보세요.</p>}</div></section>
    </div>
  );
}

type TaskDraft = {
  title: string;
  workDate: string;
  course: string;
  session: string;
  clientOrSchool: string;
  amount: string;
  sentAt: string;
  note: string;
  sideIncomeTransactionId: string;
  status: WorkStatus;
};

const taskStatusLabels: Record<string, string> = {
  planned: "예정",
  "in-progress": "진행 중",
  completed: "완료",
  sent: "발송",
  paid: "입금 완료",
  todo: "예정",
  done: "완료",
  cancelled: "취소",
};

const taskToDraft = (task: WorkItem): TaskDraft => ({
  title: task.title,
  workDate: task.workDate ?? "",
  course: task.course ?? "",
  session: task.session ?? "",
  clientOrSchool: task.clientOrSchool ?? "",
  amount: task.amount ? String(task.amount) : "",
  sentAt: task.sentAt ?? "",
  note: task.memo ?? task.description ?? "",
  sideIncomeTransactionId: task.sideIncomeTransactionId ?? "",
  status: task.status,
});

function TaskEditModal({
  task,
  sideIncomeRecords,
  saving,
  onClose,
  onSave,
}: {
  task: WorkItem | null;
  sideIncomeRecords: FinanceRecord[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => task ? taskToDraft(task) : { title: "", workDate: currentDate(), course: "", session: "", clientOrSchool: "", amount: "", sentAt: "", note: "", sideIncomeTransactionId: "", status: "planned" });
  const [validationError, setValidationError] = useState("");
  const dialogRef = useDialogFocus(Boolean(task), onClose);

  useEffect(() => {
    if (!task) return;
    /* eslint-disable react-hooks/set-state-in-effect -- sync draft when the selected task changes */
    setDraft(taskToDraft(task));
    setValidationError("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [task]);

  if (!task) return null;
  const update = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setValidationError("");
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setValidationError("작업 이름을 입력해주세요.");
      return;
    }
    onSave(draft);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-edit-title" className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black/50 sm:max-h-[90vh] sm:rounded-3xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-5 sm:px-7"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300/80">작업 상세</p><h2 id="task-edit-title" className="mt-1 text-xl font-semibold text-ink">작업 수정</h2><p className="mt-1 text-xs text-faint">작업 정보와 부수입 연결을 함께 관리합니다.</p></div><button type="button" onClick={onClose} aria-label="작업 수정 닫기" className="rounded-2xl p-2 text-muted hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="close" size={20} /></button></div>
        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><FieldLabel htmlFor="edit-task-title" required>작업 이름</FieldLabel><input id="edit-task-title" value={draft.title} onChange={(event) => update("title", event.target.value)} className={fieldClass} aria-invalid={Boolean(validationError)} aria-describedby={validationError ? "task-validation-error" : undefined} /></div><div><FieldLabel htmlFor="edit-task-date">작업일</FieldLabel><input id="edit-task-date" type="date" value={draft.workDate} onChange={(event) => update("workDate", event.target.value)} className={fieldClass} /></div><div><FieldLabel htmlFor="edit-task-course">과정·과목</FieldLabel><input id="edit-task-course" value={draft.course} onChange={(event) => update("course", event.target.value)} className={fieldClass} placeholder="예: 기초 과정" /></div><div><FieldLabel htmlFor="edit-task-session">회차</FieldLabel><input id="edit-task-session" value={draft.session} onChange={(event) => update("session", event.target.value)} className={fieldClass} placeholder="예: 3회차" /></div><div><FieldLabel htmlFor="edit-task-client">고객·학교</FieldLabel><input id="edit-task-client" value={draft.clientOrSchool} onChange={(event) => update("clientOrSchool", event.target.value)} className={fieldClass} placeholder="예: 고객 또는 학교" /></div><div><FieldLabel htmlFor="edit-task-amount">예상 금액</FieldLabel><input id="edit-task-amount" type="number" min="0" value={draft.amount} onChange={(event) => update("amount", event.target.value)} className={`${fieldClass} text-right tabular-nums`} placeholder="0" /></div><div><FieldLabel htmlFor="edit-task-sent">발송일</FieldLabel><input id="edit-task-sent" type="date" value={draft.sentAt} onChange={(event) => update("sentAt", event.target.value)} className={fieldClass} /></div><div><FieldLabel htmlFor="edit-task-status">상태</FieldLabel><div className="relative"><select id="edit-task-status" value={draft.status} onChange={(event) => update("status", event.target.value as WorkStatus)} className={selectClass}>{(["planned", "in-progress", "completed", "sent", "paid"] as WorkStatus[]).map((status) => <option key={status} value={status} className="bg-surface">{taskStatusLabels[status]}</option>)}</select><Icon name="chevron-down" size={15} className="pointer-events-none absolute right-3 top-[34px] text-faint" /></div></div><div className="sm:col-span-2"><FieldLabel htmlFor="edit-task-link">연결된 부수입 (선택)</FieldLabel><div className="relative"><select id="edit-task-link" value={draft.sideIncomeTransactionId} onChange={(event) => update("sideIncomeTransactionId", event.target.value)} className={selectClass}><option value="" className="bg-surface">연결하지 않음</option>{sideIncomeRecords.map((record) => <option key={record.id} value={record.id} className="bg-surface">{record.title} · {currency(record.amount)}</option>)}</select><Icon name="chevron-down" size={15} className="pointer-events-none absolute right-3 top-[34px] text-faint" /></div></div><div className="sm:col-span-2"><FieldLabel htmlFor="edit-task-note">메모</FieldLabel><textarea id="edit-task-note" rows={3} value={draft.note} onChange={(event) => update("note", event.target.value)} className={`${fieldClass} h-auto resize-none py-3`} placeholder="작업 메모" /></div></div>{validationError && <p id="task-validation-error" role="alert" className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200"><Icon name="info" size={15} />{validationError}</p>}<div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-2xl px-5 text-sm text-muted hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">취소</button><button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-sky-400 px-6 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">{saving && <Icon name="refresh" size={16} className="animate-spin" />}변경 저장</button></div></form>
      </div>
    </div>
  );
}

function TaskDetailModal({
  task,
  onClose,
  onEdit,
  onDelete,
}: {
  task: WorkItem | null;
  onClose: () => void;
  onEdit: (task: WorkItem) => void;
  onDelete: (task: WorkItem) => void;
}) {
  const dialogRef = useDialogFocus(Boolean(task), onClose);
  if (!task) return null;
  const details: [string, string][] = [
    ["상태", taskStatusLabels[task.status] || task.status],
    ["작업일", task.workDate ? dateText(task.workDate) : "미정"],
    ["과정·과목", task.course || "미입력"],
    ["회차", task.session || "미입력"],
    ["고객·학교", task.clientOrSchool || "미입력"],
    ["예상 금액", task.amount ? currency(task.amount) : "미입력"],
    ["발송일", task.sentAt ? dateText(task.sentAt) : "미입력"],
    ["부수입 연결", task.sideIncomeTransactionId ? "연결됨" : "연결하지 않음"],
  ];
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="w-full max-w-lg overflow-hidden rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black/50 sm:rounded-3xl"><div className="flex items-start justify-between border-b border-line px-5 py-5 sm:px-7"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300/80">작업 상세</p><h2 id="task-detail-title" className="mt-2 text-xl font-semibold text-ink">{task.title}</h2><div className="mt-2"><StatusBadge status={task.status} /></div></div><button type="button" onClick={onClose} aria-label="작업 상세 닫기" className="rounded-2xl p-2 text-muted hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="close" size={20} /></button></div><div className="px-5 py-5 sm:px-7"><dl className="divide-y divide-line rounded-3xl border border-line bg-card-soft px-4">{details.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-faint">{label}</dt><dd className="text-right text-body">{value}</dd></div>)}</dl>{(task.memo || task.description) && <p className="mt-4 rounded-3xl bg-card px-4 py-3 text-sm leading-6 text-muted">{task.memo || task.description}</p>}<div className="mt-5 flex gap-2"><button type="button" onClick={() => onDelete(task)} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rose-400/20 px-4 text-sm font-medium text-rose-200 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"><Icon name="trash" size={16} /> 삭제</button><button type="button" onClick={() => onEdit(task)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-card-strong px-4 text-sm font-medium text-ink hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="edit" size={16} /> 수정</button></div></div></div></div>;
}

function TaskDeleteDialog({ task, onClose, onConfirm }: { task: WorkItem | null; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus(Boolean(task), onClose);
  if (!task) return null;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-5 backdrop-blur-sm"><div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="task-delete-title" aria-describedby="task-delete-copy" className="w-full max-w-sm rounded-3xl border border-line-strong bg-surface p-6 shadow-2xl shadow-black/60"><span className="flex h-11 w-11 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-200"><Icon name="trash" size={20} /></span><h2 id="task-delete-title" className="mt-5 text-lg font-semibold text-ink">작업을 삭제할까요?</h2><p id="task-delete-copy" className="mt-2 text-sm leading-6 text-muted"><span className="font-medium text-body">{task.title}</span> 작업과 연결 정보가 삭제됩니다.</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-2xl px-4 text-sm text-muted hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">취소</button><button type="button" onClick={onConfirm} className="h-11 rounded-2xl bg-rose-500 px-5 text-sm font-semibold text-ink hover:bg-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">삭제하기</button></div></div></div>;
}

function TasksPanel({
  tasks,
  sideIncomeRecords,
  saving,
  onStatusChange,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: {
  tasks: WorkItem[];
  sideIncomeRecords: FinanceRecord[];
  saving: boolean;
  onStatusChange: (id: string, status: WorkStatus) => void;
  onCreateTask: (task: Omit<WorkItem, "id">) => void;
  onUpdateTask: (task: WorkItem) => void;
  onDeleteTask: (task: WorkItem) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("전체 상태");
  const [year, setYear] = useState(currentYear());
  const [showForm, setShowForm] = useState(false);
  const [detailTask, setDetailTask] = useState<WorkItem | null>(null);
  const [editingTask, setEditingTask] = useState<WorkItem | null>(null);
  const [deletingTask, setDeletingTask] = useState<WorkItem | null>(null);
  const [draft, setDraft] = useState({ title: "", workDate: currentDate(), course: "", session: "", clientOrSchool: "", amount: "", status: "planned" as WorkStatus });
  const statusOptions: WorkStatus[] = ["planned", "in-progress", "completed", "sent", "paid"];
  const visible = tasks.filter((task) => {
    if (task.workDate && !task.workDate.startsWith(year)) return false;
    if (statusFilter !== "전체 상태" && taskStatusLabels[task.status] !== statusFilter) return false;
    return true;
  });
  const counts = statusOptions.reduce<Record<string, number>>((result, status) => { result[status] = tasks.filter((task) => task.status === status).length; return result; }, {});
  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    onCreateTask({ title: draft.title.trim(), workDate: draft.workDate, course: draft.course.trim() || undefined, session: draft.session.trim() || undefined, clientOrSchool: draft.clientOrSchool.trim() || undefined, amount: Number(draft.amount) || undefined, status: draft.status, description: "작업 메모를 추가하세요." });
    setDraft({ title: "", workDate: currentDate(), course: "", session: "", clientOrSchool: "", amount: "", status: "planned" });
    setShowForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-3xl border border-sky-400/15 bg-sky-500/[0.05] p-4"><p className="text-xs text-sky-200/70">진행 중</p><p className="mt-2 text-xl font-semibold text-sky-100">{(counts["in-progress"] || 0) + (counts.planned || 0)}건</p></div><div className="rounded-3xl border border-violet-400/15 bg-violet-500/[0.05] p-4"><p className="text-xs text-violet-200/70">발송 대기</p><p className="mt-2 text-xl font-semibold text-violet-100">{counts.sent || 0}건</p></div><div className="rounded-3xl border border-emerald-400/15 bg-emerald-500/[0.05] p-4"><p className="text-xs text-emerald-200/70">입금 완료</p><p className="mt-2 text-xl font-semibold text-emerald-100">{counts.paid || 0}건</p></div><div className="rounded-3xl border border-line bg-card p-4"><p className="text-xs text-faint">작업 보수 합계</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{currency(tasks.reduce((sum, task) => sum + (task.amount || 0), 0))}</p></div></div>
      <section className="rounded-3xl border border-line bg-card">
        <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Work board</p><h2 className="mt-1 text-lg font-semibold text-ink">작업 관리</h2><p className="mt-1 text-xs text-faint">작업을 수입 기록과 연결해 정산 흐름을 놓치지 않아요.</p></div><button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"><Icon name="plus" size={14} /> 작업 추가</button></div><div className="flex flex-wrap items-center gap-2"><select aria-label="작업 연도" value={year} onChange={(event) => setYear(event.target.value)} className="h-9 rounded-xl border border-line bg-field px-3 text-xs text-body outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15"><option>{year}</option><option>{String(Number(year) - 1)}</option><option>{String(Number(year) + 1)}</option></select><SelectField compact="sm" id="work-status" label="작업 상태" value={statusFilter} onChange={setStatusFilter} options={["전체 상태", ...statusOptions.map((status) => taskStatusLabels[status])]} /></div></div>
        {showForm && <form onSubmit={createTask} className="grid gap-3 border-b border-line bg-emerald-500/[0.025] p-4 sm:grid-cols-2 sm:p-5"><div className="sm:col-span-2"><FieldLabel htmlFor="task-title" required>작업 이름</FieldLabel><input id="task-title" value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} className={fieldClass} placeholder="예: 강의 자료 정리" /></div><div><FieldLabel htmlFor="task-work-date">작업일</FieldLabel><input id="task-work-date" type="date" value={draft.workDate} onChange={(event) => setDraft((value) => ({ ...value, workDate: event.target.value }))} className={fieldClass} /></div><div><FieldLabel htmlFor="task-course">과정·과목</FieldLabel><input id="task-course" value={draft.course} onChange={(event) => setDraft((value) => ({ ...value, course: event.target.value }))} className={fieldClass} placeholder="예: 기초 과정" /></div><div><FieldLabel htmlFor="task-session">회차</FieldLabel><input id="task-session" value={draft.session} onChange={(event) => setDraft((value) => ({ ...value, session: event.target.value }))} className={fieldClass} placeholder="예: 3회차" /></div><div><FieldLabel htmlFor="task-client">고객·학교</FieldLabel><input id="task-client" value={draft.clientOrSchool} onChange={(event) => setDraft((value) => ({ ...value, clientOrSchool: event.target.value }))} className={fieldClass} placeholder="예: 고객 또는 학교" /></div><div><FieldLabel htmlFor="task-amount">예상 금액</FieldLabel><input id="task-amount" type="number" min="0" value={draft.amount} onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} className={`${fieldClass} text-right tabular-nums`} placeholder="0" /></div><div><SelectField id="task-new-status" label="상태" value={taskStatusLabels[draft.status]} onChange={(value) => setDraft((previous) => ({ ...previous, status: statusOptions.find((status) => taskStatusLabels[status] === value) || "planned" }))} options={statusOptions.map((status) => taskStatusLabels[status])} /></div><div className="flex items-end justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setShowForm(false)} className="h-10 rounded-2xl px-4 text-xs text-muted hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">취소</button><button type="submit" className="h-10 rounded-2xl bg-emerald-400 px-5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">작업 저장</button></div></form>}
        <div className="divide-y divide-line">{visible.map((task) => <div key={task.id} className="flex flex-col gap-3 px-4 py-4 transition hover:bg-card-soft sm:flex-row sm:items-center sm:px-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-3xl bg-sky-500/10 text-sky-200"><Icon name="briefcase" size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium text-body">{task.title}</h3><StatusBadge status={task.status} /></div><p className="mt-1 truncate text-xs text-faint">{[task.course, task.session, task.clientOrSchool].filter(Boolean).join(" · ") || "과정·고객 정보 미입력"}</p><div className="mt-2 flex flex-wrap gap-3 text-[11px] text-faint"><span>{task.workDate ? dateText(task.workDate) : "작업일 미정"}</span>{task.amount ? <span className="tabular-nums text-body">{currency(task.amount)}</span> : null}{task.sentAt ? <span>발송 {dateText(task.sentAt)}</span> : null}{task.sideIncomeTransactionId ? <span className="inline-flex items-center gap-1 text-emerald-300"><Icon name="link" size={12} /> 부수입 연결</span> : null}</div></div><div className="flex items-center gap-2 self-end sm:self-center"><label className="sr-only" htmlFor={`status-${task.id}`}>상태 변경</label><select id={`status-${task.id}`} value={task.status} onChange={(event) => onStatusChange(task.id, event.target.value as WorkStatus)} className="h-9 rounded-xl border border-line bg-field px-2.5 text-xs text-body outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15">{statusOptions.map((status) => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select><button type="button" onClick={() => onStatusChange(task.id, task.status === "completed" ? "paid" : "completed")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs text-body transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"><Icon name="check" size={14} /> {task.status === "paid" ? "완료" : "처리"}</button><button type="button" onClick={() => setDetailTask(task)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs text-body transition hover:bg-card-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="more" size={15} /> 상세</button></div></div>)}{!visible.length && <div className="p-4 sm:p-5"><EmptyState icon="briefcase" title="조건에 맞는 작업이 없습니다" description="작업을 추가하거나 조회 조건을 바꿔보세요." action={<button type="button" onClick={() => setShowForm(true)} className="rounded-2xl bg-emerald-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">작업 추가</button>} /></div>}</div>
        <div className="border-t border-line px-4 py-3 text-[11px] text-faint sm:px-5">총 {visible.length}건 · 상태를 변경하면 바로 저장됩니다.</div>
      </section>
      <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} onEdit={(task) => { setDetailTask(null); setEditingTask(task); }} onDelete={(task) => { setDetailTask(null); setDeletingTask(task); }} />
      <TaskEditModal task={editingTask} sideIncomeRecords={sideIncomeRecords} saving={saving} onClose={() => setEditingTask(null)} onSave={(nextDraft) => { if (!editingTask) return; onUpdateTask({ ...editingTask, title: nextDraft.title.trim(), workDate: nextDraft.workDate || undefined, course: nextDraft.course.trim() || undefined, session: nextDraft.session.trim() || undefined, clientOrSchool: nextDraft.clientOrSchool.trim() || undefined, amount: Number(nextDraft.amount) || undefined, sentAt: nextDraft.sentAt || undefined, memo: nextDraft.note.trim() || undefined, description: nextDraft.note.trim() || undefined, status: nextDraft.status, sideIncomeTransactionId: nextDraft.sideIncomeTransactionId || undefined }); setEditingTask(null); }} />
      <TaskDeleteDialog task={deletingTask} onClose={() => setDeletingTask(null)} onConfirm={() => { if (deletingTask) onDeleteTask(deletingTask); setDeletingTask(null); setDetailTask(null); }} />
    </div>
  );
}

export default function GagebuDashboard() {
  const [repositories] = useState(() => createDataRepositories());

  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [transactions, setTransactions] = useState<DomainTransaction[]>([]);
  const [savingsAccounts, setSavingsAccounts] = useState<SavingsAccount[]>([]);
  const [stockOrders, setStockOrders] = useState<StockOrder[]>([]);
  const [workItems, setWorkItems] = useState<DomainWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FinanceRecord | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(defaultDraft());
  const [detailRecord, setDetailRecord] = useState<FinanceRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<FinanceRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribers: (() => void)[] = [];
    void Promise.all([
      repositories.transactions.subscribe(setTransactions, (repositoryError) => {
        if (active) setError(repositoryError.message);
      }),
      repositories.savingsAccounts.subscribe(setSavingsAccounts, (repositoryError) => {
        if (active) setError(repositoryError.message);
      }),
      repositories.stockOrders.subscribe(setStockOrders, (repositoryError) => {
        if (active) setError(repositoryError.message);
      }),
      repositories.workItems.subscribe(setWorkItems, (repositoryError) => {
        if (active) setError(repositoryError.message);
      }),
    ])
      .then((stops) => {
        if (!active) {
          stops.forEach((stop) => stop());
          return;
        }
        unsubscribers.push(...stops);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "저장된 기록을 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => {
      active = false;
      unsubscribers.forEach((stop) => stop());
    };
  }, [repositories]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const records = useMemo<FinanceRecord[]>(() => {
    const transactionRecords: FinanceRecord[] = transactions.map((transaction) => {
      const incomeSource = transaction.incomeDetails?.source;
      const kind: EntryKind = transaction.type === "expense" ? "expense" : incomeSource === "salary" ? "salary" : incomeSource === "side-income" ? "side-income" : "side-income";
      return {
        id: transaction.id,
        kind,
        title: transaction.memo,
        amount: transaction.amount,
        date: transaction.date,
        category: transaction.category,
        source: transaction.incomeDetails?.employer || transaction.incomeDetails?.payer || transaction.incomeDetails?.sourceName,
        account: transaction.type === "expense" ? undefined : transaction.incomeDetails?.paymentDate,
        note: transaction.incomeDetails?.note,
      };
    });
    const savingsRecords: FinanceRecord[] = savingsAccounts.map((account) => ({
      id: account.id,
      kind: "savings",
      title: account.accountName,
      amount: account.balance ?? account.principal ?? 0,
      date: account.startDate || account.createdAt?.slice(0, 10) || currentDate(),
      institution: account.institution,
      account: account.accountName,
      maturityDate: account.maturityDate,
      assetType: account.assetType,
      monthlyContribution: account.monthlyContribution,
      principal: account.principal,
      balance: account.balance,
      status: savingsStatus(account, currentDate()),
      note: account.memo,
    }));
    const stockRecords: FinanceRecord[] = stockOrders.map((order) => ({
      id: order.id,
      kind: "stock-order",
      title: order.name || `${order.ticker} ${order.side === "buy" ? "매수" : "매도"}`,
      amount: order.totalAmount,
      date: order.orderDate,
      institution: order.broker,
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      principalOrBalance: order.principalOrBalance,
      currency: order.currency,
      status: "active",
      note: order.memo,
    }));
    return [...transactionRecords, ...savingsRecords, ...stockRecords].sort((left, right) => right.date.localeCompare(left.date));
  }, [savingsAccounts, stockOrders, transactions]);

  const existingFingerprints = useMemo(
    () =>
      [...transactions, ...savingsAccounts, ...stockOrders, ...workItems]
        .map((item) => item.fingerprint)
        .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
    [savingsAccounts, stockOrders, transactions, workItems],
  );

  const openAdd = (kind: EntryKind = "expense") => {
    setEditingRecord(null);
    setEntryDraft(defaultDraft(kind));
    setEntryOpen(true);
    setDetailRecord(null);
  };

  const openEdit = (record: FinanceRecord) => {
    setEditingRecord(record);
    setEntryDraft(recordToDraft(record));
    setEntryOpen(true);
    setDetailRecord(null);
  };

  const removeExistingRecord = async (record: FinanceRecord) => {
    if (record.kind === "savings") return repositories.savingsAccounts.remove(record.id);
    if (record.kind === "stock-order") return repositories.stockOrders.remove(record.id);
    return repositories.transactions.remove(record.id);
  };

  const handleSaveDraft = async (draft: EntryDraft) => {
    const amount = draft.kind === "stock-order" ? Number(draft.quantity) * Number(draft.unitPrice) : Number(draft.amount);
    const id = editingRecord?.id || createEntityId(draft.kind === "savings" ? "saving" : draft.kind === "stock-order" ? "order" : "transaction");
    setSaving(true);
    setError("");
    try {
      if (draft.kind === "savings") {
        // Same as the stock branch: the local repository replaces the stored item
        // wholesale, so spread the existing account before the form's own fields.
        await repositories.savingsAccounts.upsert({
          ...savingsAccounts.find((account) => account.id === id),
          id,
          source: "manual",
          institution: draft.institution.trim() || "기관 미입력",
          accountName: draft.account.trim() || draft.title.trim() || "예금·적금",
          assetType: draft.assetType,
          principal: amount,
          balance: draft.balance ? Number(draft.balance) : amount,
          monthlyContribution: draft.monthlyContribution ? Number(draft.monthlyContribution) : undefined,
          startDate: draft.date,
          maturityDate: draft.maturityDate || undefined,
          closedAt:
            draft.status === "closed"
              ? savingsAccounts.find((account) => account.id === id)?.closedAt || currentDate()
              : undefined,
          memo: draft.note.trim() || undefined,
        });
      } else if (draft.kind === "stock-order") {
        // The form does not own every stock-order field (currency, fee), and the
        // local repository replaces the stored item wholesale, so keep the rest.
        await repositories.stockOrders.upsert({
          ...stockOrders.find((order) => order.id === id),
          id,
          source: "manual",
          broker: draft.institution.trim() || undefined,
          ticker: draft.ticker.trim().toUpperCase(),
          name: draft.title.trim() || undefined,
          side: draft.side,
          quantity: Number(draft.quantity),
          unitPrice: Number(draft.unitPrice),
          totalAmount: amount,
          principalOrBalance: draft.principalOrBalance ? Number(draft.principalOrBalance) : undefined,
          orderDate: draft.date,
          memo: draft.note.trim() || undefined,
        });
      } else {
        const isExpense = draft.kind === "expense";
        await repositories.transactions.upsert({
          id,
          source: "manual",
          type: isExpense ? "expense" : "income",
          category: isExpense ? draft.category : draft.kind === "salary" ? "급여" : "부수입",
          amount,
          memo: draft.title.trim() || entryLabels[draft.kind],
          date: draft.date,
          ...(isExpense
            ? { workItemId: undefined }
            : {
                incomeDetails: {
                  source: draft.kind === "salary" ? "salary" : "side-income",
                  employer: draft.kind === "salary" ? draft.source.trim() || undefined : undefined,
                  payer: draft.kind === "side-income" ? draft.source.trim() || undefined : undefined,
                  paymentDate: draft.account.trim() || undefined,
                  note: draft.note.trim() || undefined,
                },
              }),
        });
      }
      if (editingRecord && editingRecord.kind !== draft.kind) await removeExistingRecord(editingRecord);
      setEntryOpen(false);
      setEditingRecord(null);
      setToast(editingRecord ? "내역을 수정했습니다." : "내역을 저장했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "내역을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteRecord) return;
    setSaving(true);
    setError("");
    try {
      await removeExistingRecord(deleteRecord);
      setDeleteRecord(null);
      setDetailRecord(null);
      setToast("내역을 삭제했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "내역을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTask = async (task: Omit<WorkItem, "id">) => {
    setSaving(true);
    try {
      await repositories.workItems.upsert({ id: createEntityId("work"), source: "manual", ...task });
      setToast("작업을 추가했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "작업을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleTaskStatus = async (id: string, status: WorkStatus) => {
    const task = workItems.find((item) => item.id === id);
    if (!task) return;
    setSaving(true);
    try {
      await repositories.workItems.upsert({ ...task, status });
      setToast("작업 상태를 변경했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "작업 상태를 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTask = async (task: WorkItem) => {
    setSaving(true);
    setError("");
    try {
      await repositories.workItems.upsert({ ...task, source: task.source || "manual" });
      setToast("작업을 수정했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "작업을 수정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTask = async (task: WorkItem) => {
    setSaving(true);
    setError("");
    try {
      await repositories.workItems.remove(task.id);
      setToast("작업을 삭제했습니다.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "작업을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (file: File, preview: ImportPreview) => {
    setSaving(true);
    setError("");
    try {
      const result = await importXlsxFile(file, repositories, { existingFingerprints });
      const savedTotal = Object.values(result.saved).reduce((sum, value) => sum + value, 0);
      setImportOpen(false);
      setToast(
        savedTotal
          ? `${savedTotal}건을 저장했습니다${result.skippedExisting ? ` · 중복 ${result.skippedExisting}건 제외` : ""}.`
          : preview.records.length
            ? "새로 저장할 내역이 없습니다. 중복 내역을 확인해보세요."
            : "저장할 데이터 행이 없습니다.",
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "엑셀 내역을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const activeNav = navItems.find((item) => item.key === activeView) || navItems[0];

  return (
    <div className="app-glow relative min-h-screen bg-app text-body selection:bg-emerald-300/30 selection:text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-line bg-surface/85 backdrop-blur-xl lg:flex">
        <div className="flex h-[82px] items-center gap-3 border-b border-line px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/25">
            <Icon name="wallet" size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-ink">가계부</p>
            <p className="text-[10px] text-faint">오늘도 알뜰하게 ✿</p>
          </div>
        </div>
        <nav aria-label="주 메뉴" className="flex-1 px-3 py-6">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Workspace</p>
          <div className="mt-3 space-y-1.5">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                aria-current={activeView === item.key ? "page" : undefined}
                className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
                  activeView === item.key
                    ? "bg-gradient-to-r from-emerald-400/22 to-emerald-400/8 text-emerald-200 shadow-sm"
                    : "text-faint hover:-translate-y-0.5 hover:bg-hover hover:text-body"
                }`}
              >
                <Icon name={item.icon} size={18} />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] text-faint">{item.description}</span>
                </span>
                {activeView === item.key && <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 rounded-2xl bg-card px-3 py-2.5" aria-label="저장 상태">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[11px] text-faint">안전하게 저장됨</span>
          </div>
        </div>
      </aside>

      <div className="relative z-10 lg:pl-[252px]">
        <header className="sticky top-0 z-20 border-b border-line bg-app/80 backdrop-blur-xl">
          <div className="mx-auto flex h-[74px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-7 xl:px-10">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-emerald-500 text-emerald-950 lg:hidden">
                <Icon name="wallet" size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-faint">나의 금융 워크스페이스</p>
                <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-ink">{activeNav.label}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              <label className="hidden items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2 xl:flex">
                <Icon name="calendar" size={15} className="text-faint" />
                <span className="sr-only">기준 월</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="w-[115px] bg-transparent text-xs text-body outline-none"
                />
              </label>
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="hidden h-10 items-center gap-1.5 rounded-2xl border border-sky-400/25 px-3 text-xs font-medium text-sky-200 transition hover:-translate-y-0.5 hover:bg-sky-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:inline-flex"
              >
                <Icon name="upload" size={15} /> 가져오기
              </button>
              <button
                type="button"
                onClick={() => openAdd()}
                className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-300 to-emerald-400 px-4 text-xs font-semibold text-emerald-950 shadow-lg shadow-emerald-500/25 transition hover:-translate-y-0.5 hover:shadow-emerald-500/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              >
                <Icon name="plus" size={15} /> <span className="hidden sm:inline">새 내역</span>
                <span className="sm:hidden">추가</span>
              </button>
              <AuthAccountControls />
            </div>
          </div>
          <nav aria-label="모바일 메뉴" className="flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2 lg:hidden">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                aria-current={activeView === item.key ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
                  activeView === item.key
                    ? "bg-gradient-to-r from-emerald-400/22 to-emerald-400/8 text-emerald-200"
                    : "text-faint hover:bg-hover hover:text-body"
                }`}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 pb-8 pt-4 sm:px-7 sm:pt-5 xl:px-10">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-faint">{activeView === "overview" ? "오늘의 금융 흐름을 가볍게 확인해보세요." : activeNav.description}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{activeNav.label}</h2></div><div className="flex items-center gap-2 sm:hidden"><label className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2.5"><Icon name="calendar" size={15} className="text-faint" /><span className="sr-only">기준 월</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="w-full bg-transparent text-xs text-body outline-none" /></label><button type="button" onClick={() => setImportOpen(true)} aria-label="엑셀 가져오기" className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-400/20 text-sky-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Icon name="upload" size={16} /></button></div></div>
          {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-3xl border border-rose-400/20 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100"><Icon name="info" size={17} className="mt-0.5 text-rose-200" /><div className="flex-1"><p className="font-medium">데이터를 불러오는 중 문제가 생겼습니다.</p><p className="mt-1 text-xs text-rose-100/70">{error}</p></div><button type="button" onClick={() => setError("")} aria-label="오류 닫기" className="rounded-xl p-1 text-rose-200/70 hover:bg-rose-500/10 hover:text-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"><Icon name="close" size={15} /></button></div>}
          {activeView === "overview" && <OverviewPanel records={records} tasks={workItems} month={selectedMonth} loading={loading} onNavigate={setActiveView} onAdd={openAdd} onOpenImport={() => setImportOpen(true)} onOpenDetail={setDetailRecord} />}
          {activeView === "transactions" && <TransactionsPanel records={records} month={selectedMonth} setMonth={setSelectedMonth} year={selectedYear} setYear={setSelectedYear} onAdd={openAdd} onOpenDetail={setDetailRecord} onOpenImport={() => setImportOpen(true)} />}
          {activeView === "assets" && <AssetsPanel records={records} year={selectedYear} setYear={setSelectedYear} onAdd={openAdd} onOpenDetail={setDetailRecord} />}
          {activeView === "tasks" && <TasksPanel tasks={workItems} sideIncomeRecords={records.filter((record) => record.kind === "side-income")} saving={saving} onStatusChange={handleTaskStatus} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} />}
        </main>
      </div>

      {toast && <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-3xl border border-emerald-400/20 bg-surface-strong px-4 py-3 text-sm text-emerald-100 shadow-2xl shadow-black/40"><Icon name="check" size={16} className="text-emerald-300" />{toast}</div>}
      <DetailModal record={detailRecord} onClose={() => setDetailRecord(null)} onEdit={openEdit} onDelete={(record) => setDeleteRecord(record)} />
      <DeleteDialog record={deleteRecord} onClose={() => setDeleteRecord(null)} onConfirm={handleDeleteConfirm} />
      <EntryModal open={entryOpen} initial={entryDraft} editingId={editingRecord?.id} workItems={workItems} saving={saving} onClose={() => { if (!saving) { setEntryOpen(false); setEditingRecord(null); } }} onSave={handleSaveDraft} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} existingFingerprints={existingFingerprints} />
    </div>
  );
}
