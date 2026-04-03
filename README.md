# COT Dashboard

Interactive dashboard for the CFTC **Traders in Financial Futures – Futures Only** Commitment of Traders report.

**Live site:** https://fractalengineer.github.io/COT

Data is fetched automatically every Friday after the CFTC release and the site updates within minutes.

---

## What it shows

133 financial futures instruments across Equity Index, Interest Rates, Currencies, and Crypto — each with a full weekly history from 2006 to present.

### Per-instrument view
- **Stat cards** — latest net position for Leveraged Money, Dealer, and Asset Manager, with week-over-week change
- **Position Breakdown** — long/short bar for each trader category, with the flip value (long bias − short bias) displayed at the meeting point
- **Net position charts** — Leveraged Money, Dealer, and Asset Manager bar charts over the selected timeframe, with price overlay when available
- **Open Interest** area chart with price overlay
- **Hover crosshair** — snap to any data point across all charts; shows date, net value, and price
- **Table view** — raw weekly data for every column

### Sidebar
- All 133 instruments, searchable and filterable by category
- Each card shows the latest **Lev / Deal / AM flip values** (% of OI long minus short), color-coded green/red by direction
- Sparkline of the last 26 weeks of Leveraged Money flip

### Color convention
All three main trader categories use the same green/red scheme — **green = net long bias, red = net short bias**. The chart label identifies which trader you are looking at.

| Category | Description |
|---|---|
| **Leveraged Money** | Hedge funds, CTAs, speculators |
| **Dealer** | Bank intermediaries, commercial hedgers |
| **Asset Manager** | Institutional funds, pension funds |
| **Other Reportable** | Amber/gray — miscellaneous |

### Currency display
FX instruments show standard pair notation in the title (e.g. `EUR/USD`, `USD/JPY`, `GBP/USD`, `DXY`) rather than the raw CFTC name. The full CFTC name is shown as a subtitle.

### Timeframes
13W · 26W · 52W · All — applies to all charts simultaneously.

---

## Data sources

**COT data:** [CFTC Commitment of Traders – Traders in Financial Futures; Futures Only](https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm)
Released every Friday at ~3:30 PM ET, reflecting positions as of the prior Tuesday.

**Price overlays:** Yahoo Finance (via yfinance). Weekly close prices matched to CFTC report dates within a 5-day window. Covers major equity indices, FX pairs, rates, and crypto.

---

## Local setup

### 1. Seed historical data (run once)

```bash
pip install -r scripts/requirements.txt
python scripts/fetch.py --mode historical
```

Downloads all yearly ZIP files from CFTC (2006–present), writes `data/fin_futures.csv`, generates `docs/data/*.json` per instrument, and fetches price history from Yahoo Finance.

### 2. Run the dashboard locally

```bash
cd docs
python -m http.server 8000
# Open http://localhost:8000
```

No build step — pure HTML/CSS/JS.

### 3. Incremental update (same as GitHub Actions)

```bash
python scripts/fetch.py --mode incremental
```

Downloads the current year only, appends any new rows, and regenerates affected JSON files.

### 4. Rebuild JSON files only

```bash
python scripts/fetch.py --mode reprocess
```

Rebuilds all `docs/data/*.json` from the existing `data/fin_futures.csv` without re-downloading CFTC data. Also re-fetches all price overlays from Yahoo Finance. Use this after changing the JSON schema or expanding the ticker map.

---

## Project structure

```
COT/
├── docs/                   # Static site (deployed to GitHub Pages)
│   ├── index.html
│   ├── app.js              # All UI logic (~750 lines, vanilla JS)
│   ├── style.css           # Dark theme, ~430 lines
│   └── data/
│       ├── instruments.json    # Metadata for all 133 instruments
│       └── *.json              # Per-instrument time series + prices
│
├── data/
│   └── fin_futures.csv     # Master CSV — all instruments, all years (~44k rows)
│
├── scripts/
│   ├── fetch.py            # Data pipeline (download → parse → price → JSON)
│   └── requirements.txt
│
└── .github/workflows/
    ├── fetch-data.yml      # Weekly data fetch (Fridays 21:45 UTC)
    └── deploy-pages.yml    # Deploy docs/ to GitHub Pages on push to main
```

---

## GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `fetch-data.yml` | Every Friday 21:45 UTC + manual | Runs incremental fetch, commits new data |
| `deploy-pages.yml` | Push to `main` touching `docs/**` | Deploys `docs/` to GitHub Pages |

**One-time setup:** In repo Settings → Pages, set Source to **GitHub Actions**.

You can trigger a manual run from the Actions tab using `workflow_dispatch`. The `historical` mode downloads the full archive; `reprocess` rebuilds JSONs from the existing CSV (faster, useful after schema changes).

---

## Tech stack

- **Frontend:** Vanilla JS, HTML5, CSS3, SVG charts — no frameworks, no build step
- **Data pipeline:** Python 3.12, pandas, requests, yfinance
- **Hosting:** GitHub Pages (static)
- **Automation:** GitHub Actions
