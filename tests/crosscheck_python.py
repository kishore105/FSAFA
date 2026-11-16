"""Independent re-computation (Python) of key figures straight from the raw Screener
JSON, compared with the JavaScript engine's output. Run: python3 tests/crosscheck_python.py"""
import json, math, subprocess, sys, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS = sys.argv[1:] or ["TCS", "IDEA", "ADANIENT", "TATASTEEL", "ASIANPAINT", "SUZLON"]

def col(block, label, year):
    if label not in block["rows"] or year not in block["cols"]: return None
    return block["rows"][label][block["cols"].index(year)]
def sch(raw, sec, label, year):
    blk = {"pl": raw["pl"], "bs": raw["bs"]}[sec]
    s = raw["schedules"]["profit-loss" if sec == "pl" else "balance-sheet"]
    if label not in s or year not in blk["cols"]: return None
    return s[label][blk["cols"].index(year)]
z = lambda v: v or 0

def py_metrics(raw):
    yrs = [c for c in raw["pl"]["cols"] if c != "TTM"]
    t, s = yrs[-1], yrs[-2]
    P = lambda l, y: col(raw["pl"], l, y); B = lambda l, y: col(raw["bs"], l, y); C = lambda l, y: col(raw["cf"], l, y)
    eq = lambda y: B("Equity Capital", y) + B("Reserves", y)
    ta = lambda y: B("Total Assets", y)
    ebit = P("Profit before tax", t) + P("Interest", t)
    ca = B("Other Assets", t)
    cl = B("Other Liabilities", t) - z(sch(raw, "bs", "Non controlling int", t)) + z(sch(raw, "bs", "Short term Borrowings", t))
    tl = ta(t) - eq(t)
    zdd = 6.56 * (ca - cl) / ta(t) + 3.26 * B("Reserves", t) / ta(t) + 6.72 * ebit / ta(t) + 1.05 * eq(t) / tl
    sloan = (P("Net Profit", t) - C("Cash from Operating Activity", t)) / ((ta(t) + ta(s)) / 2)
    ic = ebit / P("Interest", t) if P("Interest", t) else float("inf")
    de = B("Borrowings", t) / eq(t) if eq(t) > 0 else None
    rec = lambda y: sch(raw, "bs", "Trade receivables", y)
    dsri = (rec(t) / P("Sales", t)) / (rec(s) / P("Sales", s))
    cfo, np_ = C("Cash from Operating Activity", t), P("Net Profit", t)
    tata = (np_ - cfo) / ta(t)
    cce = cfo / P("Operating Profit", t) if P("Operating Profit", t) > 0 else None
    return {"zDouble": zdd, "sloan": sloan, "intCover": ic, "de": de, "DSRI": dsri, "TATA": tata, "cce": cce, "fy": t}

js = r"""
require('./assets/models.js'); const M = globalThis.Models; const fs = require('fs');
const out = {};
for (const t of process.argv.slice(1)) {
  const m = M.fromScreener(JSON.parse(fs.readFileSync('data/companies/' + t + '.json')));
  const i = m.n - 1, a = M.assess(m, i);
  out[t] = { zDouble: a.z.zDouble, sloan: a.acc.sloan, intCover: a.sol.intCover, de: a.sol.de, DSRI: a.b.raw.DSRI, TATA: a.b.raw.TATA, cce: a.liq.cce, fy: m.years[i] };
}
console.log(JSON.stringify(out));
"""
res = json.loads(subprocess.check_output(["node", "-e", js, *TICKERS], cwd=HERE))
bad = 0
for t in TICKERS:
    raw = json.load(open(os.path.join(HERE, "data", "companies", t + ".json")))
    p, j = py_metrics(raw), res[t]
    for k in p:
        a, b = p[k], j[k]
        ok = a == b if isinstance(a, str) or a is None or b is None else math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12)
        bad += not ok
        if not ok: print(f"MISMATCH {t} {k}: python {a} vs js {b}")
    print(f"{t:11s} {p['fy']}  Z''={p['zDouble']:.3f}  Sloan={p['sloan']:.4f}  IC={p['intCover']:.2f}  D/E={p['de'] if p['de'] is None else round(p['de'],3)}  DSRI={p['DSRI']:.3f}  TATA={p['TATA']:.4f}  ok")
print("\nAll figures match." if not bad else f"\n{bad} mismatches")
