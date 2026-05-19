"""
CFTC Traders in Financial Futures – Futures Only
Data fetcher: downloads yearly ZIP files, processes to master CSV and per-instrument JSON.

Modes (--mode):
  historical    Download all years (2006-present), seed data/ and docs/data/
  incremental   Download current year only, append new rows if any (default)
  reprocess     Rebuild all docs/data/*.json from existing data/fin_futures.csv
"""

import argparse
import io
import json
import os
import sys
import zipfile
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).parent.parent
DATA_DIR = REPO_ROOT / "data"
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"
MASTER_CSV = DATA_DIR / "fin_futures.csv"
INSTRUMENTS_JSON = DOCS_DATA_DIR / "instruments.json"

DATA_DIR.mkdir(exist_ok=True)
DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# CFTC URL templates
# ---------------------------------------------------------------------------
# Main yearly files (2017-present)
YEARLY_URL = "https://www.cftc.gov/files/dea/history/fut_fin_txt_{year}.zip"
# Combined 2006-2016 archive (different filename prefix)
HIST_URL = "https://www.cftc.gov/files/dea/history/fin_fut_txt_2006_2016.zip"
FIRST_YEARLY = 2017
START_YEAR = 2006

# ---------------------------------------------------------------------------
# Column mapping
# The ZIP headers vary across years; normalize everything to snake_case then
# map known aliases to canonical names.
# ---------------------------------------------------------------------------
CANONICAL_COLS = {
    # identifiers
    "market_and_exchange_names": "name",
    "as_of_date_in_form_yymmdd": None,          # drop
    "report_date_as_mm_dd_yyyy": "report_date",
    "report_date_as_yyyy_mm_dd": "report_date",
    "cftc_contract_market_code": "code",
    "cftc_market_code": None,                   # drop
    "cftc_region_code": None,                   # drop
    "cftc_commodity_code": None,                # drop
    # open interest
    "open_interest_all": "oi",
    # dealer
    "dealer_positions_long_all": "dl",
    "dealer_positions_short_all": "ds",
    "dealer_positions_spread_all": "dsp",
    # asset manager
    "asset_mgr_positions_long_all": "al",
    "asset_mgr_positions_short_all": "as_",
    "asset_mgr_positions_spread_all": "asp",
    # leveraged money
    "lev_money_positions_long_all": "ll",
    "lev_money_positions_short_all": "ls",
    "lev_money_positions_spread_all": "lsp",
    # other reportable
    "other_rept_positions_long_all": "ol",
    "other_rept_positions_short_all": "os_",
    "other_rept_positions_spread_all": "osp",
    # % of OI
    "pct_of_open_interest_all": None,
    "pct_of_oi_dealer_long_all": "pct_dl",
    "pct_of_oi_dealer_short_all": "pct_ds",
    "pct_of_oi_asset_mgr_long_all": "pct_al",
    "pct_of_oi_asset_mgr_short_all": "pct_as",
    "pct_of_oi_lev_money_long_all": "pct_ll",
    "pct_of_oi_lev_money_short_all": "pct_ls",
    # trader counts
    "traders_tot_all": "tr_tot",
    "traders_dealer_long_all": "tr_dl",
    "traders_asset_mgr_long_all": "tr_al",
    "traders_lev_money_long_all": "tr_ll",
    # contract units (kept for tooltip display)
    "contract_units": "units",
}

# Columns to keep in master CSV (keys are the canonical short names above)
KEEP_COLS = [
    "report_date", "name", "code",
    "oi",
    "dl", "ds", "dsp",
    "al", "as_", "asp",
    "ll", "ls", "lsp",
    "ol", "os_", "osp",
    "pct_dl", "pct_ds",
    "pct_al", "pct_as",
    "pct_ll", "pct_ls",
    "tr_tot", "tr_dl", "tr_al", "tr_ll",
    "units",
]

INT_COLS = [
    "oi",
    "dl", "ds", "dsp",
    "al", "as_", "asp",
    "ll", "ls", "lsp",
    "ol", "os_", "osp",
    "tr_tot", "tr_dl", "tr_al", "tr_ll",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_col(c: str) -> str:
    return (
        c.strip().lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace("(", "")
        .replace(")", "")
        .replace("/", "_")
    )


def download_zip(url: str) -> bytes:
    print(f"  Downloading {url} ...", flush=True)
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return resp.content


def parse_zip(data: bytes) -> pd.DataFrame:
    """Extract the text/CSV file from a CFTC ZIP and return a DataFrame."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        # Pick the first .txt or .csv file
        target = next((n for n in names if n.lower().endswith((".txt", ".csv"))), names[0])
        with zf.open(target) as f:
            raw = pd.read_csv(f, low_memory=False)

    # Normalize column names
    raw.columns = [normalize_col(c) for c in raw.columns]

    # Map to canonical short names, drop columns mapped to None
    rename = {}
    drop = []
    for orig, canon in CANONICAL_COLS.items():
        if orig in raw.columns:
            if canon is None:
                drop.append(orig)
            else:
                rename[orig] = canon
    raw = raw.drop(columns=drop, errors="ignore")
    raw = raw.rename(columns=rename)

    # Keep only the columns we care about (ignore anything else)
    present = [c for c in KEEP_COLS if c in raw.columns]
    raw = raw[present]

    # Normalise report_date to YYYY-MM-DD
    if "report_date" in raw.columns:
        raw["report_date"] = pd.to_datetime(raw["report_date"]).dt.strftime("%Y-%m-%d")

    # Numeric coercion
    for col in INT_COLS:
        if col in raw.columns:
            raw[col] = pd.to_numeric(raw[col], errors="coerce").fillna(0).astype("int64")

    for col in ["pct_dl", "pct_ds", "pct_al", "pct_as", "pct_ll", "pct_ls"]:
        if col in raw.columns:
            raw[col] = pd.to_numeric(raw[col], errors="coerce").round(1)

    return raw


def load_master() -> pd.DataFrame:
    if MASTER_CSV.exists():
        return pd.read_csv(MASTER_CSV, dtype={"code": str})
    return pd.DataFrame()


def save_master(df: pd.DataFrame) -> None:
    df = df.sort_values(["code", "report_date"]).reset_index(drop=True)
    df.to_csv(MASTER_CSV, index=False)
    print(f"  Saved {len(df):,} rows to {MASTER_CSV}")


def infer_category(name: str) -> str:
    n = name.upper()
    if any(k in n for k in ["S&P", "NASDAQ", "RUSSELL", "NIKKEI", "DOW JONES", "DJIA", "VIX", "STOCK INDEX", "EQUITY INDEX", "FTSE", "DAX"]):
        return "Equity Index"
    if any(k in n for k in ["BITCOIN", "ETHER", "CRYPTO"]):
        return "Crypto"
    # Check interest rates before currencies to avoid EURODOLLAR matching "DOLLAR"
    if any(k in n for k in ["TREASURY", "EURODOLLAR", "SOFR", "FEDERAL FUND", "FED FUND", "MUNICIPAL", "LIBOR", "INTEREST RATE SWAP"]):
        return "Interest Rates"
    if any(k in n for k in ["FX", "YEN", "POUND", "FRANC", "PESO", "REAL", "RUBLE", "YUAN", "RENMINBI", "WON", "RAND", "KRONE", "KRONA", "FORINT", "ZLOTY", "LIRA", "RUPEE", "KORUNA", "DOLLAR INDEX", "DOLLAR"]):
        return "Currencies"
    if "EURO" in n:  # Euro FX — already ruled out EURODOLLAR above
        return "Currencies"
    return "Other"


# ---------------------------------------------------------------------------
# Price data (yfinance)
# ---------------------------------------------------------------------------
# Name substring → Yahoo Finance ticker (first match wins, ordered by specificity)
NAME_TO_TICKER = [
    # ---- Equity indices ----
    ("E-MINI S&P 500",               "^GSPC"),
    ("E-MINI S&P",                   "^GSPC"),
    ("S&P 500",                      "^GSPC"),
    ("E-MINI NASDAQ",                "^NDX"),
    ("NASDAQ-100",                   "^NDX"),
    ("NASDAQ COMPOSITE",             "^IXIC"),
    ("MICRO E-MINI DOW",             "^DJI"),
    ("DOW JONES",                    "^DJI"),
    ("DJIA",                         "^DJI"),
    ("RUSSELL 2000",                 "^RUT"),
    ("RUSSELL 1000",                 "^RUI"),
    ("S&P MIDCAP 400",               "^SP400"),
    ("S&P 400",                      "^SP400"),
    ("NIKKEI STOCK AVERAGE",         "^N225"),
    ("NIKKEI",                       "^N225"),
    ("FTSE 100",                     "^FTSE"),
    ("FTSE/JSE",                     "^J200.JO"),
    ("DAX",                          "^GDAXI"),
    ("EURO STOXX 50",                "^STOXX50E"),
    ("EURO STOXX",                   "^STOXX50E"),
    ("S&P/TSX",                      "^GSPTSE"),
    ("MSCI EAFE",                    "EFA"),
    ("MSCI EMERGING",                "EEM"),
    ("VIX",                          "^VIX"),
    # ---- US Treasuries ----
    ("ULTRA U.S. TREASURY BOND",     "^TYX"),
    ("ULTRA LONG-TERM U.S.",         "^TYX"),
    ("30-YEAR U.S. TREASURY BOND",   "^TYX"),
    ("U.S. TREASURY BOND",           "^TYX"),
    ("LONG-TERM U.S.",               "^TYX"),
    ("10-YEAR U.S. TREASURY NOTE",   "^TNX"),
    ("ULTRA 10-YEAR U.S.",           "^TNX"),
    ("10-YEAR U.S.",                 "^TNX"),
    ("7-YEAR U.S. TREASURY NOTE",    "^FVX"),
    ("7-YEAR U.S.",                  "^FVX"),
    ("5-YEAR U.S. TREASURY NOTE",    "^FVX"),
    ("5-YEAR U.S.",                  "^FVX"),
    ("3-YEAR U.S. TREASURY NOTE",    "^IRX"),
    ("3-YEAR U.S.",                  "^IRX"),
    ("2-YEAR U.S. TREASURY NOTE",    "^IRX"),
    ("2-YEAR U.S.",                  "^IRX"),
    # ---- Short-term rates ----
    ("3-MONTH SOFR",                 "SR3=F"),
    ("1-MONTH SOFR",                 "SR1=F"),
    ("SOFR",                         "SR3=F"),
    ("30-DAY FEDERAL FUND",          "ZQ=F"),
    ("FEDERAL FUND",                 "ZQ=F"),
    ("EURODOLLAR",                   "GE=F"),
    # ---- Major FX ----
    ("EURO FX",                      "EURUSD=X"),
    ("EURO",                         "EURUSD=X"),
    ("JAPANESE YEN",                 "USDJPY=X"),
    ("BRITISH POUND",                "GBPUSD=X"),
    ("SWISS FRANC",                  "USDCHF=X"),
    ("AUSTRALIAN DOLLAR",            "AUDUSD=X"),
    ("CANADIAN DOLLAR",              "USDCAD=X"),
    ("NEW ZEALAND DOLLAR",           "NZDUSD=X"),
    ("MEXICAN PESO",                 "USDMXN=X"),
    ("SOUTH AFRICAN RAND",           "USDZAR=X"),
    # ---- Additional FX ----
    ("U.S. DOLLAR INDEX",            "DX=F"),
    ("DOLLAR INDEX",                 "DX=F"),
    ("SWEDISH KRONA",                "USDSEK=X"),
    ("NORWEGIAN KRONE",              "USDNOK=X"),
    ("BRAZILIAN REAL",               "USDBRL=X"),
    ("KOREAN WON",                   "USDKRW=X"),
    ("CHINESE RENMINBI",             "USDCNY=X"),
    ("OFFSHORE CHINESE RENMINBI",    "USDCNH=X"),
    ("RUSSIAN RUBLE",                "USDRUB=X"),
    ("TURKISH LIRA",                 "USDTRY=X"),
    ("INDIAN RUPEE",                 "USDINR=X"),
    ("SINGAPORE DOLLAR",             "USDSGD=X"),
    ("CZECH KORUNA",                 "USDCZK=X"),
    ("POLISH ZLOTY",                 "USDPLN=X"),
    ("HUNGARIAN FORINT",             "USDHUF=X"),
    ("ISRAELI SHEKEL",               "USDILS=X"),
    # ---- Crypto ----
    ("BITCOIN",                      "BTC-USD"),
    ("ETHER",                        "ETH-USD"),
]


def get_ticker(name: str) -> str | None:
    n = name.upper()
    for substr, ticker in NAME_TO_TICKER:
        if substr in n:
            return ticker
    return None


def fetch_prices_bulk(unique_tickers: list[str]) -> dict[str, dict[str, float]]:
    """Download weekly close prices. Returns {ticker: {YYYY-MM-DD: close}}."""
    result: dict[str, dict[str, float]] = {}
    if not unique_tickers:
        return result
    try:
        import yfinance as yf
    except ImportError:
        print("  yfinance not installed — skipping price data (pip install yfinance)")
        return result

    print(f"  Fetching prices for {len(unique_tickers)} unique tickers…")
    for ticker in unique_tickers:
        try:
            hist = yf.Ticker(ticker).history(start="2005-01-01", interval="1wk", auto_adjust=True)
            prices: dict[str, float] = {}
            for idx, row in hist.iterrows():
                if pd.notna(row.get("Close")):
                    prices[idx.strftime("%Y-%m-%d")] = round(float(row["Close"]), 4)
            result[ticker] = prices
            print(f"    {ticker}: {len(prices)} weekly bars")
        except Exception as e:
            print(f"    WARNING: {ticker}: {e}")
            result[ticker] = {}
    return result


def nearest_price(price_map: dict[str, float], date_str: str, max_days: int = 5) -> float | None:
    """Return the closest available price within max_days of date_str."""
    from datetime import datetime as dt, timedelta
    target = dt.strptime(date_str, "%Y-%m-%d")
    for delta in range(max_days + 1):
        for sign in ([0] if delta == 0 else [1, -1]):
            key = (target + timedelta(days=delta * sign)).strftime("%Y-%m-%d")
            if key in price_map:
                return price_map[key]
    return None


def generate_instrument_jsons(df: pd.DataFrame) -> None:
    """Write one JSON file per instrument into docs/data/."""
    # ---- Pre-fetch prices for all instruments that have a known ticker ----
    groups = df.groupby("code", sort=False)
    code_to_ticker: dict[str, str] = {}
    for code, grp in groups:
        name = grp["name"].iloc[-1]
        ticker = get_ticker(name)
        if ticker:
            code_to_ticker[str(code)] = ticker

    unique_tickers = list(set(code_to_ticker.values()))
    ticker_prices = fetch_prices_bulk(unique_tickers)  # {ticker: {date: close}}

    # ---- Write per-instrument JSON ----
    instruments = []
    for code, grp in groups:
        grp = grp.sort_values("report_date")
        display_name = grp["name"].iloc[-1]
        units = grp["units"].iloc[-1] if "units" in grp.columns else ""

        ticker    = code_to_ticker.get(str(code))
        price_map = ticker_prices.get(ticker, {}) if ticker else {}

        rows = []
        for _, row in grp.iterrows():
            record = {"d": row["report_date"], "oi": int(row.get("oi", 0))}
            for col in ["dl", "ds", "dsp", "al", "as_", "asp", "ll", "ls", "lsp", "ol", "os_", "osp"]:
                if col in row:
                    record[col] = int(row[col])
            for col in ["pct_dl", "pct_ds", "pct_al", "pct_as", "pct_ll", "pct_ls"]:
                if col in row and pd.notna(row[col]):
                    record[col] = float(row[col])
            for col in ["tr_tot", "tr_dl", "tr_al", "tr_ll"]:
                if col in row and pd.notna(row[col]):
                    record[col] = int(row[col])
            # Attach nearest weekly close price when available
            if price_map:
                p = nearest_price(price_map, row["report_date"])
                if p is not None:
                    record["p"] = p
            rows.append(record)

        payload = {
            "code": str(code),
            "name": display_name,
            "units": str(units) if pd.notna(units) else "",
            "rows": rows,
        }
        out_path = DOCS_DATA_DIR / f"{code}.json"
        with open(out_path, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"))

        instruments.append({
            "code": str(code),
            "name": display_name,
            "category": infer_category(display_name),
        })

    # Sort instruments alphabetically by name
    instruments.sort(key=lambda x: x["name"])

    with open(INSTRUMENTS_JSON, "w") as fh:
        json.dump(instruments, fh, indent=2)

    print(f"  Wrote {len(instruments)} instrument JSON files to {DOCS_DATA_DIR}")
    print(f"  Wrote {INSTRUMENTS_JSON}")


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def mode_historical() -> None:
    print("=== Historical load ===")
    frames = []

    # 2006-2016 combined archive
    print("Fetching 2006-2016 combined archive...")
    try:
        data = download_zip(HIST_URL)
        frames.append(parse_zip(data))
    except Exception as e:
        print(f"  WARNING: could not fetch 2006-2016 archive: {e}")

    # Individual yearly ZIPs
    current_year = date.today().year
    for year in range(FIRST_YEARLY, current_year + 1):
        url = YEARLY_URL.format(year=year)
        try:
            data = download_zip(url)
            frames.append(parse_zip(data))
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                print(f"  Skipping {year} (not yet available)")
            else:
                print(f"  WARNING: {year}: {e}")
        except Exception as e:
            print(f"  WARNING: {year}: {e}")

    if not frames:
        print("ERROR: No data downloaded.")
        sys.exit(1)

    df = pd.concat(frames, ignore_index=True)
    # Dedup: keep last occurrence (most recent file wins for duplicate dates)
    df = df.drop_duplicates(subset=["code", "report_date"], keep="last")
    save_master(df)
    generate_instrument_jsons(df)
    print("=== Historical load complete ===")


def mode_incremental() -> None:
    print("=== Incremental update ===")
    master = load_master()
    if master.empty:
        print("No master CSV found — run with --mode historical first.")
        sys.exit(1)

    max_date = master["report_date"].max()
    print(f"  Latest date in master: {max_date}")

    current_year = date.today().year
    url = YEARLY_URL.format(year=current_year)
    try:
        data = download_zip(url)
        new_df = parse_zip(data)
    except Exception as e:
        print(f"ERROR: Could not fetch current year data: {e}")
        sys.exit(1)

    new_rows = new_df[new_df["report_date"] > max_date]
    if new_rows.empty:
        print("  No new rows found. Data is up to date.")
        return

    print(f"  Found {len(new_rows)} new rows (up to {new_rows['report_date'].max()})")
    combined = pd.concat([master, new_rows], ignore_index=True)
    combined = combined.drop_duplicates(subset=["code", "report_date"], keep="last")
    save_master(combined)
    generate_instrument_jsons(combined)
    print("=== Incremental update complete ===")


def mode_reprocess() -> None:
    print("=== Reprocessing JSON from master CSV ===")
    master = load_master()
    if master.empty:
        print("No master CSV found.")
        sys.exit(1)
    print(f"  Loaded {len(master):,} rows from {MASTER_CSV}")
    generate_instrument_jsons(master)
    print("=== Reprocess complete ===")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="CFTC COT data fetcher")
    parser.add_argument(
        "--mode",
        choices=["historical", "incremental", "reprocess"],
        default="incremental",
        help="historical: full load | incremental: append new rows | reprocess: rebuild JSON only",
    )
    args = parser.parse_args()

    if args.mode == "historical":
        mode_historical()
    elif args.mode == "incremental":
        mode_incremental()
    elif args.mode == "reprocess":
        mode_reprocess()


if __name__ == "__main__":
    main()
