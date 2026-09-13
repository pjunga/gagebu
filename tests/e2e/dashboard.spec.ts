import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { LOCAL_STORAGE_KEYS } from "../../src/lib/local-repository";
import type { BackupData } from "../../src/lib/backup";

const initial = (): BackupData => ({
  transactions: [],
  savingsAccounts: [{ id: "zero", accountName: "잔액 0 예금", institution: "국민은행", principal: 1_000_000, balance: 0, startDate: "2026-01-01", maturityDate: "2027-01-01" }],
  stockOrders: [
    { id: "buy", ticker: "TEST", name: "매수", side: "buy", quantity: 10, unitPrice: 10_000, totalAmount: 100_000, orderDate: "2026-09-01" },
    { id: "sell", ticker: "TEST", name: "매도", side: "sell", quantity: 10, unitPrice: 10_000, totalAmount: 100_000, orderDate: "2026-09-02" },
    { id: "usd", ticker: "AAPL", name: "미국 주식", broker: "토스증권", side: "buy", quantity: 2, unitPrice: 210, totalAmount: 420, currency: "USD", fee: 1.5, orderDate: "2026-09-03" },
  ],
  workCategories: [{ id: "category_seed_0", name: "교수설계", order: 0 }, { id: "category_seed_1", name: "기타", order: 1 }],
  workItems: [
    { id: "later", title: "다음 달 작업", category: "교수설계", dueDate: "2026-10-01", status: "planned" },
    { id: "legacy", title: "지난 마감 작업", workDate: "2026-09-01", status: "done", course: "숨겨진 과목", amount: 0 },
    { id: "soon", title: "가까운 마감 작업", category: "교수설계", dueDate: "2026-09-14", status: "in-progress" },
  ],
});
async function load(page: Page, data = initial()) {
  await page.clock.setFixedTime(new Date("2026-09-12T12:00:00+09:00"));
  await page.addInitScript(({ data, keys }) => {
    if (sessionStorage.getItem("seeded")) return;
    for (const key of Object.keys(keys)) localStorage.setItem(keys[key as keyof typeof keys], JSON.stringify(data[key as keyof typeof data]));
    localStorage.setItem("gagebu:theme", "light");
    sessionStorage.setItem("seeded", "true");
  }, { data, keys: LOCAL_STORAGE_KEYS });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-storage-mode", "local");
  await expect(page.getByText("기록 조회 완료", { exact: true })).toBeAttached();
}
const nav = (page: Page, name: string) => page.locator("nav:visible").getByRole("button", { name: new RegExp(`^${name}`) }).click();
const stored = <K extends keyof BackupData>(page: Page, key: K): Promise<BackupData[K]> => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), LOCAL_STORAGE_KEYS[key]);
const assetList = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "자산 목록", exact: true }) });
const openAsset = async (page: Page, name: string) => { await nav(page, "자산"); await assetList(page).getByRole("button", { name: new RegExp(name) }).click(); };

test("expense inputs survive save, reload, edit and clear", async ({ page }) => {
  await load(page);
  await page.locator("header").getByRole("button", { name: "새 내역", exact: true }).click();
  await page.getByLabel("내역 이름").fill("점심 검토");
  await page.locator("#entry-amount").fill("12000");
  await page.getByLabel("결제 수단").fill("생활비 카드");
  await page.getByLabel("상점·출처").fill("점심 상점");
  await page.getByLabel("메모", { exact: true }).fill("보존할 메모");
  await page.getByRole("button", { name: "내역 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await nav(page, "수입·지출");
  await page.getByRole("button", { name: "점심 검토 상세 보기" }).click();
  await expect(page.getByRole("dialog")).toContainText("보존할 메모");
  await expect(page.getByRole("dialog")).toContainText("생활비 카드");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("상점·출처")).toHaveValue("점심 상점");
  await page.getByLabel("메모", { exact: true }).fill("");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const records = await stored(page, "transactions");
  expect(records).toHaveLength(1);
  expect(records[0].expenseDetails).toEqual({ paymentMethod: "생활비 카드", merchant: "점심 상점" });
});

test("zero balance survives unchanged save and closing/reopening; foreign inputs retain currency", async ({ page }) => {
  await load(page);
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("현재 잔액")).toHaveValue("0");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "savingsAccounts"))[0].balance).toBe(0);
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#savings-status").selectOption("종료");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "savingsAccounts"))[0].closedAt).toBe("2026-09-12");
  await openAsset(page, "잔액 0 예금");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#savings-status").selectOption("운영 중");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "savingsAccounts"))[0].closedAt).toBeUndefined();
  await openAsset(page, "미국 주식");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("주문 단가 (USD)")).toHaveValue("210");
  await expect(page.getByRole("dialog")).toContainText("$420.00");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page, "stockOrders")).find(item => item.id === "usd")).toMatchObject({ currency: "USD", fee: 1.5, totalAmount: 420 });
});

test("failed category rename retains names and draft, retry keeps links across tabs/reload", async ({ page, context }) => {
  await load(page);
  const second = await context.newPage(); await second.goto("/");
  await nav(page, "작업 관리");
  await page.locator("#work-category").selectOption("교수설계");
  await page.getByRole("button", { name: "카테고리 관리", exact: true }).click();
  await page.locator("#category-name-category_seed_0").fill("온라인 강의");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "gagebu:work-items:v1") { Storage.prototype.setItem = original; throw new DOMException("실패 검증", "QuotaExceededError"); }
      return original.call(this, key, value);
    };
  });
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect((await stored(page, "workCategories"))[0].name).toBe("교수설계");
  await expect(page.locator("#category-name-category_seed_0")).toHaveValue("온라인 강의");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).first().click();
  await expect.poll(async () => (await stored(page, "workCategories"))[0].name).toBe("온라인 강의");
  await page.getByRole("button", { name: "카테고리 관리 닫기" }).click();
  await expect(page.locator("#work-category")).toHaveValue("온라인 강의");
  await expect(page.locator("main h3")).toHaveCount(3);
  await page.getByRole("button", { name: "상세", exact: true }).first().click();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#edit-task-title").fill("편집 중인 제목 유지");
  await nav(second, "작업 관리");
  await second.getByRole("button", { name: "카테고리 관리", exact: true }).click();
  await second.locator("#category-name-category_seed_0").fill("기기 간 이름");
  await second.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.locator("#edit-task-category")).toHaveValue("기기 간 이름");
  await expect(page.locator("#edit-task-title")).toHaveValue("편집 중인 제목 유지");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await second.reload(); await nav(second, "작업 관리");
  await expect(second.locator("#work-category option")).toContainText(["전체 카테고리", "기기 간 이름", "기타"]);
  expect((await stored(page, "workItems")).find(item => item.id === "legacy")).toMatchObject({ course: "숨겨진 과목", status: "done", amount: 0, categoryId: "category_seed_0" });
});

test("failed entry save keeps the draft and shows the error inside the dialog; retry creates once", async ({ page }) => {
  await load(page);
  await page.locator("header").getByRole("button", { name: "새 내역", exact: true }).click();
  await page.getByLabel("내역 이름").fill("재시도 지출"); await page.locator("#entry-amount").fill("3000");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === "gagebu:transactions:v2") { Storage.prototype.setItem = original; throw new DOMException("실패 검증", "QuotaExceededError"); } return original.call(this, key, value); };
  });
  await page.getByRole("button", { name: "내역 저장", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("내역 이름")).toHaveValue("재시도 지출");
  await expect(page.getByText("저장 확인 필요", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "내역 저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stored(page, "transactions")).toHaveLength(1);
});

test("mobile entry saves and reloads at 320, 390 and 768px using the local New Year date", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await page.clock.setFixedTime(new Date("2026-12-31T15:30:00Z"));
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("header").getByRole("button", { name: /^(새 내역|추가)$/ }).click();
    await expect(page.locator("#entry-date")).toHaveValue("2027-01-01");
    await page.getByLabel("내역 이름").fill(`모바일 지출 ${width}`);
    await page.locator("#entry-amount").fill("3000");
    await page.getByLabel("결제 수단").fill("현금");
    await page.getByLabel("메모", { exact: true }).fill("모바일 메모");
    await page.screenshot({ path: test.info().outputPath(`entry-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "내역 저장", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload(); await nav(page, "수입·지출");
    await page.getByRole("button", { name: new RegExp(`모바일 지출 ${width}`) }).click();
    await expect(page.getByRole("dialog")).toContainText("모바일 메모");
    await expect(page.getByRole("dialog")).toContainText("현금");
    await page.getByRole("button", { name: "상세 닫기" }).click();
  }
  expect(await stored(page, "transactions")).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("overview amounts and deadline order are meaningful; institutions use actual data", async ({ page }) => {
  await load(page);
  const tile = page.getByRole("button", { name: /현재 예금·적금 잔액/ });
  await expect(tile).toContainText("₩0");
  await expect(page.getByText("순자산 기록", { exact: true })).toHaveCount(0);
  const titles = await page.locator("section").filter({ hasText: "진행 중인 작업" }).locator("button").allTextContents();
  expect(titles.findIndex(title => title.includes("지난 마감 작업"))).toBeLessThan(titles.findIndex(title => title.includes("다음 달 작업")));
  await nav(page, "자산");
  await page.getByLabel("기관", { exact: true }).selectOption("국민은행");
  await expect(assetList(page).getByRole("button", { name: /잔액 0 예금/ })).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: /미국 주식/ })).toHaveCount(0);
  await nav(page, "작업 관리");
  await page.getByLabel("작업명 검색").fill("가까운");
  await expect(page.locator("main h3")).toHaveText(["가까운 마감 작업"]);
  await page.getByLabel("작업 월", { exact: true }).selectOption("10");
  await expect(page.locator("main h3")).toHaveText(["조건에 맞는 작업이 없습니다"]);
});

test("month controls and touch targets work at 320, 390, 768 and desktop widths", async ({ page }) => {
  await load(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await nav(page, "한눈에 보기");
    await expect(page.locator('input[type="month"]:visible')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`overview-${width}.png`), fullPage: true });
    await nav(page, "작업 관리");
    await expect(page.locator('input[type="month"]:visible')).toHaveCount(0);
    await expect(page.getByLabel("작업 월", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`tasks-${width}.png`), fullPage: true });
    const clippedFilters = await page.locator("#work-status, #work-category").evaluateAll(elements => elements.filter(element => {
      const select = element as HTMLSelectElement;
      const style = getComputedStyle(select);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = style.font;
      return context.measureText(select.selectedOptions[0].text).width > select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }).map(element => element.id));
    expect(clippedFilters).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 1024) {
      const tooSmall = await page.locator("main button, main select, main input").evaluateAll(elements => elements.filter(element => {
        const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      }).map(element => element.outerHTML.slice(0, 100)));
      expect(tooSmall).toEqual([]);
    }
  }
  await page.locator("header").getByRole("button", { name: /다크/ }).click();
  await page.screenshot({ path: test.info().outputPath("tasks-dark.png"), fullPage: true, animations: "disabled" });
});

test("detail and delete dialogs contain focus and return it to the opener", async ({ page }) => {
  await load(page); await openAsset(page, "잔액 0 예금");
  const opener = assetList(page).getByRole("button", { name: /잔액 0 예금/ });
  await expect.poll(() => page.getByRole("dialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "수정", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "상세 닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect.poll(() => page.getByRole("alertdialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("backup download contains all collections and restore adds only missing records", async ({ page }) => {
  await load(page);
  await page.locator("aside").getByRole("button", { name: "백업·복원", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 백업 다운로드" }).click();
  const download = await pending;
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(Object.keys(data.data).sort()).toEqual(Object.keys(initial()).sort());
  data.data.workItems.push({ id: "restored", title: "백업 추가 작업", status: "planned", categoryId: "category_seed_0", dueDate: "2026-09-20" });
  await page.locator("#backup-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByRole("dialog").getByText("추가", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "없는 기록만 복원" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stored(page, "workItems")).toHaveLength(4);
  expect((await stored(page, "savingsAccounts"))[0].balance).toBe(0);
  await nav(page, "작업 관리");
  await page.getByLabel("작업명 검색").fill("백업 추가");
  await expect(page.locator("main h3")).toHaveText(["백업 추가 작업"]);
});

test("XLSX preview shows sample rows and row/sheet warnings; repeat import skips duplicates", async ({ page }) => {
  await load(page);
  await page.locator("header").getByRole("button", { name: "가져오기", exact: true }).click();
  await page.locator("#workbook-file").setInputFiles("tests/fixtures/review.xlsx");
  await expect(page.getByRole("dialog")).toContainText("3,000,000");
  await page.getByText(/경고 1건 · 제외 시트 1개 확인/).click();
  await expect(page.getByRole("dialog")).toContainText("월급 · 4행");
  await expect(page.getByRole("dialog")).toContainText("지원하지 않는 시트");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "확인 후 저장" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stored(page, "transactions")).toHaveLength(1);
  await page.locator("header").getByRole("button", { name: "가져오기", exact: true }).click();
  await page.locator("#workbook-file").setInputFiles("tests/fixtures/review.xlsx");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "확인 후 저장" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stored(page, "transactions")).toHaveLength(1);
});

test("수입 유형은 저장·재조회되고 주식 주문은 새로 만들 수 없다", async ({ page }) => {
  await load(page);
  await page.locator("header").getByRole("button", { name: "새 내역", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "주식 주문", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "수입", exact: true }).click();
  await page.getByLabel("내역 이름").fill("용돈 받음");
  await page.locator("#entry-amount").fill("50000");
  await page.getByLabel("수입원").fill("부모님");
  await page.getByRole("button", { name: "내역 저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const records = await stored(page, "transactions");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ type: "income", category: "수입", amount: 50_000 });
  expect(records[0].incomeDetails).toMatchObject({ source: "other", payer: "부모님" });
  await page.reload();
  await nav(page, "수입·지출");
  await page.getByRole("button", { name: "용돈 받음 상세 보기" }).click();
  await expect(page.getByRole("dialog")).toContainText("수입");
});
