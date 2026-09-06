/*
 * Mobile layout audit — paste into the browser console, do not run with node.
 *
 * 1. pnpm dev
 * 2. Open http://localhost:3000 and paste this whole file into the console.
 * 3. await mobileAudit()
 *
 * The app is loaded into an iframe of the width being measured: resizing the
 * window does not change the viewport in every automation host, and an iframe
 * gets its own. Everything is measured through the iframe's own window, and the
 * page must be same-origin for that, hence localhost to localhost.
 *
 * Not wired into CI and needs no dependencies. It reports; it decides nothing.
 *
 * Fixed seed: 3 transactions (식비 15,000 / 주거·관리비 1,250,000 / 급여
 * 3,200,000 imported), 1 savings account maturing 2026-09-20, 1 USD stock
 * order, 1 work item. Wording length depends on the data, so the numbers below
 * only compare against each other with this seed in place.
 */

const SEED = {
  transactions: [
    { id: "t1", source: "manual", type: "expense", category: "식비", amount: 15000, memo: "점심 도시락", date: "2026-09-05" },
    { id: "t2", source: "manual", type: "expense", category: "주거·관리비", amount: 1250000, memo: "월세", date: "2026-09-01" },
    { id: "t3", source: "import", fingerprint: "fp1", type: "income", category: "급여", amount: 3200000, memo: "9월 급여", date: "2026-09-05",
      incomeDetails: { source: "salary", employer: "테스트 회사", grossAmount: 3600000, netAmount: 3200000, month: "2026-09" } },
  ],
  savingsAccounts: [
    { id: "s1", source: "manual", institution: "저축 은행", accountName: "정기적금", assetType: "savings", principal: 3000000, balance: 3120000, monthlyContribution: 250000, startDate: "2026-01-05", maturityDate: "2026-09-20" },
  ],
  stockOrders: [
    { id: "o1", source: "manual", broker: "증권사", ticker: "AAPL", name: "애플", side: "buy", quantity: 5, unitPrice: 243.5, totalAmount: 1217.5, orderDate: "2026-09-02", currency: "USD" },
  ],
  workItems: [
    { id: "w1", source: "manual", title: "강의 자료 정리", workDate: "2026-09-08", status: "in-progress", amount: 300000, description: "기초 과정 3회차" },
  ],
};

const WIDTHS = [320, 360, 390, 414, 430];
const VIEWS = ["한눈에 보기", "수입·지출", "자산", "작업 관리"];
const MIN_TARGET = 44;

/** Selector + why, so an exception is a decision on the record rather than a judgement call. */
const TARGET_ALLOWLIST = [];

function applySeed(seed = SEED) {
  localStorage.setItem("gagebu:transactions:v2", JSON.stringify(seed.transactions));
  localStorage.setItem("gagebu:savings-accounts:v1", JSON.stringify(seed.savingsAccounts));
  localStorage.setItem("gagebu:stock-orders:v1", JSON.stringify(seed.stockOrders));
  localStorage.setItem("gagebu:work-items:v1", JSON.stringify(seed.workItems));
}

/** A stalled measurement must surface as a failure, never as a run that never ends. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: ${ms}ms 안에 끝나지 않음`)), ms); }),
  ]);
}

async function probe(width, read, height = 780) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0";
  host.innerHTML = `<iframe src="${location.origin}" style="width:${width}px;height:${height}px;border:0"></iframe>`;
  document.body.appendChild(host);
  const frame = host.querySelector("iframe");
  try {
    await withTimeout(new Promise((resolve) => { frame.onload = resolve; }), 15000, `${width}px iframe 로드`);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      if (doc.querySelector("main") && /₩/.test(doc.body.innerText)) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`${width}px: 앱이 8초 안에 데이터를 렌더하지 못함`);
    // A desktop scrollbar would make the viewport narrower than the phone's.
    doc.head.insertAdjacentHTML("beforeend", "<style>html{scrollbar-width:none}</style>");
    await new Promise((resolve) => setTimeout(resolve, 150));
    return await read(doc, win);
  } finally {
    host.remove();
  }
}

async function gotoView(doc, label) {
  const tab = [...doc.querySelectorAll('nav[aria-label="모바일 메뉴"] button, aside button')]
    .find((button) => button.innerText.trim().startsWith(label));
  tab?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return Boolean(tab);
}

const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const describe = (el) => (el.getAttribute("aria-label") || el.innerText || el.id || el.type || el.tagName).trim().replace(/\s+/g, " ").slice(0, 24);
const lineCount = (el) => {
  const styles = getComputedStyle(el);
  const line = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.4;
  return Math.round(el.scrollHeight / line);
};

/** offsetParent is null for anything inside a fixed header, so visibility is read from rects. */
function smallTargets(doc) {
  return [...doc.querySelectorAll("button, a, select, input")]
    .filter(isVisible)
    .filter((el) => !TARGET_ALLOWLIST.some((rule) => el.matches(rule.selector)))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { label: describe(el), height: Math.round(rect.height), width: Math.round(rect.width) };
    })
    .filter((target) => target.height < MIN_TARGET || target.width < MIN_TARGET);
}

function navCheck(doc, win) {
  const nav = doc.querySelector('nav[aria-label="모바일 메뉴"]');
  if (!nav) return { present: false };
  const tabs = [...nav.querySelectorAll("button")];
  const labelOf = (tab) => tab.querySelector("span") || tab;
  return {
    present: true,
    fits: nav.scrollWidth <= nav.clientWidth + 1,
    scrollWidth: nav.scrollWidth,
    cutOff: tabs.filter((tab) => tab.getBoundingClientRect().right > win.innerWidth + 1).map((tab) => tab.innerText.trim()),
    ellipsis: tabs.filter((tab) => labelOf(tab).scrollWidth > labelOf(tab).clientWidth + 1).map((tab) => tab.innerText.trim()),
    wrapped: tabs.filter((tab) => lineCount(labelOf(tab)) > 1).map((tab) => tab.innerText.trim()),
    activeMarked: tabs.some((tab) => tab.getAttribute("aria-current") === "page"),
    minHeight: Math.min(...tabs.map((tab) => Math.round(tab.getBoundingClientRect().height))),
  };
}

function statCardCheck(doc) {
  const grid = [...doc.querySelectorAll("main div")].find(
    (el) => /grid-cols-2/.test(el.className || "") && /수입[\s\S]*지출[\s\S]*전월 대비[\s\S]*순자산/.test(el.innerText || ""),
  );
  if (!grid) return { found: false };
  const cards = [...grid.children];
  const heights = cards.map((card) => Math.round(card.getBoundingClientRect().height));
  const texts = cards.flatMap((card) => [...card.querySelectorAll("p")].map((p) => ({ text: (p.textContent || "").trim().slice(0, 26), lines: lineCount(p), clipped: p.scrollWidth > p.clientWidth + 1 })));
  return {
    found: true,
    heights,
    spread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
    multiline: texts.filter((text) => text.lines > 1),
    clipped: texts.filter((text) => text.clipped),
  };
}

async function modalCheck(doc, win) {
  const opener = [...doc.querySelectorAll("button")].find((button) => /추가/.test(button.innerText) && button.innerText.trim().length < 6);
  opener?.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const dialog = doc.querySelector('[role="dialog"]');
  if (!dialog) return { open: false };
  const rect = dialog.getBoundingClientRect();
  const result = {
    open: true,
    fullWidth: Math.round(rect.x) === 0 && Math.round(rect.width) === win.innerWidth,
    bottomSheet: Math.abs(rect.y + rect.height - win.innerHeight) < 4,
    withinViewport: rect.height <= win.innerHeight,
    scrollableInside: [...dialog.querySelectorAll("*")].some((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)),
  };
  doc.querySelector('[role="dialog"] button')?.click();
  return result;
}

async function mobileAudit({ widths = WIDTHS, views = VIEWS, seed = SEED } = {}) {
  applySeed(seed);
  const failures = [];
  const table = [];

  for (const width of widths) {
    let row;
    try {
      row = await withTimeout(probe(width, async (doc, win) => {
      const nav = navCheck(doc, win);
      const perView = {};
      for (const view of views) {
        await gotoView(doc, view);
        perView[view] = {
          overflows: doc.documentElement.scrollWidth > win.innerWidth + 1,
          small: smallTargets(doc),
          tableHidden: view === "수입·지출" ? !doc.querySelector("table")?.getClientRects().length : null,
          cards: view === "한눈에 보기" ? statCardCheck(doc) : null,
          scrollHeight: view === "한눈에 보기" ? doc.documentElement.scrollHeight : null,
        };
      }
      await gotoView(doc, views[0]);
      const modal = await modalCheck(doc, win);
      return { width, nav, perView, modal };
      }), 60000, `${width}px 측정`);
    } catch (error) {
      failures.push(`${width}: ${error.message}`);
      table.push({ width, "탭 4개 보임": "-", "탭 높이": "-", "44px 미만": "-", "카드 높이차": "-", "카드 2줄": "-", "가로 넘침": "-", "바텀시트": "-" });
      continue;
    }

    const cards = row.perView[views[0]].cards;
    const smallTotal = Object.values(row.perView).reduce((sum, view) => sum + view.small.length, 0);
    table.push({
      width,
      "탭 4개 보임": row.nav.fits && !row.nav.cutOff.length && !row.nav.ellipsis.length && !row.nav.wrapped.length,
      "탭 높이": row.nav.minHeight,
      "44px 미만": smallTotal,
      "카드 높이차": cards?.spread ?? "-",
      "카드 2줄": cards?.multiline.length ?? "-",
      "가로 넘침": Object.values(row.perView).some((view) => view.overflows),
      "바텀시트": row.modal.open && row.modal.fullWidth && row.modal.bottomSheet && row.modal.withinViewport,
    });

    if (!row.nav.fits) failures.push(`${width}: 탭 바가 넘침 (${row.nav.scrollWidth}px)`);
    row.nav.cutOff.forEach((tab) => failures.push(`${width}: 탭 잘림 — ${tab}`));
    row.nav.ellipsis.forEach((tab) => failures.push(`${width}: 탭 라벨 말줄임 — ${tab}`));
    row.nav.wrapped.forEach((tab) => failures.push(`${width}: 탭 라벨 2줄 — ${tab}`));
    if (row.nav.minHeight < MIN_TARGET) failures.push(`${width}: 탭 높이 ${row.nav.minHeight}px`);
    if (!row.nav.activeMarked) failures.push(`${width}: 활성 탭 표시 없음`);
    for (const [view, result] of Object.entries(row.perView)) {
      if (result.overflows) failures.push(`${width} ${view}: 가로 스크롤 발생`);
      result.small.forEach((target) => failures.push(`${width} ${view}: ${target.label} ${target.height}×${target.width}`));
      if (result.tableHidden === false) failures.push(`${width} ${view}: 테이블이 카드 목록으로 바뀌지 않음`);
    }
    if (cards?.found) {
      if (cards.spread > 2) failures.push(`${width}: 스탯 카드 높이차 ${cards.spread}px`);
      cards.multiline.forEach((text) => failures.push(`${width}: 카드 텍스트 ${text.lines}줄 — ${text.text}`));
      cards.clipped.forEach((text) => failures.push(`${width}: 카드 텍스트 잘림 — ${text.text}`));
    }
    if (!row.modal.open) failures.push(`${width}: 모달이 열리지 않음`);
    else {
      if (!row.modal.fullWidth) failures.push(`${width}: 모달이 전폭이 아님`);
      if (!row.modal.bottomSheet) failures.push(`${width}: 모달이 하단에 붙지 않음`);
      if (!row.modal.withinViewport) failures.push(`${width}: 모달이 뷰포트를 넘침`);
      if (!row.modal.scrollableInside) failures.push(`${width}: 모달 내부 스크롤 없음`);
    }
  }

  console.table(table);
  if (failures.length) console.warn(`실패 ${failures.length}건`, failures);
  else console.log("통과 — 모든 폭에서 수용 기준 충족");
  return { table, failures };
}

globalThis.mobileAudit = mobileAudit;
console.log("mobileAudit() 준비됨 — await mobileAudit()");
