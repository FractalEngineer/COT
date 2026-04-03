"use strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CATEGORIES = ["All", "Equity Index", "Interest Rates", "Currencies", "Crypto", "Other"];

// Currency pair labels (first substring match wins; most-specific entries MUST come first)
const FX_PAIRS = [
  // ---- Euro cross rates — before "EURO FX" or they'd all match EUR/USD ----
  ["EURO FX/BRITISH POUND",      "EUR/GBP"],
  ["EURO FX/JAPANESE YEN",       "EUR/JPY"],
  ["EURO FX/SWISS FRANC",        "EUR/CHF"],
  ["EURO FX/CANADIAN DOLLAR",    "EUR/CAD"],
  ["EURO FX/AUSTRALIAN DOLLAR",  "EUR/AUD"],
  ["EURO FX/SWEDISH KRONE",      "EUR/SEK"],
  ["EURO FX/NORWEGIAN KRONE",    "EUR/NOK"],
  // ---- Offshore CNH — before generic "CHINESE RENMINBI" ----
  ["USD/CHINESE RENMINBI-OFFSHORE", "USD/CNH"],
  ["OFFSHORE CHINESE RENMINBI",  "USD/CNH"],
  // ---- Major USD pairs ----
  ["EURO FX",                    "EUR/USD"],
  ["JAPANESE YEN",               "USD/JPY"],
  ["BRITISH POUND",              "GBP/USD"],
  ["SWISS FRANC",                "USD/CHF"],
  ["AUSTRALIAN DOLLAR",          "AUD/USD"],
  ["CANADIAN DOLLAR",            "USD/CAD"],
  ["NEW ZEALAND DOLLAR",         "NZD/USD"],
  ["NZ DOLLAR",                  "NZD/USD"],
  // ---- EM / minor USD pairs ----
  ["MEXICAN PESO",               "USD/MXN"],
  ["SOUTH AFRICAN RAND",         "USD/ZAR"],
  ["SO AFRICAN RAND",            "USD/ZAR"],
  ["BRAZILIAN REAL",             "USD/BRL"],
  ["SOUTH KOREAN WON",           "USD/KRW"],
  ["KOREAN WON",                 "USD/KRW"],
  ["CHINESE RENMINBI",           "USD/CNY"],
  ["RUSSIAN RUBLE",              "USD/RUB"],
  ["SWEDISH KRONA",              "USD/SEK"],
  ["NORWEGIAN KRONE",            "USD/NOK"],
  ["TURKISH LIRA",               "USD/TRY"],
  ["INDIAN RUPEE",               "USD/INR"],
  ["SINGAPORE DOLLAR",           "USD/SGD"],
  ["CZECH KORUNA",               "USD/CZK"],
  ["POLISH ZLOTY",               "USD/PLN"],
  ["HUNGARIAN FORINT",           "USD/HUF"],
  ["ISRAELI SHEKEL",             "USD/ILS"],
  // ---- Dollar Index ----
  ["U.S. DOLLAR INDEX",          "DXY"],
  ["DOLLAR INDEX",               "DXY"],
];

function fxPair(name) {
  const n = name.toUpperCase();
  for (const [substr, pair] of FX_PAIRS) {
    if (n.includes(substr)) return pair;
  }
  return null;
}

const COLORS = {
  levMoney: { pos: "#34d399", neg: "#f87171" },
  dealer:   { pos: "#34d399", neg: "#f87171" },
  assetMgr: { pos: "#34d399", neg: "#f87171" },
  other:    { pos: "#34d399", neg: "#f87171" },
  oi:       "#818cf8",
  price:    "#e2e8f0",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let instruments   = [];
let cache         = new Map();
let activeCode    = null;
let activeCategory = "All";
let activeWeeks   = 52;
let activeView    = "chart";

// ---------------------------------------------------------------------------
// Category inference (JS-side — works without reprocess)
// ---------------------------------------------------------------------------
function inferCategory(name) {
  const n = name.toUpperCase();
  if (["S&P", "NASDAQ", "RUSSELL", "NIKKEI", "DOW JONES", "DJIA", "VIX",
       "STOCK INDEX", "EQUITY INDEX", "FTSE", "DAX"].some((k) => n.includes(k)))
    return "Equity Index";
  if (["BITCOIN", "ETHER", "CRYPTO"].some((k) => n.includes(k)))
    return "Crypto";
  if (["TREASURY", "EURODOLLAR", "SOFR", "FEDERAL FUND", "FED FUND",
       "MUNICIPAL", "LIBOR", "INTEREST RATE SWAP"].some((k) => n.includes(k)))
    return "Interest Rates";
  if (["FX", "YEN", "POUND", "FRANC", "PESO", "RUBLE", "YUAN", "RENMINBI",
       "WON", "RAND", "KRONE", "KRONA", "FORINT", "ZLOTY", "LIRA", "RUPEE",
       "KORUNA", "DOLLAR INDEX", "DOLLAR"].some((k) => n.includes(k)))
    return "Currencies";
  if (n.includes("EURO") && !n.includes("EURODOLLAR"))
    return "Currencies";
  return "Other";
}
function getCategory(inst) { return inst.category || inferCategory(inst.name); }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  buildCategoryPills();
  setupControls();
  document.getElementById("search").addEventListener("input", renderSidebar);
  await loadInstruments();
  handleHash();
  window.addEventListener("hashchange", handleHash);
});

// ---------------------------------------------------------------------------
// Category pills
// ---------------------------------------------------------------------------
function buildCategoryPills() {
  const container = document.getElementById("category-pills");
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "pill" + (cat === "All" ? " active" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => {
      activeCategory = cat;
      document.querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderSidebar();
    });
    container.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function setupControls() {
  document.getElementById("tf-group").addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeWeeks = Number(btn.dataset.weeks);
    if (activeCode) refreshView();
  });

  document.querySelector(".view-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn) return;
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeView = btn.dataset.view;
    document.getElementById("chart-view").classList.toggle("hidden", activeView !== "chart");
    document.getElementById("table-view").classList.toggle("hidden", activeView !== "table");
    if (activeCode) refreshView();
  });
}

// ---------------------------------------------------------------------------
// Load + pre-fetch all instruments
// ---------------------------------------------------------------------------
async function loadInstruments() {
  try {
    const res = await fetch("data/instruments.json");
    if (!res.ok) throw new Error(res.statusText);
    instruments = await res.json();
  } catch (e) {
    document.getElementById("instrument-list").innerHTML =
      '<div class="sidebar-loading">Failed to load instruments.</div>';
    console.error(e);
    return;
  }

  renderSidebar();
  document.getElementById("header-meta").textContent =
    `${instruments.length} instruments · loading…`;

  // Pre-fetch all instrument JSONs concurrently
  await Promise.allSettled(
    instruments.map(async (inst) => {
      try {
        const r = await fetch(`data/${inst.code}.json`);
        if (!r.ok) return;
        cache.set(inst.code, await r.json());
        updateCardData(inst.code);
      } catch (_) {}
    })
  );

  const latest = getLatestDate();
  document.getElementById("header-meta").textContent =
    `${instruments.length} instruments · latest: ${latest ?? "—"}`;
}

function getLatestDate() {
  let d = "";
  cache.forEach((p) => { const r = p.rows[p.rows.length - 1]; if (r?.d > d) d = r.d; });
  return d || null;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function renderSidebar() {
  const query = document.getElementById("search").value.trim().toLowerCase();
  const filtered = instruments.filter((inst) => {
    const catOk    = activeCategory === "All" || getCategory(inst) === activeCategory;
    const searchOk = !query || inst.name.toLowerCase().includes(query);
    return catOk && searchOk;
  });

  const container = document.getElementById("instrument-list");
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = '<div class="sidebar-loading">No instruments found.</div>';
    return;
  }

  filtered.forEach((inst) => {
    const card = document.createElement("div");
    card.className = "inst-card" + (inst.code === activeCode ? " active" : "");
    card.dataset.code = inst.code;
    card.innerHTML = `
      <div class="card-row1">
        <div>
          <span class="card-symbol">${extractSymbol(inst.name)}</span>
          <span class="card-exchange">${extractExchange(inst.name)}</span>
        </div>
        <div class="card-sparkline"></div>
      </div>
      <div class="card-row2">${cleanName(inst.name)}</div>
      <div class="card-row3">
        <span class="card-data-placeholder" style="color:#334155;font-size:9px">loading…</span>
      </div>
    `;
    card.addEventListener("click", () => { window.location.hash = inst.code; });
    container.appendChild(card);
    if (cache.has(inst.code)) updateCardData(inst.code);
  });
}

// Update one card's sparkline + flip values as data arrives
function updateCardData(code) {
  const card = document.querySelector(`.inst-card[data-code="${code}"]`);
  if (!card) return;

  const payload = cache.get(code);
  if (!payload) return;

  const rows    = payload.rows;
  const last    = rows[rows.length - 1];
  const prev    = rows.length > 1 ? rows[rows.length - 2] : last;
  const isActive = code === activeCode;

  // Lev flip = %long − %short (sentiment −100 → +100)
  const levFlip  = (last.pct_ll ?? 0) - (last.pct_ls ?? 0);
  const dealFlip = (last.pct_dl ?? 0) - (last.pct_ds ?? 0);
  const amFlip   = (last.pct_al ?? 0) - (last.pct_as ?? 0);

  // Sparkline of Lev flip (normalized across instruments, better for comparison)
  const sparkVals = rows.slice(-26).map((r) => (r.pct_ll ?? 0) - (r.pct_ls ?? 0));

  const sparkEl = card.querySelector(".card-sparkline");
  if (sparkEl)
    sparkEl.innerHTML = sparklineSVG(sparkVals, 60, 20, isActive ? "#818cf8" : "#475569");

  const row3 = card.querySelector(".card-row3");
  if (row3) {
    const lColor = levFlip  >= 0 ? COLORS.levMoney.pos : COLORS.levMoney.neg;
    const dColor = dealFlip >= 0 ? COLORS.dealer.pos   : COLORS.dealer.neg;
    const aColor = amFlip   >= 0 ? COLORS.assetMgr.pos : COLORS.assetMgr.neg;
    row3.innerHTML = `
      <span style="color:${lColor}">Lev <b>${fmtFlip(levFlip)}</b></span>
      <span style="color:${dColor}">Deal <b>${fmtFlip(dealFlip)}</b></span>
      <span style="color:${aColor}">AM <b>${fmtFlip(amFlip)}</b></span>
    `;
  }
}

// ---------------------------------------------------------------------------
// Hash routing
// ---------------------------------------------------------------------------
function handleHash() {
  const code = window.location.hash.slice(1);
  if (code && code !== activeCode) selectInstrument(code);
}

async function selectInstrument(code) {
  activeCode = code;

  document.querySelectorAll(".inst-card").forEach((c) => {
    const isActive = c.dataset.code === code;
    c.classList.toggle("active", isActive);
    // Refresh sparkline accent color
    if (cache.has(c.dataset.code)) {
      const sp   = c.querySelector(".card-sparkline");
      if (sp) {
        const vals = cache.get(c.dataset.code).rows.slice(-26)
          .map((r) => (r.pct_ll ?? 0) - (r.pct_ls ?? 0));
        sp.innerHTML = sparklineSVG(vals, 60, 20, isActive ? "#818cf8" : "#475569");
      }
    }
  });

  const el = document.querySelector(`.inst-card[data-code="${code}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });

  if (!cache.has(code)) {
    try {
      const res = await fetch(`data/${code}.json`);
      if (!res.ok) throw new Error(res.status);
      cache.set(code, await res.json());
    } catch (e) { console.error("Failed to load:", e); return; }
  }

  refreshView();
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
function refreshView() {
  const payload = cache.get(activeCode);
  if (!payload) return;

  const inst    = instruments.find((i) => i.code === activeCode);
  const allRows = payload.rows;
  const rows    = activeWeeks === 0 ? allRows : allRows.slice(-activeWeeks);
  const latest  = rows[rows.length - 1];
  const prev    = rows.length > 1 ? rows[rows.length - 2] : latest;

  document.getElementById("placeholder").classList.add("hidden");
  document.getElementById("view").classList.remove("hidden");

  document.getElementById("inst-symbol").textContent = extractSymbol(payload.name);
  document.getElementById("inst-name").textContent   = cleanName(payload.name);
  document.getElementById("inst-badge").textContent  = inst ? getCategory(inst) : "";

  renderStatCards(latest, prev);
  renderBreakdown(latest);

  if (activeView === "chart") renderCharts(rows);
  else renderTable(rows);
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------
function renderStatCards(latest, prev) {
  const cards = [
    { label: "Lev Money Net",
      val: (latest.ll ?? 0) - (latest.ls ?? 0),
      pv:  (prev.ll   ?? 0) - (prev.ls   ?? 0),
      pc:  COLORS.levMoney.pos, nc: COLORS.levMoney.neg },
    { label: "Dealer Net",
      val: (latest.dl ?? 0) - (latest.ds ?? 0),
      pv:  (prev.dl   ?? 0) - (prev.ds   ?? 0),
      pc:  COLORS.dealer.pos, nc: COLORS.dealer.neg },
    { label: "Asset Mgr Net",
      val: (latest.al ?? 0) - (latest["as_"] ?? 0),
      pv:  (prev.al   ?? 0) - (prev["as_"]   ?? 0),
      pc:  COLORS.assetMgr.pos, nc: COLORS.assetMgr.neg },
    { label: "Open Interest",
      val: latest.oi ?? 0, pv: prev.oi ?? 0,
      pc: COLORS.oi, nc: COLORS.oi },
  ];
  document.getElementById("stat-cards").innerHTML = cards.map(({ label, val, pv, pc, nc }) => {
    const color  = val >= 0 ? pc : nc;
    const delta  = val - pv;
    const dColor = delta > 0 ? "#34d399" : delta < 0 ? "#f87171" : "#94a3b8";
    return `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="color:${color}">${fmtFull(val)}</div>
        <div class="stat-delta" style="color:${dColor}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} ${fmtFull(Math.abs(delta))} w/w</div>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Breakdown bars
// ---------------------------------------------------------------------------
function renderBreakdown(latest) {
  const rows = [
    { label: "Leveraged Money",  long: latest.ll ?? 0, short: latest.ls ?? 0,       cL: COLORS.levMoney.pos, cS: COLORS.levMoney.neg },
    { label: "Dealer",           long: latest.dl ?? 0, short: latest.ds ?? 0,       cL: COLORS.dealer.pos,   cS: COLORS.dealer.neg   },
    { label: "Asset Manager",    long: latest.al ?? 0, short: latest["as_"] ?? 0,   cL: COLORS.assetMgr.pos, cS: COLORS.assetMgr.neg },
    { label: "Other Reportable", long: latest.ol ?? 0, short: latest["os_"] ?? 0,   cL: COLORS.other.pos,    cS: COLORS.other.neg    },
  ];
  document.getElementById("breakdown-bars").innerHTML = rows.map(({ label, long, short, cL, cS }) => {
    const total = long + short || 1;
    const pL    = (long / total) * 100;
    const flip  = 2 * pL - 100;
    const fColor = flip >= 0 ? cL : cS;
    return `
      <div class="breakdown-row">
        <div class="breakdown-label">
          <span>${label}</span>
          <span class="breakdown-label-right">${fmtFull(long)} / ${fmtFull(short)}</span>
        </div>
        <div class="breakdown-bar-wrap">
          <span class="breakdown-flip" style="left:${pL.toFixed(1)}%;color:${fColor}">${fmtFlip(flip)}</span>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-long"  style="width:${pL.toFixed(1)}%;background:${cL}"></div>
            <div class="breakdown-bar-short" style="width:${(100-pL).toFixed(1)}%;background:${cS}"></div>
          </div>
        </div>
        <div class="breakdown-pcts">
          <span>Long ${pL.toFixed(1)}%</span><span>Short ${(100-pL).toFixed(1)}%</span>
        </div>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function renderCharts(rows) {
  const dates  = rows.map((r) => r.d);
  const prices = rows.map((r) => r.p ?? null);   // null when no price data

  renderBarChart(
    document.getElementById("chart-lev-inner"),
    "Leveraged Money Net Position",
    rows.map((r) => (r.ll ?? 0) - (r.ls ?? 0)),
    dates, prices,
    COLORS.levMoney.pos, COLORS.levMoney.neg
  );
  renderBarChart(
    document.getElementById("chart-dealer-inner"),
    "Dealer Net Position",
    rows.map((r) => (r.dl ?? 0) - (r.ds ?? 0)),
    dates, prices,
    COLORS.dealer.pos, COLORS.dealer.neg
  );
  renderBarChart(
    document.getElementById("chart-am-inner"),
    "Asset Manager Net Position",
    rows.map((r) => (r.al ?? 0) - (r["as_"] ?? 0)),
    dates, prices,
    COLORS.assetMgr.pos, COLORS.assetMgr.neg
  );
  renderOIChart(
    document.getElementById("chart-oi-inner"),
    rows.map((r) => r.oi ?? 0),
    dates, prices
  );
}

// Bar chart with optional price overlay
function renderBarChart(container, label, values, dates, prices, colorPos, colorNeg, height = 160) {
  const W = 700, padL = 36, padR = 48;
  const innerW = W - padL - padR;
  const n = values.length;
  const max  = Math.max(...values.map(Math.abs), 1);
  const midY = height / 2;
  const barW = Math.max(1.5, Math.floor(innerW / n) - 1);
  const step = Math.ceil(n / 6);

  // Bars
  const bars = values.map((v, i) => {
    const bh = (Math.abs(v) / max) * (midY - 10);
    const x  = padL + (i / n) * innerW;
    const y  = v >= 0 ? midY - bh : midY;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(1, bh).toFixed(1)}" fill="${v >= 0 ? colorPos : colorNeg}" rx="1" opacity="0.85"/>`;
  }).join("");

  // X-axis labels
  const xLabels = dates
    .map((d, i) => {
      if (i % step !== 0) return "";
      const x = padL + (i / n) * innerW;
      return `<text x="${x.toFixed(1)}" y="${height + 20}" font-size="9" fill="#64748b" text-anchor="middle">${d.slice(5)}</text>`;
    }).join("");

  // Price overlay (right axis, full height)
  const validPrices = prices.filter((p) => p !== null);
  let priceOverlay = "";
  let rightAxis    = "";
  if (validPrices.length > 1) {
    const priceMin = Math.min(...validPrices);
    const priceMax = Math.max(...validPrices);
    const priceRange = priceMax - priceMin || 1;
    const pts = prices.map((p, i) => {
      if (p === null) return null;
      const x = padL + (i / n) * innerW;
      const y = 8 + ((priceMax - p) / priceRange) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(" ");

    priceOverlay = `
      <polyline points="${pts}" fill="none" stroke="${COLORS.price}" stroke-width="1.2" stroke-linejoin="round" opacity="0.55"/>`;
    rightAxis = `
      <text x="${W - padR + 4}" y="12"            font-size="9" fill="#64748b">${fmtK(priceMax)}</text>
      <text x="${W - padR + 4}" y="${height - 2}"  font-size="9" fill="#64748b">${fmtK(priceMin)}</text>`;
  }

  container.innerHTML = `
    <div class="chart-label">${label}${validPrices.length > 1 ? ' <span style="color:#64748b;font-weight:400">· price overlay</span>' : ''}</div>
    <svg width="100%" viewBox="0 0 ${W} ${height + 28}" style="display:block">
      <line x1="${padL}" y1="${midY}" x2="${W - padR}" y2="${midY}" stroke="#334155" stroke-width="1"/>
      ${bars}${priceOverlay}${xLabels}${rightAxis}
      <text x="${padL - 4}" y="14"           font-size="9" fill="#64748b" text-anchor="end">${fmtK(max)}</text>
      <text x="${padL - 4}" y="${height - 2}" font-size="9" fill="#64748b" text-anchor="end">${fmtK(-max)}</text>
    </svg>`;
  attachCrosshair(
    container, values, dates, prices,
    (v) => (v >= 0 ? "+" : "") + fmtFull(v),
    (v) => v >= 0 ? colorPos : colorNeg,
    height, true
  );
}

// OI area chart with optional price overlay
function renderOIChart(container, values, dates, prices, height = 110) {
  const W = 700, padL = 36, padR = 48;
  const innerW = W - padL - padR;
  const n = values.length;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = Math.ceil(n / 6);

  const pts = values.map((v, i) => {
    const x = padL + (i / (n - 1)) * innerW;
    const y = height - 20 - ((v - min) / range) * (height - 40);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const xLabels = dates
    .map((d, i) => {
      if (i % step !== 0) return "";
      const x = padL + (i / (n - 1)) * innerW;
      return `<text x="${x.toFixed(1)}" y="${height + 20}" font-size="9" fill="#64748b" text-anchor="middle">${d.slice(5)}</text>`;
    }).join("");

  const validPrices = prices.filter((p) => p !== null);
  let priceOverlay = "";
  let rightAxis    = "";
  if (validPrices.length > 1) {
    const pMin = Math.min(...validPrices), pMax = Math.max(...validPrices);
    const pRange = pMax - pMin || 1;
    const pPts = prices.map((p, i) => {
      if (p === null) return null;
      const x = padL + (i / (n - 1)) * innerW;
      const y = 8 + ((pMax - p) / pRange) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(" ");
    priceOverlay = `<polyline points="${pPts}" fill="none" stroke="${COLORS.price}" stroke-width="1.2" stroke-linejoin="round" opacity="0.55"/>`;
    rightAxis    = `
      <text x="${W - padR + 4}" y="12"            font-size="9" fill="#64748b">${fmtK(pMax)}</text>
      <text x="${W - padR + 4}" y="${height - 6}"  font-size="9" fill="#64748b">${fmtK(pMin)}</text>`;
  }

  container.innerHTML = `
    <div class="chart-label">Open Interest${validPrices.length > 1 ? ' <span style="color:#64748b;font-weight:400">· price overlay</span>' : ''}</div>
    <svg width="100%" viewBox="0 0 ${W} ${height + 28}" style="display:block">
      <defs>
        <linearGradient id="oiGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#818cf8" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#818cf8" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${padL},${height - 20} ${pts} ${W - padR},${height - 20}" fill="url(#oiGrad)"/>
      <polyline points="${pts}" fill="none" stroke="#818cf8" stroke-width="2" stroke-linejoin="round"/>
      ${priceOverlay}${xLabels}${rightAxis}
      <text x="${padL - 4}" y="14"            font-size="9" fill="#64748b" text-anchor="end">${fmtK(max)}</text>
      <text x="${padL - 4}" y="${height - 6}"  font-size="9" fill="#64748b" text-anchor="end">${fmtK(min)}</text>
    </svg>`;
  attachCrosshair(
    container, values, dates, prices,
    (v) => fmtFull(v),
    () => COLORS.oi,
    height, false
  );
}

// ---------------------------------------------------------------------------
// Crosshair (shared by bar & OI charts)
// ---------------------------------------------------------------------------
function attachCrosshair(container, values, dates, prices, fmtVal, colorFn, height, isBar) {
  const svg = container.querySelector("svg");
  if (!svg || values.length < 2) return;

  const W = 700, padL = 36, padR = 48;
  const innerW = W - padL - padR;
  const n = values.length;
  const FF = "'JetBrains Mono','Fira Code','SF Mono',monospace";
  const ns = "http://www.w3.org/2000/svg";

  // Crosshair group (hidden until hover)
  const g = document.createElementNS(ns, "g");
  g.style.display = "none";
  g.style.pointerEvents = "none";

  const vline = document.createElementNS(ns, "line");
  vline.setAttribute("stroke", "#334155");
  vline.setAttribute("stroke-width", "1");
  vline.setAttribute("stroke-dasharray", "3,2");
  vline.setAttribute("y1", "0");
  vline.setAttribute("y2", String(height));

  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("rx", "4");
  bg.setAttribute("fill", "#0b0f1a");
  bg.setAttribute("stroke", "#1e293b");
  bg.setAttribute("stroke-width", "1");

  const tDate = document.createElementNS(ns, "text");
  tDate.setAttribute("font-size", "9");
  tDate.setAttribute("fill", "#64748b");
  tDate.setAttribute("font-family", FF);

  const tVal = document.createElementNS(ns, "text");
  tVal.setAttribute("font-size", "10");
  tVal.setAttribute("font-weight", "700");
  tVal.setAttribute("font-family", FF);

  const tPrice = document.createElementNS(ns, "text");
  tPrice.setAttribute("font-size", "9");
  tPrice.setAttribute("fill", "#475569");
  tPrice.setAttribute("font-family", FF);

  g.append(vline, bg, tDate, tVal, tPrice);

  // Transparent overlay to capture mouse events over the data area
  const overlay = document.createElementNS(ns, "rect");
  overlay.setAttribute("x", String(padL));
  overlay.setAttribute("y", "0");
  overlay.setAttribute("width", String(innerW));
  overlay.setAttribute("height", String(height));
  overlay.setAttribute("fill", "transparent");
  overlay.style.cursor = "crosshair";

  svg.appendChild(g);
  svg.appendChild(overlay);

  function xAt(i) {
    return isBar
      ? padL + (i + 0.5) / n * innerW
      : padL + (i / (n - 1)) * innerW;
  }

  function idxAt(mx) {
    return isBar
      ? Math.max(0, Math.min(n - 1, Math.floor((mx - padL) / innerW * n)))
      : Math.max(0, Math.min(n - 1, Math.round((mx - padL) / innerW * (n - 1))));
  }

  overlay.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (W / rect.width);
    const idx  = idxAt(mx);
    const x    = xAt(idx);

    vline.setAttribute("x1", x.toFixed(1));
    vline.setAttribute("x2", x.toFixed(1));

    const val      = values[idx];
    const price    = prices[idx];
    const hasPrice = price != null;

    tDate.textContent = dates[idx];
    tVal.textContent  = fmtVal(val);
    tVal.setAttribute("fill", colorFn(val));
    tPrice.textContent = hasPrice ? `price  ${price.toLocaleString()}` : "";

    const ttW = 124;
    const ttH = hasPrice ? 46 : 32;
    const ttX = (W - padR - x) < ttW + 14 ? x - ttW - 8 : x + 8;
    const ttY = 5;

    bg.setAttribute("x",      ttX.toFixed(1));
    bg.setAttribute("y",      ttY.toFixed(1));
    bg.setAttribute("width",  String(ttW));
    bg.setAttribute("height", String(ttH));

    tDate.setAttribute("x",  (ttX + 7).toFixed(1));
    tDate.setAttribute("y",  (ttY + 12).toFixed(1));
    tVal.setAttribute("x",   (ttX + 7).toFixed(1));
    tVal.setAttribute("y",   (ttY + 25).toFixed(1));
    tPrice.setAttribute("x", (ttX + 7).toFixed(1));
    tPrice.setAttribute("y", (ttY + 37).toFixed(1));

    g.style.display = "";
  });

  overlay.addEventListener("mouseleave", () => { g.style.display = "none"; });
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------
function renderTable(rows) {
  const hdrs = ["Date", "Lev Long", "Lev Short", "Lev Net", "Deal Long", "Deal Short", "Deal Net", "AM Long", "AM Short", "AM Net", "OI", "Price"];
  const thead = `<thead><tr>${hdrs.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${[...rows].reverse().map((r) => {
    const lN  = (r.ll ?? 0) - (r.ls ?? 0);
    const dN  = (r.dl ?? 0) - (r.ds ?? 0);
    const amN = (r.al ?? 0) - (r["as_"] ?? 0);
    const c   = (v, p, n) => `color:${v >= 0 ? p : n};font-weight:700`;
    return `<tr>
      <td>${r.d}</td>
      <td style="color:#e2e8f0">${fmtFull(r.ll ?? 0)}</td>
      <td style="color:#e2e8f0">${fmtFull(r.ls ?? 0)}</td>
      <td style="${c(lN, COLORS.levMoney.pos, COLORS.levMoney.neg)}">${fmtFull(lN)}</td>
      <td style="color:#e2e8f0">${fmtFull(r.dl ?? 0)}</td>
      <td style="color:#e2e8f0">${fmtFull(r.ds ?? 0)}</td>
      <td style="${c(dN, COLORS.dealer.pos, COLORS.dealer.neg)}">${fmtFull(dN)}</td>
      <td style="color:#e2e8f0">${fmtFull(r.al ?? 0)}</td>
      <td style="color:#e2e8f0">${fmtFull(r["as_"] ?? 0)}</td>
      <td style="${c(amN, COLORS.assetMgr.pos, COLORS.assetMgr.neg)}">${fmtFull(amN)}</td>
      <td style="color:${COLORS.oi}">${fmtFull(r.oi ?? 0)}</td>
      <td style="color:${COLORS.price}">${r.p != null ? r.p.toLocaleString() : "—"}</td>
    </tr>`;
  }).join("")}</tbody>`;
  document.getElementById("table-wrap").innerHTML = `<table>${thead}${tbody}</table>`;
}

// ---------------------------------------------------------------------------
// Sparkline SVG
// ---------------------------------------------------------------------------
function sparklineSVG(data, w, h, color) {
  if (data.length < 2) return "";
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = data[data.length - 1], prev = data[data.length - 2];
  const ly = h - ((last - min) / range) * (h - 4) - 2;
  return `<svg width="${w}" height="${h}" style="display:block;flex-shrink:0">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${w}" cy="${ly.toFixed(1)}" r="2.5" fill="${last >= prev ? "#34d399" : "#f87171"}"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
function fmtFull(n)  { return Number(n).toLocaleString(); }
function fmtK(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
// Flip value: show as signed percentage points, 1 decimal
function fmtFlip(v) {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------
function extractSymbol(name) {
  const pair = fxPair(name);
  if (pair) return pair;
  const part = name.split(" - ")[0].trim();
  // If the name already contains a slash it's already in pair format (e.g. MICRO USD/CHF)
  if (part.includes("/")) return part.length <= 14 ? part : part.slice(0, 14);
  if (part.length <= 14) return part;
  const words = part.split(" ");
  let s = "";
  for (const w of words) { if ((s + w).length > 12) break; s += (s ? " " : "") + w; }
  return s || part.slice(0, 12);
}
function extractExchange(name) {
  const part = (name.split(" - ")[1] ?? "").trim().toUpperCase();
  return ({ "CHICAGO MERCANTILE EXCHANGE": "CME", "CHICAGO BOARD OF TRADE": "CBOT",
            "NEW YORK MERCANTILE EXCHANGE": "NYMEX", "COMMODITY EXCHANGE": "COMEX",
            "ICE FUTURES U.S.": "ICE" })[part] ?? part.slice(0, 6);
}
function cleanName(name) { return name.split(" - ")[0].trim(); }
