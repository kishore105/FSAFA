/* Reproduces the worked examples used in the course material with the
   dashboard's own engine (assets/models.js). Run: node tests/validate_course_examples.js */
require("../assets/models.js");
const M = globalThis.Models;
let fails = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} got ${(+got).toFixed(4)}  expected ${want}`);
};
const wide = (cols, rows) => ({ years: cols, rows: Object.entries(rows).map(([k, v]) => [k, v]) });

// 1. Ohlson O-score example: TA 1000, TL 600, WC 150, CA 400, CL 250, NI 80 (prior 60), FFO 120, GNP index 100
let m = M.fromWide("Ohlson example", wide(["Y0", "Y1"], {
  "Total assets": [1000, 1000], "Share capital": [100, 100], "Reserves": [300, 300],
  "Current assets": [400, 400], "Current liabilities": [250, 250],
  "Net profit": [60, 80], "Depreciation": [40, 40], "Revenue": [1000, 1000],
}), "Services");
const o = M.ohlson(m, 1);
check("Ohlson O-score (worked example 0.564)", o.T, 0.564, 0.002);
check("Ohlson probability e^O/(1+e^O)", o.p, Math.exp(0.564) / (1 + Math.exp(0.564)), 0.001);

// 2. Liquidity case: revenue 1,800, EBITDA 225, PAT 105, CFO 45, CA 810, CL 450,
//    cash 30, receivables 390, inventory 300, TA 1,200 -> 1,500, cash expenses 1,350
m = M.fromWide("Liquidity case", wide(["FY25", "FY26"], {
  "Revenue": [1500, 1800], "EBITDA": [180, 225], "Net profit": [90, 105], "CFO": [135, 45],
  "Total assets": [1200, 1500], "Current assets": [700, 810], "Current liabilities": [400, 450],
  "Cash": [40, 30], "Trade receivables": [300, 390], "Inventories": [250, 300], "Total expenses": [1320, 1350],
}), "Capital Goods");
const L = M.liquidity(m, 1, { cash: 100, rec: 80, inv: 40, other: 0 });
check("Current ratio (1.80)", L.currentRatio, 1.8, 0.005);
check("Working capital days (73)", L.wcDays, 73, 0.5);
check("Operating cash flow ratio (0.10)", L.ocfRatio, 0.10, 0.001);
check("Cash conversion efficiency (20%)", L.cce, 0.20, 0.001);
check("Accrual ratio (4.4%)", M.accruals(m, 1).sloan, 0.0444, 0.0005);
check("Time-adjusted current ratio (1.03)", L.tacr, 1.03, 0.005);
// Defensive assets in the case include Rs 10 cr of short-term investments that Screener does not separate
check("Defensive interval, cash + receivables (113.5 d)", L.dir, 420 / (1350 / 365), 0.5);

// 3. Debt sizing workbook: CFADS 75, 37.5, 120, 85, 120.4, 365; DSCR 3; rate 7.5% -> NPV 194.28
const d = M.debtCapacity(m, 1, { dscr: 3, rate: 7.5, tenor: 6, growth: 0, maintPct: 0, cfadsSeries: [75, 37.5, 120, 85, 120.4, 365] });
check("Debt sizing: maximum debt (194.28)", d.maxDebt, 194.2774, 0.001);
check("Debt sizing: year-1 interest (14.57)", d.rows[0].interest, 14.5708, 0.001);
check("Debt sizing: closing balance after tenor (0)", d.rows[5].close, 0, 0.001);

// 4. Borrower Quality Rating blend and DSCR-limited loan size
const bq = M.bqr(30, { promoter: "Strong", related: "Weak" }, 0);
check("BQR combined = 0.6 x 70 + 0.4 x 62.5", bq.combined, 0.6 * 70 + 0.4 * 62.5, 1e-9);
const fs = require("fs");
const tm = M.fromScreener(JSON.parse(fs.readFileSync(__dirname + "/../data/companies/TCS.json")));
const tt = tm.n - 1, base = { grade: 3, loanType: "unsecured", debt: M.DEFAULT_DEBT, amount: 0 };
const cap = M.structure(tm, tt, base).caps.dscr;
check("Loan at DSCR limit gives DSCR = required 1.5x", M.structure(tm, tt, { ...base, amount: cap }).pf.dscr, 1.5, 1e-9);

console.log(fails ? `\n${fails} check(s) failed` : "\nAll course examples reproduced.");
process.exit(fails ? 1 : 0);
