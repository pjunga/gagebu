"use client";

import { useEffect, useMemo, useState } from "react";

type Transaction = {
  id: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  memo: string;
  date: string;
};

const STORAGE_KEY = "gagebu:transactions";
const incomeCategories = ["급여", "보너스", "용돈", "기타 수입"];
const expenseCategories = [
  "식비",
  "교통",
  "주거/관리비",
  "문화/여가",
  "쇼핑",
  "기타 지출",
];

const formatCurrency = (value: number) =>
  value.toLocaleString("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  });

const todayISO = () => new Date().toISOString().slice(0, 10);

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(todayISO().slice(0, 7));
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [entry, setEntry] = useState({
    type: "expense" as Transaction["type"],
    category: expenseCategories[0],
    amount: "",
    memo: "",
    date: todayISO(),
  });

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed: Transaction[] = (() => {
      if (!stored) return [];
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    })();

    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate once from localStorage on mount
    setTransactions(parsed);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions, hydrated]);

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((item) => {
        if (!selectedMonth) return true;
        return item.date.startsWith(selectedMonth);
      }),
    [transactions, selectedMonth],
  );

  const totals = useMemo(() => {
    return filteredTransactions.reduce(
      (acc, cur) => {
        if (cur.type === "income") {
          acc.income += cur.amount;
        } else {
          acc.expense += cur.amount;
        }
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [filteredTransactions]);

  const balance = totals.income - totals.expense;
  const monthLabel = new Date(`${selectedMonth}-01`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountValue = Number(entry.amount);
    if (!amountValue || amountValue <= 0) {
      setError("금액을 0보다 크게 입력해주세요.");
      return;
    }

    const nextItem: Transaction = {
      id: createId(),
      type: entry.type,
      category: entry.category,
      amount: amountValue,
      memo: entry.memo.trim() || (entry.type === "income" ? "수입" : "지출"),
      date: entry.date || todayISO(),
    };

    setTransactions((prev) => [nextItem, ...prev]);
    setEntry((prev) => ({
      ...prev,
      amount: "",
      memo: "",
    }));
    setError("");
  };

  const handleDelete = (id: string) => {
    setTransactions((prev) => prev.filter((item) => item.id !== id));
  };

  const handleTypeChange = (type: Transaction["type"]) => {
    setEntry((prev) => ({
      ...prev,
      type,
      category: (type === "income" ? incomeCategories : expenseCategories)[0],
    }));
  };

  const categories = entry.type === "income" ? incomeCategories : expenseCategories;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 pb-16 pt-14 sm:px-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-300">우리집 가계부</p>
            <h1 className="text-3xl font-semibold sm:text-4xl">이번 달 흐름을 한눈에</h1>
            <p className="text-sm text-slate-300">수입·지출을 기록하고 잔액을 바로 확인하세요.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
            <label className="text-sm text-slate-200" htmlFor="month">
              조회 월
            </label>
            <input
              id="month"
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/60"
            />
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-5 shadow-lg shadow-emerald-500/5">
            <p className="text-sm text-slate-300">{monthLabel} 수입</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-300">
              {formatCurrency(totals.income)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-5 shadow-lg shadow-rose-500/5">
            <p className="text-sm text-slate-300">{monthLabel} 지출</p>
            <p className="mt-2 text-2xl font-semibold text-rose-300">
              {formatCurrency(totals.expense)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-5 shadow-lg shadow-indigo-500/5">
            <p className="text-sm text-slate-300">남은 잔액</p>
            <p
              className={`mt-2 text-2xl font-semibold ${
                balance >= 0 ? "text-emerald-200" : "text-rose-200"
              }`}
            >
              {formatCurrency(balance)}
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">내역 추가</h2>
              <div className="flex gap-2 rounded-full bg-white/10 p-1">
                <button
                  type="button"
                  onClick={() => handleTypeChange("expense")}
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    entry.type === "expense"
                      ? "bg-rose-500 text-white shadow-md shadow-rose-500/30"
                      : "text-slate-200 hover:bg-white/10"
                  }`}
                >
                  지출
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange("income")}
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    entry.type === "income"
                      ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                      : "text-slate-200 hover:bg-white/10"
                  }`}
                >
                  수입
                </button>
              </div>
            </div>

            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="text-sm text-slate-200" htmlFor="amount">
                  금액
                </label>
                <input
                  id="amount"
                  type="number"
                  min={0}
                  value={entry.amount}
                  onChange={(event) =>
                    setEntry((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  placeholder="금액을 입력하세요"
                  className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-lg outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/60"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-slate-200" htmlFor="category">
                  카테고리
                </label>
                <select
                  id="category"
                  value={entry.category}
                  onChange={(event) =>
                    setEntry((prev) => ({ ...prev, category: event.target.value }))
                  }
                  className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/60"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-slate-200" htmlFor="date">
                  날짜
                </label>
                <input
                  id="date"
                  type="date"
                  value={entry.date}
                  onChange={(event) =>
                    setEntry((prev) => ({ ...prev, date: event.target.value }))
                  }
                  className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/60"
                />
              </div>

              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="text-sm text-slate-200" htmlFor="memo">
                  메모
                </label>
                <input
                  id="memo"
                  type="text"
                  value={entry.memo}
                  onChange={(event) =>
                    setEntry((prev) => ({ ...prev, memo: event.target.value }))
                  }
                  placeholder="예) 점심 식사, 월급, 관리비 등"
                  className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/60"
                />
              </div>

              {error && (
                <p className="sm:col-span-2 text-sm font-medium text-rose-200">{error}</p>
              )}

              <button
                type="submit"
                className="sm:col-span-2 rounded-xl bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                내역 저장
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">이번 달 기록</h2>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">
                {filteredTransactions.length}건
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredTransactions.length === 0 && (
                <p className="text-sm text-slate-300">아직 기록이 없습니다. 먼저 추가해보세요.</p>
              )}

              {filteredTransactions.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div
                    className={`mt-1 h-10 w-10 shrink-0 rounded-full text-sm font-semibold text-slate-950 ${
                      item.type === "income"
                        ? "bg-emerald-300 text-emerald-900"
                        : "bg-rose-300 text-rose-900"
                    } flex items-center justify-center`}
                  >
                    {item.type === "income" ? "수입" : "지출"}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-base font-semibold text-white">{item.memo}</p>
                      <p
                        className={`text-sm font-semibold ${
                          item.type === "income" ? "text-emerald-200" : "text-rose-200"
                        }`}
                      >
                        {item.type === "income" ? "+" : "-"}
                        {formatCurrency(item.amount)}
                      </p>
                    </div>
                    <p className="text-sm text-slate-300">
                      {item.category} ·{" "}
                      {new Date(item.date).toLocaleDateString("ko-KR", {
                        month: "long",
                        day: "numeric",
                        weekday: "short",
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 transition hover:bg-rose-500 hover:text-white hover:shadow-md hover:shadow-rose-500/30"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
