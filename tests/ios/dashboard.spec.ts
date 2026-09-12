import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { LOCAL_STORAGE_KEYS } from "../../src/lib/local-repository";
import type { BackupData } from "../../src/lib/backup";

const initial = (): BackupData => ({
  transactions: [],
  savingsAccounts: [{ id: "zero", accountName: "잔액 0 예금", institution: "국민은행", principal: 1_000_000, balance: 0, startDate: "2026-01-01", maturityDate: "2027-01-01" }],
  stockOrders: [{ id: "usd", ticker: "AAPL", name: "미국 주식", broker: "토스증권", side: "buy", quantity: 2, unitPrice: 210, totalAmount: 420, currency: "USD", fee: 1.5, orderDate: "2026-09-03" }],
  workCategories: [{ id: "category_seed_0", name: "교수설계", order: 0 }, { id: "category_seed_1", name: "기타", order: 1 }],
  workItems: [
    { id: "later", title: "다음 달 작업", category: "교수설계", dueDate: "2026-10-01", status: "planned" },
    { id: "soon", title: "가까운 마감 작업", category: "교수설계", dueDate: "2026-09-14", status: "in-progress" },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-12T12:00:00+09:00"));
  await page.addInitScript(({ data, keys }) => {
    if (sessionStorage.getItem("seeded")) return;
    for (const key of Object.keys(keys)) localStorage.setItem(keys[key as keyof typeof keys], JSON.stringify(data[key as keyof typeof data]));
    localStorage.setItem("gagebu:theme", "light");
    sessionStorage.setItem("seeded", "true");
  }, { data: initial(), keys: LOCAL_STORAGE_KEYS });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-storage-mode", "local");
  await expect(page.getByText("기록 조회 완료", { exact: true })).toBeAttached();
});

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

const nav = (page: Page, name: string) => page.locator("nav:visible").getByRole("button", { name: new RegExp(`^${name}`) }).tap();
const stored = <K extends keyof BackupData>(page: Page, key: K): Promise<BackupData[K]> => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), LOCAL_STORAGE_KEYS[key]);
const assetList = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "자산 목록", exact: true }) });
const openAsset = async (page: Page, name: string) => { await nav(page, "자산"); await assetList(page).getByRole("button", { name: new RegExp(name) }).tap(); };

test("touch entry retains the local date and draft after failure, saves once and reloads", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-12-31T15:30:00Z"));
  await page.locator("header").getByRole("button", { name: /^(새 내역|추가)$/ }).tap();
  await expect(page.locator("#entry-date")).toHaveValue("2027-01-01");
  await page.getByLabel("내역 이름").fill("iOS 재시도 지출");
  await page.locator("#entry-amount").fill("12000");
  await page.getByLabel("결제 수단").fill("생활비 카드");
  await page.getByLabel("상점·출처").fill("점심 상점");
  await page.getByLabel("메모", { exact: true }).fill("iOS 보존 메모");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "gagebu:transactions:v2") { Storage.prototype.setItem = original; throw new DOMException("실패 검증", "QuotaExceededError"); }
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "내역 저장", exact: true }).tap();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("내역 이름")).toHaveValue("iOS 재시도 지출");
  await page.screenshot({ path: test.info().outputPath("entry-error.png") });
  await page.getByRole("button", { name: "내역 저장", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload(); await nav(page, "수입·지출");
  await page.getByRole("button", { name: /iOS 재시도 지출/ }).tap();
  await expect(page.getByRole("dialog")).toContainText("iOS 보존 메모");
  await expect(page.getByRole("dialog")).toContainText("생활비 카드");
  const records = await stored(page, "transactions");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ date: "2027-01-01", expenseDetails: { paymentMethod: "생활비 카드", merchant: "점심 상점", note: "iOS 보존 메모" } });
});

test("zero balance, close/reopen and USD survive edits; financial dialogs restore focus", async ({ page }) => {
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "수정", exact: true }).tap();
  await expect(page.getByLabel("현재 잔액")).toHaveValue("0");
  await page.locator("#savings-status").selectOption("종료");
  await page.getByRole("button", { name: "변경 저장", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "savingsAccounts"))[0]).toMatchObject({ balance: 0, closedAt: "2026-09-12" });
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "수정", exact: true }).tap();
  await page.locator("#savings-status").selectOption("운영 중");
  await page.getByRole("button", { name: "변경 저장", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "savingsAccounts"))[0].closedAt).toBeUndefined();
  await openAsset(page, "미국 주식");
  await page.getByRole("button", { name: "수정", exact: true }).tap();
  await expect(page.getByLabel("주문 단가 (USD)")).toHaveValue("210");
  await expect(page.getByRole("dialog")).toContainText("$420.00");
  await page.getByLabel("주문 단가 (USD)").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("foreign-order.png") });
  await page.getByRole("button", { name: "변경 저장", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "stockOrders"))[0]).toMatchObject({ currency: "USD", fee: 1.5, totalAmount: 420 });
  await openAsset(page, "잔액 0 예금");
  await expect.poll(() => page.getByRole("dialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "수정", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "상세 닫기" })).toBeFocused();
  await page.getByRole("button", { name: "상세 닫기" }).tap();
  await expect(assetList(page).getByRole("button", { name: /잔액 0 예금/ })).toBeFocused();
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "삭제", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assetList(page).getByRole("button", { name: /잔액 0 예금/ })).toBeFocused();
});

test("mobile period, task filters, rename links and light/dark layouts remain usable", async ({ page }) => {
  await expect(page.locator('input[type="month"]:visible')).toHaveCount(1);
  await page.locator('input[type="month"]:visible').fill("2026-09");
  await page.screenshot({ path: test.info().outputPath("overview.png"), fullPage: true });
  await nav(page, "작업 관리");
  await page.getByLabel("작업 월", { exact: true }).selectOption({ label: "9월" });
  await page.getByLabel("작업명 검색").fill("가까운");
  await expect(page.locator("main h3")).toHaveText(["가까운 마감 작업"]);
  await page.locator("#work-category").selectOption("교수설계");
  await page.getByRole("button", { name: "카테고리 관리", exact: true }).tap();
  await expect(page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "카테고리 관리 닫기" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("새 카테고리 이름")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "카테고리 관리 닫기" })).toBeFocused();
  await page.locator("#category-name-category_seed_0").fill("온라인 강의");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).first().tap();
  await expect.poll(async () => (await stored(page, "workCategories"))[0].name).toBe("온라인 강의");
  await page.getByRole("button", { name: "카테고리 관리 닫기" }).tap();
  await expect(page.locator("#work-category")).toHaveValue("온라인 강의");
  await expect(page.locator("main h3")).toHaveText(["가까운 마감 작업"]);
  const tooSmall = await page.locator("main button, main select, main input").evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
  }).map(element => element.outerHTML.slice(0, 100)));
  expect(tooSmall).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("tasks.png"), fullPage: true });
  await page.locator("header").getByRole("button", { name: /다크/ }).tap();
  await page.screenshot({ path: test.info().outputPath("tasks-dark.png"), fullPage: true, animations: "disabled" });
});

test("JSON download and additive restore preserve all collections and existing zero balances", async ({ page }) => {
  await page.locator("main").getByRole("button", { name: "백업·복원", exact: true }).tap();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 백업 다운로드" }).tap();
  const download = await pending;
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(Object.keys(data.data).sort()).toEqual(Object.keys(initial()).sort());
  data.data.workItems.push({ id: "restored", title: "iOS 복원 작업", status: "planned", categoryId: "category_seed_0", dueDate: "2026-09-20" });
  await page.locator("#backup-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: test.info().outputPath("backup-preview.png") });
  await page.getByRole("button", { name: "없는 기록만 복원" }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stored(page, "workItems")).toHaveLength(3);
  expect((await stored(page, "savingsAccounts"))[0].balance).toBe(0);
  await page.reload(); await nav(page, "작업 관리");
  await page.getByLabel("작업명 검색").fill("iOS 복원");
  await expect(page.locator("main h3")).toHaveText(["iOS 복원 작업"]);
});

test("XLSX file input shows sample and warnings, then imports twice without duplicates", async ({ page }) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "엑셀 가져오기", exact: true }).tap();
    await page.locator("#workbook-file").setInputFiles("tests/fixtures/review.xlsx");
    if (!attempt) await expect(page.getByRole("dialog")).toContainText("3,000,000");
    await page.getByText(/경고 1건 · 제외 시트 1개 확인/).tap();
    await expect(page.getByRole("dialog")).toContainText("월급 · 4행");
    await expect(page.getByRole("dialog")).toContainText("지원하지 않는 시트");
    await page.getByRole("checkbox").check();
    await page.screenshot({ path: test.info().outputPath(`xlsx-preview-${attempt}.png`) });
    await page.getByRole("button", { name: "확인 후 저장" }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await stored(page, "transactions")).toHaveLength(1);
  }
});
