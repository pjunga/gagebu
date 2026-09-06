/*
 * Mobile layout audit — paste into the browser console, do not run with node.
 *
 * 1. pnpm dev
 * 2. Open http://localhost:3000 and paste this whole file into the console.
 * 3. await mobileAudit()
 *
 * It replaces the stored records with a fixed seed while it measures, because
 * wording length depends on the data, and puts your own records back when it
 * finishes — including if a measurement throws. It still refuses to start
 * without a confirmation when it finds records, and it refuses outright when
 * the app is talking to Firebase, where seeding the local keys would measure
 * one dataset while describing another.
 *
 * The app is loaded into an iframe of the size being measured: resizing the
 * window does not change the viewport in every automation host, and an iframe
 * gets its own. Everything is read through the iframe's own window, so the page
 * has to be same-origin — hence pasting it into the app itself.
 *
 * Not wired into CI and needs no dependencies. It reports; it decides nothing.
 * What it cannot see: a real device's address bar, touch handling, or the iOS
 * Safari bottom bar.
 *
 * Fixed seed: 3 transactions (식비 15,000 / 주거·관리비 1,250,000 / 급여
 * 3,200,000 imported), 1 savings account maturing 2026-09-20, 1 USD stock
 * order, 1 work item.
 */

const STORAGE_KEYS = [
  "gagebu:transactions:v2",
  "gagebu:savings-accounts:v1",
  "gagebu:stock-orders:v1",
  "gagebu:work-items:v1",
];

const SEED = {
  "gagebu:transactions:v2": [
    { id: "t1", source: "manual", type: "expense", category: "식비", amount: 15000, memo: "점심 도시락", date: "2026-09-05" },
    { id: "t2", source: "manual", type: "expense", category: "주거·관리비", amount: 1250000, memo: "월세", date: "2026-09-01" },
    { id: "t3", source: "import", fingerprint: "fp1", type: "income", category: "급여", amount: 3200000, memo: "9월 급여", date: "2026-09-05",
      incomeDetails: { source: "salary", employer: "테스트 회사", grossAmount: 3600000, netAmount: 3200000, month: "2026-09" } },
  ],
  "gagebu:savings-accounts:v1": [
    { id: "s1", source: "manual", institution: "저축 은행", accountName: "정기적금", assetType: "savings", principal: 3000000, balance: 3120000, monthlyContribution: 250000, startDate: "2026-01-05", maturityDate: "2026-09-20" },
  ],
  "gagebu:stock-orders:v1": [
    { id: "o1", source: "manual", broker: "증권사", ticker: "AAPL", name: "애플", side: "buy", quantity: 5, unitPrice: 243.5, totalAmount: 1217.5, orderDate: "2026-09-02", currency: "USD" },
  ],
  "gagebu:work-items:v1": [
    { id: "w1", source: "manual", title: "강의 자료 정리", workDate: "2026-09-08", status: "in-progress", amount: 300000, description: "기초 과정 3회차" },
  ],
};

/** Width and the height of a phone that actually has it, so a sheet is judged against a real screen. */
const SCREENS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
];
/** Desktop rows assert that the touch sizes stop at the lg breakpoint. */
const DESKTOP_SCREENS = [
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
];
const VIEWS = ["한눈에 보기", "수입·지출", "자산", "작업 관리"];
const MIN_TARGET = 44;

/** Selector + why, so an exception is a decision on the record rather than a judgement call. */
const TARGET_ALLOWLIST = [];

function readStore() {
  return Object.fromEntries(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]));
}

function writeStore(entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

function seedEntries() {
  return Object.fromEntries(Object.entries(SEED).map(([key, value]) => [key, JSON.stringify(value)]));
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: ${ms}ms 안에 끝나지 않음`)), ms); }),
  ]);
}

async function probe({ width, height }, read) {
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
  if (!tab) return false;
  tab.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return true;
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
  const empty = { present: false, fits: true, scrollWidth: 0, cutOff: [], ellipsis: [], wrapped: [], activeMarked: true, minHeight: null };
  if (!nav) return empty;
  const tabs = [...nav.querySelectorAll("button")];
  const labelOf = (tab) => tab.querySelector("span") || tab;
  return {
    present: true,
    fits: nav.scrollWidth <= nav.clientWidth + 1,
    scrollWidth: nav.scrollWidth,
    cutOff: tabs.filter((tab) => tab.getBoundingClientRect().right > win.innerWidth + 1).map((tab) => tab.innerText.trim()),
    ellipsis: tabs.filter((tab) => labelOf(tab).scrollWidth > labelOf(tab).clientWidth + 1).map((tab) => tab.innerText.trim()),
    // Kept as a guard: the label is nowrap today, so this only fires if that changes.
    wrapped: tabs.filter((tab) => lineCount(labelOf(tab)) > 1).map((tab) => tab.innerText.trim()),
    activeMarked: tabs.some((tab) => tab.getAttribute("aria-current") === "page"),
    minHeight: Math.min(...tabs.map((tab) => Math.round(tab.getBoundingClientRect().height))),
  };
}

function statCardCheck(doc) {
  const grid = [...doc.querySelectorAll("main div")].find(
    (el) => /grid-cols-2/.test(el.className || "") && /수입[\s\S]*지출[\s\S]*전월 대비[\s\S]*순자산/.test(el.innerText || ""),
  );
  if (!grid) return { found: false, heights: [], spread: 0, multiline: [], clipped: [] };
  const cards = [...grid.children];
  const heights = cards.map((card) => Math.round(card.getBoundingClientRect().height));
  const texts = cards.flatMap((card) => [...card.querySelectorAll("p")].map((p) => ({
    text: (p.innerText || "").trim().slice(0, 26),
    lines: lineCount(p),
    clipped: p.scrollWidth > p.clientWidth + 1,
  })));
  return {
    found: true,
    heights,
    spread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
    multiline: texts.filter((text) => text.lines > 1),
    clipped: texts.filter((text) => text.clipped),
  };
}

/** Opens the entry sheet and measures it, including the targets only it shows. */
async function modalCheck(doc, win) {
  const opener = [...doc.querySelectorAll("button")].find((button) => /^\+?\s*추가$/.test(button.innerText.trim()));
  if (!opener) return { open: false, small: [] };
  opener.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const dialog = doc.querySelector('[role="dialog"]');
  if (!dialog) return { open: false, small: [] };
  const rect = dialog.getBoundingClientRect();
  const result = {
    open: true,
    fullWidth: Math.round(rect.x) === 0 && Math.round(rect.width) === win.innerWidth,
    bottomSheet: Math.abs(rect.y + rect.height - win.innerHeight) < 4,
    withinViewport: rect.height <= win.innerHeight,
    // Only meaningful when the sheet is taller than the screen it sits on.
    scrollableInside: [...dialog.querySelectorAll("*")].some((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)),
    small: smallTargets(doc),
  };
  [...dialog.querySelectorAll("button")].find((b) => /닫기/.test(b.getAttribute("aria-label") || ""))?.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return result;
}

async function measure(screen, views) {
  return probe(screen, async (doc, win) => {
    const nav = navCheck(doc, win);
    const perView = {};
    for (const view of views) {
      if (!(await gotoView(doc, view))) throw new Error(`${screen.width}px: ${view} 탭을 찾지 못함`);
      const table = doc.querySelector("table");
      perView[view] = {
        overflows: doc.documentElement.scrollWidth > win.innerWidth + 1,
        small: smallTargets(doc),
        tableShown: view === "수입·지출" ? Boolean(table && table.getClientRects().length) : null,
        cards: view === views[0] ? statCardCheck(doc) : null,
        scrollHeight: view === views[0] ? doc.documentElement.scrollHeight : null,
      };
    }
    if (!(await gotoView(doc, views[0]))) throw new Error(`${screen.width}px: ${views[0]} 탭을 찾지 못함`);
    const modal = await modalCheck(doc, win);
    return { screen, nav, perView, modal };
  });
}

async function mobileAudit({ screens = SCREENS, desktopScreens = DESKTOP_SCREENS, views = VIEWS, force = false } = {}) {
  const existing = readStore();
  const hasRecords = Object.values(existing).some((value) => value && value !== "[]");
  if (typeof isFirebaseAudit === "undefined" && document.querySelector('[data-firebase="on"]')) {
    throw new Error("Firebase 모드에서는 시드가 앱이 읽지 않는 키에 쓰여 측정이 무의미합니다.");
  }
  if (hasRecords && !force && !confirm("저장된 기록을 시드로 잠시 바꿉니다. 끝나면 되돌립니다. 계속할까요?")) {
    return { table: [], failures: ["사용자가 중단"] };
  }

  const failures = [];
  const table = [];
  writeStore(seedEntries());

  try {
    for (const screen of screens) {
      let row;
      try {
        row = await withTimeout(measure(screen, views), 60000, `${screen.width}px 측정`);
      } catch (error) {
        failures.push(`${screen.width}: ${error.message}`);
        table.push({ width: screen.width, "탭 4개 보임": "-", "탭 높이": "-", "44px 미만": "-", "카드 높이차": "-", "카드 2줄": "-", "가로 넘침": "-", "바텀시트": "-" });
        continue;
      }

      const cards = row.perView[views[0]].cards;
      const smallTotal = Object.values(row.perView).reduce((sum, view) => sum + view.small.length, 0) + row.modal.small.length;
      table.push({
        width: screen.width,
        "탭 4개 보임": row.nav.present && row.nav.fits && !row.nav.cutOff.length && !row.nav.ellipsis.length && !row.nav.wrapped.length,
        "탭 높이": row.nav.minHeight,
        "44px 미만": smallTotal,
        "카드 높이차": cards.spread,
        "카드 2줄": cards.multiline.length,
        "가로 넘침": Object.values(row.perView).some((view) => view.overflows),
        "바텀시트": row.modal.open && row.modal.fullWidth && row.modal.bottomSheet && row.modal.withinViewport,
      });

      if (!row.nav.present) failures.push(`${screen.width}: 모바일 메뉴가 없음`);
      if (!row.nav.fits) failures.push(`${screen.width}: 탭 바가 넘침 (${row.nav.scrollWidth}px)`);
      row.nav.cutOff.forEach((tab) => failures.push(`${screen.width}: 탭 잘림 — ${tab}`));
      row.nav.ellipsis.forEach((tab) => failures.push(`${screen.width}: 탭 라벨 말줄임 — ${tab}`));
      row.nav.wrapped.forEach((tab) => failures.push(`${screen.width}: 탭 라벨 2줄 — ${tab}`));
      if (row.nav.minHeight !== null && row.nav.minHeight < MIN_TARGET) failures.push(`${screen.width}: 탭 높이 ${row.nav.minHeight}px`);
      if (!row.nav.activeMarked) failures.push(`${screen.width}: 활성 탭 표시 없음`);
      for (const [view, result] of Object.entries(row.perView)) {
        if (result.overflows) failures.push(`${screen.width} ${view}: 가로 스크롤 발생`);
        result.small.forEach((target) => failures.push(`${screen.width} ${view}: ${target.label} ${target.height}×${target.width}`));
        if (result.tableShown === true) failures.push(`${screen.width} ${view}: 테이블이 카드 목록으로 바뀌지 않음`);
      }
      if (cards.found) {
        if (cards.spread > 2) failures.push(`${screen.width}: 스탯 카드 높이차 ${cards.spread}px`);
        cards.multiline.forEach((text) => failures.push(`${screen.width}: 카드 텍스트 ${text.lines}줄 — ${text.text}`));
        cards.clipped.forEach((text) => failures.push(`${screen.width}: 카드 텍스트 잘림 — ${text.text}`));
      } else {
        failures.push(`${screen.width}: 스탯 카드를 찾지 못함`);
      }
      if (!row.modal.open) failures.push(`${screen.width}: 모달이 열리지 않음`);
      else {
        if (!row.modal.fullWidth) failures.push(`${screen.width}: 모달이 전폭이 아님`);
        if (!row.modal.bottomSheet) failures.push(`${screen.width}: 모달이 하단에 붙지 않음`);
        if (!row.modal.withinViewport) failures.push(`${screen.width}: 모달이 뷰포트(${screen.height}px)를 넘침`);
        if (!row.modal.withinViewport && !row.modal.scrollableInside) failures.push(`${screen.width}: 모달이 화면을 넘는데 내부 스크롤이 없음`);
        row.modal.small.forEach((target) => failures.push(`${screen.width} 모달: ${target.label} ${target.height}×${target.width}`));
      }
    }

    // The touch sizes are meant to stop at lg; measure that rather than trust it.
    for (const screen of desktopScreens) {
      try {
        const heights = await withTimeout(probe(screen, async (doc) => {
          const control = [...doc.querySelectorAll("button")].find((b) => b.innerText.trim() === "내역 추가" || b.innerText.trim() === "가져오기");
          const navHidden = !doc.querySelector('nav[aria-label="모바일 메뉴"]')?.getClientRects().length;
          return { control: control ? Math.round(control.getBoundingClientRect().height) : null, navHidden };
        }), 60000, `${screen.width}px 측정`);
        table.push({ width: screen.width, "탭 4개 보임": heights.navHidden ? "숨김" : "노출", "탭 높이": "-", "44px 미만": "-", "카드 높이차": "-", "카드 2줄": "-", "가로 넘침": "-", "바텀시트": "-" });
        if (!heights.navHidden) failures.push(`${screen.width}: 데스크톱인데 모바일 메뉴가 보임`);
        if (heights.control !== null && heights.control > 40) failures.push(`${screen.width}: 데스크톱 컨트롤이 ${heights.control}px — 터치 크기가 새어 나옴`);
      } catch (error) {
        failures.push(`${screen.width}: ${error.message}`);
      }
    }
  } finally {
    writeStore(existing);
  }

  console.table(table);
  if (failures.length) console.warn(`실패 ${failures.length}건`, failures);
  else console.log("통과 — 모든 폭에서 수용 기준 충족");
  return { table, failures };
}

globalThis.mobileAudit = mobileAudit;
console.log("mobileAudit() 준비됨 — await mobileAudit()");
