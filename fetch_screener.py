"""
Data collector for the Corporate Risk Analytics Dashboard.

Source: screener.in public company pages (annual P&L, balance sheet, cash flow,
ratios, quarterly results, shareholding) and the line-item breakdowns that the
site exposes for expandable rows (receivables, inventories, borrowings, etc.).

Usage
    python3 fetch_screener.py              # refresh every Nifty 500 non-financial company
    python3 fetch_screener.py TCS INFY     # refresh named tickers only

Output: one JSON file per company in data/companies/. build_summary.js then
scores every company and writes data/universe.json for the portfolio view.
All ratios and forensic scores are computed in the dashboard itself, so a
company fetched live through serve.py is scored exactly like a snapshot company.
"""
import json
import os
import re
import sys
import time
import datetime as dt
import urllib.request
import urllib.parse
import urllib.error

from bs4 import BeautifulSoup

BASE = "https://www.screener.in"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) research-dashboard"}
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
SNAPSHOT = os.path.join(DATA_DIR, "snapshot.js")
PAUSE = 2.5  # seconds between requests; Screener returns HTTP 429 when hit faster

CO_DIR = os.path.join(DATA_DIR, "companies")
UNIVERSE_CSV = os.path.join(DATA_DIR, "nifty500.csv")
MAX_AGE_DAYS = 6  # files newer than this are kept on a re-run (makes the job resumable)


def universe():
    """Nifty 500 constituents (NSE list) excluding Financial Services: the
    distress and manipulation models are defined for non-financial firms."""
    import csv
    rows = list(csv.DictReader(open(UNIVERSE_CSV, encoding="utf-8")))
    return [(r["Symbol"].strip(), r["Company Name"].strip(), r["Industry"].strip())
            for r in rows if r["Industry"].strip() != "Financial Services"]


SCHEDULES = [
    ("profit-loss", "Expenses"), ("profit-loss", "Other Income"),
    ("balance-sheet", "Borrowings"), ("balance-sheet", "Other Liabilities"),
    ("balance-sheet", "Fixed Assets"), ("balance-sheet", "Other Assets"),
]


def get(url, tries=5):
    wait = PAUSE
    for _ in range(tries):
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "replace")
            time.sleep(PAUSE)
            return body
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(wait * 4)
                wait *= 2
                continue
            raise
        except urllib.error.URLError:
            time.sleep(wait)
            wait *= 2
    raise RuntimeError("Too many retries: " + url)


def num(s):
    """'1,23,456' -> 123456.0 ; '12%' -> 12.0 ; '' -> None"""
    if s is None:
        return None
    s = str(s).replace(",", "").replace("%", "").replace("₹", "").replace("Cr", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_label(s):
    s = re.sub(r"\s*\+\s*$", "", s.strip())
    return s.split("  ")[0].strip()


def parse_table(section):
    t = section.find("table") if section else None
    if t is None:
        return [], {}
    head = [th.get_text(strip=True) for th in t.find("thead").find_all("th")][1:]
    rows = {}
    for tr in t.find("tbody").find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        label = tds[0].get_text(" ", strip=True)
        label = clean_label(label.split("Share of operating")[0] if "CFO/" in label else label)
        rows[label] = [num(td.get_text(strip=True)) for td in tds[1:]]
    return head, rows


def parse_schedule(js, cols):
    """Schedule API returns {item: {col: value, ..., tooltips: {...}}}."""
    out = {}
    for item, vals in js.items():
        if not isinstance(vals, dict):
            continue
        tips = vals.get("tooltips")
        if item.endswith("%") and tips:  # cost lines arrive as % of sales, amounts sit in tooltips
            out[item.replace("%", "").strip()] = [num(tips.get(c)) for c in cols]
        else:
            out[item] = [num(vals.get(c)) for c in cols]
    return out


def fetch(ticker):
    ticker = ticker.upper().strip()
    mode = "consolidated"
    html = get(f"{BASE}/company/{urllib.parse.quote(ticker)}/consolidated/")
    if html is None:
        raise ValueError(f"Ticker {ticker} not found on screener.in")
    soup = BeautifulSoup(html, "html.parser")
    years, pl = parse_table(soup.find("section", id="profit-loss"))
    if not pl or all(v is None for v in pl.get("Sales", pl.get("Revenue", [None]))):
        mode = "standalone"
        html = get(f"{BASE}/company/{urllib.parse.quote(ticker)}/")
        soup = BeautifulSoup(html, "html.parser")
        years, pl = parse_table(soup.find("section", id="profit-loss"))
    if "Revenue" in pl and "Sales" not in pl:
        raise ValueError(f"{ticker} reports in the bank/NBFC format; the models here apply to non-financial firms")

    by, bs = parse_table(soup.find("section", id="balance-sheet"))
    cy, cf = parse_table(soup.find("section", id="cash-flow"))
    ry, ratios = parse_table(soup.find("section", id="ratios"))
    qy, qtr = parse_table(soup.find("section", id="quarters"))
    sy, sh = parse_table(soup.find("section", id="shareholding"))

    m = re.search(r'data-company-id="(\d+)"', html)
    cid = m.group(1) if m else None

    name = soup.find("h1").get_text(strip=True) if soup.find("h1") else ticker
    top = {}
    for li in soup.select("ul#top-ratios li"):
        k = li.find("span", class_="name")
        v = li.find("span", class_="number")
        if k and v:
            top[k.get_text(strip=True)] = num(v.get_text(strip=True))
    about = soup.find("div", class_="about")
    about = about.get_text(" ", strip=True) if about else ""
    peers = soup.find("section", id="peers")
    sector = []
    if peers:
        sector = [a.get_text(strip=True) for a in peers.select("p a")][:4]

    sched = {"profit-loss": {}, "balance-sheet": {}, "cash-flow": {}}
    if cid:
        for section, parent in SCHEDULES:
            cols = years if section == "profit-loss" else (by if section == "balance-sheet" else cy)
            q = urllib.parse.urlencode({"parent": parent, "section": section})
            if mode == "consolidated":
                q += "&consolidated=true"
            body = get(f"{BASE}/api/company/{cid}/schedules/?{q}")
            try:
                sched[section].update(parse_schedule(json.loads(body), cols))
            except (TypeError, ValueError):
                pass

    return {
        "ticker": ticker, "name": name, "basis": mode, "sector": sector,
        "about": about[:600], "top": top,
        "pl": {"cols": years, "rows": pl},
        "bs": {"cols": by, "rows": bs},
        "cf": {"cols": cy, "rows": cf},
        "ratios": {"cols": ry, "rows": ratios},
        "quarters": {"cols": qy, "rows": qtr},
        "shareholding": {"cols": sy, "rows": sh},
        "schedules": sched,
        "source": f"{BASE}/company/{ticker}/" + ("consolidated/" if mode == "consolidated" else ""),
        "fetched": dt.datetime.now().strftime("%d %b %Y %H:%M"),
    }


def save_company(d):
    os.makedirs(CO_DIR, exist_ok=True)
    path = os.path.join(CO_DIR, d["ticker"] + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, separators=(",", ":"))


def fresh(ticker):
    path = os.path.join(CO_DIR, ticker + ".json")
    return os.path.exists(path) and (time.time() - os.path.getmtime(path)) < MAX_AGE_DAYS * 86400


def main(only):
    todo = universe()
    if only:
        todo = [u for u in todo if u[0] in {t.upper() for t in only}] or [(t.upper(), t.upper(), "Added") for t in only]
    failed = []
    for i, (t, nse_name, industry) in enumerate(todo, 1):
        if not only and not os.environ.get("REFRESH_ALL") and fresh(t):
            continue
        try:
            d = fetch(t)
            d["industry"] = industry
            d["nse_name"] = nse_name
            save_company(d)
            n = sum(len(v) for v in d["schedules"].values())
            print(f"[{i}/{len(todo)}] ok   {t:12s} {d['basis']:12s} {len(d['pl']['cols'])} yrs {n} lines", flush=True)
        except Exception as e:
            failed.append(t)
            print(f"[{i}/{len(todo)}] FAIL {t:12s} {e}", flush=True)
    print("done; failed:", " ".join(failed) if failed else "none", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
