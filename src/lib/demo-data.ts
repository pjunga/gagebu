/**
 * Dummy dataset for the unlisted /demo page. Everything lives in an in-memory
 * storage, so the demo never reads or writes real localStorage or Firebase.
 * Dates are relative to `today` so the monthly views always have something.
 */

import type {
  SavingsAccount,
  StockOrder,
  Transaction,
  WorkItem,
} from "./domain";
import {
  createLocalRepositories,
  createMemoryStorage,
  LOCAL_STORAGE_KEYS,
} from "./local-repository";
import type { DomainRepositories } from "./repository-types";

export interface DemoDataset {
  transactions: Transaction[];
  savingsAccounts: SavingsAccount[];
  stockOrders: StockOrder[];
  workItems: WorkItem[];
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Returns YYYY-MM for `months` months away from the given date. */
function shiftMonths(iso: string, months: number): string {
  const [year, month] = iso.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const EXPENSES: [daysAgo: number, category: string, memo: string, amount: number][] = [
  [1, "식비", "장보기 · 마트", 68_400],
  [2, "교통", "지하철 정기권", 62_000],
  [3, "식비", "점심 회식", 42_000],
  [5, "문화·여가", "영화 관람", 30_000],
  [6, "식비", "커피 · 디저트", 12_500],
  [9, "주거·관리비", "아파트 관리비", 187_000],
  [12, "쇼핑", "운동화", 129_000],
  [14, "식비", "배달 음식", 27_800],
  [18, "건강·의료", "치과 검진", 55_000],
  [21, "교육", "온라인 강의 구독", 39_000],
  [26, "기타", "경조사비", 100_000],
  [33, "식비", "장보기 · 마트", 74_300],
  [37, "교통", "택시", 18_600],
  [40, "주거·관리비", "아파트 관리비", 181_000],
  [44, "문화·여가", "전시 관람", 25_000],
  [52, "쇼핑", "생활용품", 46_900],
  [58, "식비", "외식", 88_000],
  [66, "건강·의료", "약국", 14_200],
  [71, "주거·관리비", "아파트 관리비", 176_000],
  [75, "교육", "도서 구입", 52_000],
  [88, "식비", "장보기 · 마트", 71_100],
];

export function buildDemoData(today: string): DemoDataset {
  const transactions: Transaction[] = [];

  // Salary lands on the 25th. The current month only counts once payday passed.
  const salaryMonths = [3, 2, 1, 0]
    .map((back) => shiftMonths(today, -back))
    .filter((month) => `${month}-25` <= today);
  for (const month of salaryMonths) {
    transactions.push({
      id: `demo_salary_${month}`,
      source: "manual",
      type: "income",
      category: "급여",
      amount: 3_200_000,
      memo: `${Number(month.slice(5))}월 급여`,
      date: `${month}-25`,
      incomeDetails: {
        source: "salary",
        employer: "한빛교육연구소",
        grossAmount: 3_800_000,
        netAmount: 3_200_000,
        taxAmount: 600_000,
        month,
        paymentDate: `${month}-25`,
        recurring: true,
      },
    });
  }

  for (const [daysAgo, category, memo, amount] of EXPENSES) {
    transactions.push({
      id: `demo_expense_${daysAgo}`,
      source: "manual",
      type: "expense",
      category,
      amount,
      memo,
      date: shiftDays(today, -daysAgo),
    });
  }

  const sideIncome = (
    id: string,
    workItemId: string,
    category: string,
    memo: string,
    amount: number,
    daysAgo: number,
  ): Transaction => {
    const date = shiftDays(today, -daysAgo);
    return {
      id,
      source: "manual",
      type: "income",
      category,
      amount,
      memo,
      date,
      workItemId,
      incomeDetails: {
        source: "side-income",
        sourceName: category,
        month: date.slice(0, 7),
        workItemId,
      },
    };
  };
  transactions.push(
    sideIncome("demo_side_1", "demo_work_1", "교수설계", "초등 과학 3차시 교안", 450_000, 55),
    sideIncome("demo_side_2", "demo_work_4", "위시스프링", "봄 시즌 스티커 3종", 250_000, 38),
    sideIncome("demo_side_3", "demo_work_6", "레미제라블", "찬양팀 악보 편집", 150_000, 25),
    // Paid today so the current month always shows some income.
    sideIncome("demo_side_4", "demo_work_8", "그외", "지인 명함 디자인", 80_000, 0),
  );

  const workItems: WorkItem[] = [
    {
      id: "demo_work_1",
      source: "manual",
      title: "초등 5학년 과학 3차시 교안",
      category: "교수설계",
      course: "초등 과학",
      courseNumber: "SC-2026-03",
      session: "3차시",
      clientOrSchool: "한빛초등학교",
      amount: 450_000,
      status: "paid",
      workDate: shiftDays(today, -70),
      completedAt: shiftDays(today, -66),
      sentAt: shiftDays(today, -65),
      sideIncomeTransactionId: "demo_side_1",
      memo: "검토 의견 반영 후 최종본 발송",
    },
    {
      id: "demo_work_2",
      source: "manual",
      title: "중등 수학 함수 단원 교안",
      category: "교수설계",
      course: "중등 수학",
      courseNumber: "MA-2026-11",
      session: "1~2차시",
      clientOrSchool: "누리중학교",
      amount: 380_000,
      status: "sent",
      workDate: shiftDays(today, -8),
      sentAt: shiftDays(today, -4),
    },
    {
      id: "demo_work_3",
      source: "manual",
      title: "고등 영어 독해 2차시 교안",
      category: "교수설계",
      course: "고등 영어",
      session: "2차시",
      clientOrSchool: "바람고등학교",
      amount: 300_000,
      status: "in-progress",
      workDate: shiftDays(today, -1),
      dueDate: shiftDays(today, 6),
    },
    {
      id: "demo_work_4",
      source: "manual",
      title: "봄 시즌 스티커 3종 디자인",
      category: "위시스프링",
      clientOrSchool: "카페 봄날",
      amount: 250_000,
      status: "paid",
      workDate: shiftDays(today, -45),
      completedAt: shiftDays(today, -40),
      sideIncomeTransactionId: "demo_side_2",
    },
    {
      id: "demo_work_5",
      source: "manual",
      title: "웨딩 앨범 20p 편집",
      category: "위시스프링",
      clientOrSchool: "김서연 고객",
      amount: 600_000,
      status: "completed",
      workDate: shiftDays(today, -12),
      completedAt: shiftDays(today, -2),
      memo: "인쇄소 전달 전 색보정 확인",
    },
    {
      id: "demo_work_6",
      source: "manual",
      title: "찬양팀 악보 편집",
      category: "레미제라블",
      clientOrSchool: "은혜교회",
      amount: 150_000,
      status: "paid",
      workDate: shiftDays(today, -30),
      completedAt: shiftDays(today, -27),
      sideIncomeTransactionId: "demo_side_3",
    },
    {
      id: "demo_work_7",
      source: "manual",
      title: "성탄 공연 포스터",
      category: "레미제라블",
      clientOrSchool: "은혜교회",
      amount: 200_000,
      status: "planned",
      workDate: shiftDays(today, 10),
      dueDate: shiftDays(today, 30),
    },
    {
      id: "demo_work_8",
      source: "manual",
      title: "지인 명함 디자인",
      category: "그외",
      clientOrSchool: "박도윤",
      amount: 80_000,
      status: "paid",
      workDate: shiftDays(today, -15),
      completedAt: shiftDays(today, -13),
      sideIncomeTransactionId: "demo_side_4",
    },
    {
      id: "demo_work_9",
      source: "manual",
      title: "블로그 원고 2편",
      category: "그외",
      clientOrSchool: "로컬 매거진",
      amount: 120_000,
      status: "in-progress",
      priority: "high",
      workDate: shiftDays(today, -3),
      dueDate: shiftDays(today, 4),
    },
  ];

  const savingsAccounts: SavingsAccount[] = [
    {
      id: "demo_savings_1",
      source: "manual",
      institution: "카카오뱅크",
      accountName: "26주 적금",
      assetType: "savings",
      principal: 2_600_000,
      balance: 2_730_000,
      monthlyContribution: 200_000,
      interestRate: 3.5,
      startDate: shiftDays(today, -300),
      maturityDate: shiftDays(today, 20),
    },
    {
      id: "demo_savings_2",
      source: "manual",
      institution: "신한은행",
      accountName: "정기예금 1년",
      assetType: "deposit",
      principal: 10_000_000,
      balance: 10_000_000,
      interestRate: 3.2,
      startDate: shiftDays(today, -150),
      maturityDate: shiftDays(today, 215),
    },
    {
      id: "demo_savings_3",
      source: "manual",
      institution: "토스뱅크",
      accountName: "여행 적금",
      assetType: "savings",
      principal: 1_200_000,
      balance: 1_236_000,
      monthlyContribution: 100_000,
      interestRate: 4,
      startDate: shiftDays(today, -370),
      maturityDate: shiftDays(today, -5),
    },
    {
      id: "demo_savings_4",
      source: "manual",
      institution: "우리은행",
      accountName: "청약 저축",
      assetType: "savings",
      principal: 3_000_000,
      balance: 3_090_000,
      startDate: shiftDays(today, -900),
      maturityDate: shiftDays(today, -120),
      closedAt: shiftDays(today, -118),
      memo: "만기 해지 후 예금으로 이동",
    },
  ];

  const stockOrders: StockOrder[] = [
    {
      id: "demo_stock_1",
      source: "manual",
      broker: "키움증권",
      ticker: "005930",
      name: "삼성전자",
      side: "buy",
      quantity: 10,
      unitPrice: 72_000,
      totalAmount: 720_000,
      orderDate: shiftDays(today, -40),
      currency: "KRW",
    },
    {
      id: "demo_stock_2",
      source: "manual",
      broker: "키움증권",
      ticker: "360750",
      name: "TIGER 미국S&P500",
      side: "buy",
      quantity: 20,
      unitPrice: 18_500,
      totalAmount: 370_000,
      orderDate: shiftDays(today, -25),
      currency: "KRW",
    },
    {
      id: "demo_stock_3",
      source: "manual",
      broker: "키움증권",
      ticker: "005930",
      name: "삼성전자",
      side: "sell",
      quantity: 5,
      unitPrice: 75_000,
      totalAmount: 375_000,
      fee: 560,
      orderDate: shiftDays(today, -10),
      currency: "KRW",
    },
    {
      id: "demo_stock_4",
      source: "manual",
      broker: "토스증권",
      ticker: "AAPL",
      name: "Apple",
      side: "buy",
      quantity: 2,
      unitPrice: 210,
      totalAmount: 420,
      orderDate: shiftDays(today, -3),
      currency: "USD",
    },
  ];

  return { transactions, savingsAccounts, stockOrders, workItems };
}

/** Repositories pre-filled with the dummy dataset, backed by memory only. */
export function createDemoRepositories(
  today = new Date().toISOString().slice(0, 10),
): DomainRepositories {
  const data = buildDemoData(today);
  const storage = createMemoryStorage();
  storage.setItem(LOCAL_STORAGE_KEYS.transactions, JSON.stringify(data.transactions));
  storage.setItem(LOCAL_STORAGE_KEYS.savingsAccounts, JSON.stringify(data.savingsAccounts));
  storage.setItem(LOCAL_STORAGE_KEYS.stockOrders, JSON.stringify(data.stockOrders));
  storage.setItem(LOCAL_STORAGE_KEYS.workItems, JSON.stringify(data.workItems));
  return createLocalRepositories(storage);
}
