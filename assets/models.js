/* Credit Risk Monitor: analytics engine.
   Every figure in the dashboard is computed here from the reported statements
   (Rs crore). The same file runs in the browser and in build_summary.js (Node),
   so the portfolio table and the borrower pages always agree. */
(function (root) {
  "use strict";

  const isNum = (v) => typeof v === "number" && isFinite(v);
  const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
  const sum = (...xs) => { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const z0 = (v) => (isNum(v) ? v : 0);
  const avg2 = (arr, t) => (t > 0 && isNum(arr[t - 1]) && isNum(arr[t]) ? (arr[t - 1] + arr[t]) / 2 : arr[t]);
  const growth = (arr, t, k = 1) => (t - k >= 0 && isNum(arr[t]) && isNum(arr[t - k]) && arr[t - k] > 0 ? (arr[t] / arr[t - k]) ** (1 / k) - 1 : null);

  const MANUFACTURING = new Set(["Capital Goods", "Automobile and Auto Components", "Chemicals", "Metals & Mining",
    "Fast Moving Consumer Goods", "Healthcare", "Construction Materials", "Textiles", "Consumer Durables",
    "Oil Gas & Consumable Fuels"]);

  /* ======================= 1. Statement normalisation ======================= */
  // Screener marks a transition period after a change of financial year as e.g. "Mar 202618m" (18 months)
  // in the profit and loss table, while the balance sheet uses "Mar 2026". Both are matched on "Mar 2026".
  // Years shown on a standalone basis carry an "(S)" tag and line breaks, e.g. "Sep 2024 (S)8m"; both are removed.
  const fyClean = (c) => String(c).replace(/\(S\)/g, "").replace(/\s+/g, " ").trim();
  const fyKey = (c) => fyClean(c).replace(/(\d{4}) ?\d+m$/, "$1");
  const fyMonths = (c) => { const x = fyClean(c).match(/\d{4} ?(\d+)m$/); return x ? +x[1] : 12; };
  function aligned(block, label, years) {
    if (!block || !block.rows || !(label in block.rows)) return years.map(() => null);
    const ix = {}; block.cols.forEach((c, i) => (ix[fyKey(c)] = i));
    return years.map((y) => (y in ix ? (block.rows[label][ix[y]] ?? null) : null));
  }
  function sched(raw, section, label, years) {
    const s = raw.schedules && raw.schedules[section];
    if (!s || !(label in s)) return years.map(() => null);
    const cols = section === "profit-loss" ? raw.pl.cols : section === "balance-sheet" ? raw.bs.cols : raw.cf.cols;
    return aligned({ cols, rows: { x: s[label] } }, "x", years);
  }
  function schedRe(raw, section, re, years) {
    const keys = Object.keys((raw.schedules && raw.schedules[section]) || {}).filter((k) => re.test(k));
    if (!keys.length) return years.map(() => null);
    const parts = keys.map((k) => sched(raw, section, k, years));
    return years.map((_, i) => sum(...parts.map((p) => p[i])));
  }

  function fromScreener(raw) {
    const rawYears = raw.pl.cols.filter((c) => c !== "TTM" && /\d{4}/.test(c));
    const years = rawYears.map(fyKey), months = rawYears.map(fyMonths);
    const P = (l) => aligned(raw.pl, l, years), B = (l) => aligned(raw.bs, l, years);
    const C = (l) => aligned(raw.cf, l, years), R = (l) => aligned(raw.ratios, l, years);
    const SP = (l) => sched(raw, "profit-loss", l, years), SB = (l) => sched(raw, "balance-sheet", l, years);
    const SC = (l) => sched(raw, "cash-flow", l, years);
    const selling = SP("Selling and admin Cost");
    const A = {
      sales: P("Sales"), expenses: P("Expenses"), ebitda: P("Operating Profit"), otherIncome: P("Other Income"),
      interest: P("Interest"), dep: P("Depreciation"), pbt: P("Profit before tax"), taxPct: P("Tax %"),
      np: P("Net Profit"), eps: P("EPS in Rs"), payout: P("Dividend Payout %"),
      cogs: schedRe(raw, "profit-loss", /^(Material Cost|Manufacturing Cost|Power and Fuel|Raw Material)/i, years),
      selling, sga: selling.some(isNum) ? selling : SP("Other Expenses"), sellingReported: selling.some(isNum),
      exceptional: SP("Exceptional items"),
      eqCap: B("Equity Capital"), reserves: B("Reserves"), borrow: B("Borrowings"), otherLiab: B("Other Liabilities"),
      ta: B("Total Assets"), nfa: B("Fixed Assets"), cwip: B("CWIP"), invest: B("Investments"), otherAssets: B("Other Assets"),
      ltb: SB("Long term Borrowings"), stb: SB("Short term Borrowings"), lease: SB("Lease Liabilities"),
      tradePay: SB("Trade Payables"), advCust: SB("Advance from Customers"), minority: SB("Non controlling int"),
      inv: SB("Inventories"), rec: SB("Trade receivables"), cash: SB("Cash Equivalents"), loansAdv: SB("Loans n Advances"),
      otherAssetItems: SB("Other asset items"), grossBlock: SB("Gross Block"), intangibles: SB("Intangible Assets"),
      cfo: C("Cash from Operating Activity"), cfi: C("Cash from Investing Activity"), cff: C("Cash from Financing Activity"),
      fcf: C("Free Cash Flow"), capex: SC("Fixed assets purchased"),
      debtorDays: R("Debtor Days"), invDays: R("Inventory Days"), payDays: R("Days Payable"), cccRep: R("Cash Conversion Cycle"),
    };
    // Flows of a period longer or shorter than 12 months are annualised so that they compare with year-end balances.
    ["sales", "expenses", "ebitda", "otherIncome", "interest", "dep", "pbt", "np", "eps", "cogs", "selling", "sga", "exceptional",
      "cfo", "cfi", "cff", "fcf", "capex"].forEach((k) => {
      A[k] = A[k].map((v, i) => (isNum(v) && months[i] !== 12 ? (v * 12) / months[i] : v));
    });
    const m = finish(raw, years, A);
    m.months = months;
    return m;
  }

  /* Wide file from Prowess dx, Bloomberg or an annual report:
     column A = line item, remaining columns = fiscal years. */
  const IMPORT_FIELDS = {
    sales: ["sales", "revenue", "revenue from operations", "net sales", "total revenue", "total income from operations"],
    expenses: ["total expenses", "operating expenses", "total operating expenses"],
    cogs: ["cogs", "cost of goods sold", "raw material", "material cost", "cost of materials consumed", "raw materials"],
    sga: ["selling and distribution expenses", "selling general and administrative", "sga", "selling and admin"],
    ebitda: ["ebitda", "operating profit", "pbdit", "pbdita"],
    otherIncome: ["other income", "non operating income"],
    interest: ["interest", "finance cost", "finance costs", "interest expense", "interest expenses"],
    dep: ["depreciation", "depreciation and amortisation", "depreciation and amortization", "d&a"],
    pbt: ["pbt", "profit before tax"],
    tax: ["tax", "tax expense", "total tax", "provision for tax"],
    np: ["net profit", "pat", "profit after tax", "net income", "reported profit after tax"],
    exceptional: ["exceptional items", "extraordinary items"],
    eqCap: ["equity capital", "share capital", "paid up equity capital", "equity share capital"],
    reserves: ["reserves", "reserves and surplus", "other equity", "retained earnings", "reserves and funds"],
    ltb: ["long term borrowings", "long term debt"], stb: ["short term borrowings", "short term debt"],
    borrow: ["borrowings", "total debt", "total borrowings"],
    tradePay: ["trade payables", "accounts payable", "sundry creditors"],
    curLiab: ["current liabilities", "total current liabilities", "current liabilities and provisions"],
    curAssets: ["current assets", "total current assets"],
    otherLiab: ["other liabilities"], ta: ["total assets"],
    nfa: ["net fixed assets", "fixed assets", "net block", "property plant and equipment", "net property plant and equipment"],
    cwip: ["cwip", "capital work in progress"], invest: ["investments"],
    inv: ["inventories", "inventory", "stock"],
    rec: ["trade receivables", "receivables", "sundry debtors", "accounts receivable"],
    cash: ["cash", "cash and cash equivalents", "cash and bank", "cash and bank balance"],
    loansAdv: ["loans and advances", "loans advances", "short term loans and advances"],
    cfo: ["cfo", "cash from operating activities", "operating cash flow", "net cash flow from operating activities", "net cash from operating activities"],
    cfi: ["cfi", "cash from investing activities", "net cash flow from investing activities"],
    cff: ["cff", "cash from financing activities", "net cash flow from financing activities"],
    capex: ["capex", "purchase of fixed assets", "capital expenditure"],
  };
  function fromWide(name, table, industry) {
    const years = table.years, n = years.length, blank = () => Array(n).fill(null);
    const look = {}; Object.entries(IMPORT_FIELDS).forEach(([k, al]) => al.forEach((a) => (look[a] = k)));
    const A = {}, matched = [];
    table.rows.forEach(([label, vals]) => {
      const key = look[label.toLowerCase().replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ").trim()];
      if (key && !A[key]) { A[key] = vals; matched.push([label, key]); }
    });
    Object.keys(IMPORT_FIELDS).forEach((k) => (A[k] = A[k] || blank()));
    if (!A.borrow.some(isNum)) A.borrow = years.map((_, i) => sum(A.ltb[i], A.stb[i]));
    if (!A.ebitda.some(isNum)) A.ebitda = years.map((_, i) => (isNum(A.pbt[i]) ? A.pbt[i] + z0(A.interest[i]) + z0(A.dep[i]) - z0(A.otherIncome[i]) : null));
    if (!A.expenses.some(isNum)) A.expenses = years.map((_, i) => (isNum(A.sales[i]) && isNum(A.ebitda[i]) ? A.sales[i] - A.ebitda[i] : null));
    A.taxPct = years.map((_, i) => (isNum(A.tax[i]) && isNum(A.pbt[i]) && A.pbt[i] !== 0 ? (100 * A.tax[i]) / A.pbt[i] : null));
    A.fcf = years.map((_, i) => (isNum(A.cfo[i]) && isNum(A.capex[i]) ? A.cfo[i] - Math.abs(A.capex[i]) : null));
    if (!A.otherLiab.some(isNum)) A.otherLiab = years.map((_, i) => (isNum(A.ta[i]) ? A.ta[i] - z0(A.eqCap[i]) - z0(A.reserves[i]) - z0(A.borrow[i]) : null));
    ["eps", "payout", "lease", "advCust", "minority", "otherAssets", "otherAssetItems", "grossBlock", "intangibles",
      "debtorDays", "invDays", "payDays", "cccRep", "selling"].forEach((k) => (A[k] = A[k] || blank()));
    A.sellingReported = A.sga.some(isNum);
    const raw = { ticker: name.toUpperCase().replace(/\W+/g, "").slice(0, 14) || "IMPORTED", name, basis: "imported file",
      industry: industry || "Imported", top: {}, about: "Statements imported from a user-supplied file.",
      source: "User import", fetched: new Date().toLocaleString("en-IN"), importMap: matched };
    return finish(raw, years, A, true);
  }

  function finish(raw, years, A, imported) {
    const n = years.length, Y = years.map((_, i) => i);
    A.equity = Y.map((i) => sum(A.eqCap[i], A.reserves[i]));
    A.tl = Y.map((i) => (isNum(A.ta[i]) && isNum(A.equity[i]) ? A.ta[i] - A.equity[i] : null));
    A.ebit = Y.map((i) => sum(A.pbt[i], A.interest[i]));
    A.tax = A.tax || Y.map(() => null);
    A.tax = Y.map((i) => (isNum(A.tax[i]) ? A.tax[i] : isNum(A.pbt[i]) && isNum(A.taxPct[i]) ? (A.pbt[i] * A.taxPct[i]) / 100 : null));
    if (!imported || !A.curAssets.some(isNum)) {
      // Screener groups every asset other than fixed assets, CWIP and investments as "Other Assets";
      // the liability side is grouped the same way, so both are used as the current-account proxy.
      A.curAssets = Y.map((i) => (isNum(A.otherAssets[i]) ? A.otherAssets[i] : sum(A.inv[i], A.rec[i], A.cash[i], A.loansAdv[i])));
      A.curLiab = Y.map((i) => (isNum(A.otherLiab[i]) ? A.otherLiab[i] - z0(A.minority[i]) + z0(A.stb[i]) : sum(A.tradePay[i], A.stb[i])));
    }
    A.nwc = Y.map((i) => (isNum(A.curAssets[i]) && isNum(A.curLiab[i]) ? A.curAssets[i] - A.curLiab[i] : null));
    A.netDebt = Y.map((i) => (isNum(A.borrow[i]) ? A.borrow[i] - z0(A.cash[i]) : null));
    // FFO = PAT + non-cash charges - non-operating gains: exceptional items are removed
    A.ffo = Y.map((i) => (isNum(A.np[i]) ? A.np[i] + z0(A.dep[i]) - z0(A.exceptional[i]) : null));
    A.noa = Y.map((i) => (isNum(A.ta[i]) ? A.ta[i] - z0(A.cash[i]) - z0(A.invest[i]) - z0(A.otherLiab[i]) + z0(A.minority[i]) : null));
    A.debtorDays = Y.map((i) => (isNum(A.debtorDays[i]) ? A.debtorDays[i] : isNum(div(A.rec[i], A.sales[i])) ? (365 * A.rec[i]) / A.sales[i] : null));
    A.invDays = Y.map((i) => (isNum(A.invDays[i]) ? A.invDays[i] : isNum(A.inv[i]) && A.inv[i] > 0 && isNum(A.sales[i]) && A.sales[i] > 0 ? (365 * A.inv[i]) / A.sales[i] : null));
    return { raw, years, A, n, industry: raw.industry || "Unclassified", manufacturing: MANUFACTURING.has(raw.industry) };
  }

  /* ======================= 2. Signal helpers ======================= */
  // G / A / R mapping. hiGood: true when higher values are safer.
  function band(v, g, r, hiGood) {
    if (!isNum(v)) return v === Infinity ? (hiGood ? "G" : "R") : "NA";
    return hiGood ? (v >= g ? "G" : v >= r ? "A" : "R") : (v <= g ? "G" : v <= r ? "A" : "R");
  }
  const PTS = { G: 0, A: 50, R: 100 };

  /* ======================= 3. Liquidity ======================= */
  const DEFAULT_TACR = { cash: 100, rec: 80, inv: 40, other: 50 };
  function liquidity(m, t, w = DEFAULT_TACR) {
    const A = m.A, CA = A.curAssets[t], CL = A.curLiab[t];
    const otherCA = isNum(CA) ? CA - z0(A.cash[t]) - z0(A.rec[t]) - z0(A.inv[t]) : null;
    const tacrNum = isNum(CA) ? (z0(A.cash[t]) * w.cash + z0(A.rec[t]) * w.rec + z0(A.inv[t]) * w.inv + Math.max(0, z0(otherCA)) * w.other) / 100 : null;
    const dailyCash = isNum(A.expenses[t]) && A.expenses[t] > 0 ? A.expenses[t] / 365 : null;
    const defensive = sum(A.cash[t], A.rec[t]);
    const burn = isNum(A.cfo[t]) && A.cfo[t] < 0 ? -A.cfo[t] / 12 : null;
    const ccc = isNum(A.cccRep[t]) ? A.cccRep[t] : isNum(A.debtorDays[t]) ? A.debtorDays[t] + z0(A.invDays[t]) - z0(A.payDays[t]) : null;
    const v = {
      currentRatio: div(CA, CL),
      quickRatio: isNum(CA) ? div(CA - z0(A.inv[t]), CL) : null,
      cashRatio: div(A.cash[t], CL),
      nwc: A.nwc[t],
      wcDays: isNum(A.nwc[t]) && isNum(A.sales[t]) && A.sales[t] > 0 ? (A.nwc[t] / A.sales[t]) * 365 : null,
      ccc,
      ocfRatio: div(A.cfo[t], CL),
      cce: isNum(A.ebitda[t]) && A.ebitda[t] > 0 ? div(A.cfo[t], A.ebitda[t]) : null,
      tacr: div(tacrNum, CL),
      dir: div(defensive, dailyCash),
      burn, runway: burn ? div(A.cash[t], burn) : null,
    };
    v.signals = {
      currentRatio: band(v.currentRatio, 1.5, 1.0, true), quickRatio: band(v.quickRatio, 1.0, 0.7, true),
      wcDays: band(v.wcDays, 45, 120, false), ocfRatio: band(v.ocfRatio, 0.4, 0.2, true),
      cce: band(v.cce, 0.8, 0.4, true), tacr: band(v.tacr, 1.2, 1.0, true), dir: band(v.dir, 180, 90, true),
    };
    if (isNum(A.ebitda[t]) && A.ebitda[t] <= 0) v.signals.cce = "R";
    return v;
  }
  function cceLabel(x) { return !isNum(x) ? "n/a" : x > 1 ? "Outstanding" : x >= 0.8 ? "Strong" : x >= 0.6 ? "Acceptable" : x >= 0.4 ? "Weak" : "Major concern"; }

  /* ======================= 4. Solvency and debt service ======================= */
  const DEFAULT_DEBT = { dscr: 1.5, rate: 9, tenor: 7, growth: 0, maintPct: 100 };
  // Repayment tenor follows the life of the assets financed: power projects are financed over 15 years or more.
  const LONG_TENOR = { Power: 15 };
  function debtFor(industry) { return { ...DEFAULT_DEBT, tenor: LONG_TENOR[industry] || DEFAULT_DEBT.tenor }; }
  function solvency(m, t, o) {
    o = o || debtFor(m.industry);
    const A = m.A;
    const cfads = isNum(A.cfo[t]) ? A.cfo[t] - z0(A.dep[t]) * (o.maintPct / 100) : null;
    const principal = isNum(A.ltb[t]) ? A.ltb[t] / o.tenor : isNum(A.borrow[t]) ? A.borrow[t] / o.tenor : null;
    const debtService = sum(A.interest[t], principal);
    const costDebt = div(A.interest[t], avg2(A.borrow, t));
    const roaEbit = div(A.ebit[t], avg2(A.ta, t));
    const v = {
      de: isNum(A.equity[t]) && A.equity[t] > 0 ? div(A.borrow[t], A.equity[t]) : null,
      deNote: isNum(A.equity[t]) && A.equity[t] <= 0 ? "Negative net worth" : null,
      debtEbitda: !isNum(A.borrow[t]) ? null : A.borrow[t] <= 0 ? 0 : isNum(A.ebitda[t]) && A.ebitda[t] > 0 ? A.borrow[t] / A.ebitda[t] : null,
      debtEbitdaNote: isNum(A.borrow[t]) && A.borrow[t] > 0 && isNum(A.ebitda[t]) && A.ebitda[t] <= 0 ? "Negative EBITDA" : null,
      netDebtEbitda: isNum(A.netDebt[t]) && isNum(A.ebitda[t]) && A.ebitda[t] > 0 ? A.netDebt[t] / A.ebitda[t] : null,
      intCover: isNum(A.interest[t]) && A.interest[t] > 0 ? div(A.ebit[t], A.interest[t]) : isNum(A.ebit[t]) ? Infinity : null,
      cfads, debtService,
      dscr: isNum(debtService) && debtService > 0 ? div(cfads, debtService) : isNum(cfads) ? Infinity : null,
      ffoTl: div(A.ffo[t], A.tl[t]),
      costDebt, roaEbit, leverageSpread: isNum(roaEbit) && isNum(costDebt) ? roaEbit - costDebt : null,
      roe: div(A.np[t], avg2(A.equity, t)), roa: div(A.np[t], avg2(A.ta, t)),
      retention: isNum(A.payout[t]) ? 1 - A.payout[t] / 100 : null,
    };
    v.igr = isNum(v.roa) && isNum(v.retention) ? v.roa * v.retention : null;
    v.sgr = isNum(v.roe) && isNum(v.retention) ? v.roe * v.retention : null;
    v.salesGrowth = growth(A.sales, t);
    // Debt structuring matrix: asset strength vs cash strength
    const tangible = div(sum(A.nfa[t], A.cwip[t]), A.ta[t]);
    const cashStrength = isNum(A.borrow[t]) && A.borrow[t] > 0 ? div(A.cfo[t], A.borrow[t]) : (isNum(A.cfo[t]) ? (A.cfo[t] > 0 ? Infinity : -Infinity) : null);
    v.assetRich = isNum(tangible) ? tangible >= 0.35 : null;
    v.cashRich = cashStrength === null ? null : cashStrength >= 0.25;
    v.tangibleShare = tangible; v.cfoToDebt = cashStrength;
    v.matrix = v.assetRich === null || v.cashRich === null ? null :
      v.cashRich && v.assetRich ? "Debt sculpting" : v.cashRich ? "Debt avalanche" : v.assetRich ? "Debt sizing" : "Debt snowball";
    v.signals = {
      de: band(v.de, 1, 2, false), debtEbitda: band(v.debtEbitda, 2.5, 4, false), intCover: band(v.intCover, 3, 1.5, true),
      dscr: band(v.dscr, 1.5, 1.2, true), ffoTl: band(v.ffoTl, 0.2, 0.1, true),
    };
    if (v.deNote) v.signals.de = "R";
    if (v.debtEbitdaNote) v.signals.debtEbitda = "R";
    return v;
  }

  function debtCapacity(m, t, o) {
    o = o || debtFor(m.industry);
    const A = m.A;
    const base = isNum(A.cfo[t]) ? A.cfo[t] - z0(A.dep[t]) * (o.maintPct / 100) : 0;
    const rows = []; let pv = 0, pvCfads = 0;
    const tenor = o.cfadsSeries ? o.cfadsSeries.length : o.tenor;
    for (let y = 1; y <= tenor; y++) {
      const cfads = o.cfadsSeries ? o.cfadsSeries[y - 1] : base * (1 + o.growth / 100) ** (y - 1);
      const ds = Math.max(0, cfads) / o.dscr;
      const df = (1 + o.rate / 100) ** y;
      pv += ds / df; pvCfads += cfads / df;
      rows.push({ y, cfads, ds });
    }
    let bal = pv;
    rows.forEach((r) => { r.open = bal; r.interest = (bal * o.rate) / 100; r.principal = r.ds - r.interest; bal -= r.principal; r.close = Math.max(0, bal); });
    const existing = z0(A.borrow[t]);
    return { base, maxDebt: pv, existing, headroom: pv - existing, llcr: existing > 0 ? pvCfads / existing : null, pvCfads, rows };
  }

  /* ======================= 5. Distress models ======================= */
  function altman(m, t) {
    const A = m.A, ta = A.ta[t], tl = A.tl[t];
    if (!isNum(ta) || ta <= 0 || !isNum(tl) || tl <= 0) return null;
    const X1 = div(A.nwc[t], ta), X2 = div(A.reserves[t], ta), X3 = div(A.ebit[t], ta), X4b = div(A.equity[t], tl), X5 = div(A.sales[t], ta);
    if (![X1, X2, X3, X4b, X5].every(isNum)) return null;
    const out = { X1, X2, X3, X4b, X5 };
    out.zPrime = 0.717 * X1 + 0.847 * X2 + 3.107 * X3 + 0.42 * X4b + 0.998 * X5;
    out.zDouble = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4b;
    const mcap = m.raw.top && m.raw.top["Market Cap"];
    if (t === m.n - 1 && isNum(mcap)) { out.X4m = mcap / tl; out.zListed = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * out.X4m + 1.0 * X5; }
    out.zoneListed = isNum(out.zListed) ? (out.zListed > 2.99 ? "Safe" : out.zListed >= 1.81 ? "Grey" : "Distress") : null;
    out.zonePrime = out.zPrime > 2.9 ? "Safe" : out.zPrime >= 1.23 ? "Grey" : "Distress";
    out.zoneDouble = out.zDouble > 2.6 ? "Safe" : out.zDouble >= 1.1 ? "Grey" : "Distress";
    // Primary version: Z' (book equity) for manufacturers across all years, Z'' for others
    out.primary = m.manufacturing ? "zPrime" : "zDouble";
    out.primaryZone = m.manufacturing ? out.zonePrime : out.zoneDouble;
    out.primaryValue = out[out.primary];
    return out;
  }

  function ohlson(m, t) {
    const A = m.A;
    if (t < 1) return null;
    const ta = A.ta[t], tl = A.tl[t], ca = A.curAssets[t], cl = A.curLiab[t];
    if (![ta, tl, ca, cl, A.np[t], A.np[t - 1]].every(isNum) || ta <= 0 || ca <= 0) return null;
    const size = Math.log(ta / 100);
    const X = tl > ta ? 1 : 0, Yd = A.np[t] < 0 && A.np[t - 1] < 0 ? 1 : 0;
    const chNI = Math.abs(A.np[t]) + Math.abs(A.np[t - 1]) > 0 ? (A.np[t] - A.np[t - 1]) / (Math.abs(A.np[t]) + Math.abs(A.np[t - 1])) : 0;
    const parts = {
      Constant: -1.32, Size: -0.407 * size, Leverage: 6.03 * (tl / ta), "Working capital": -1.43 * (A.nwc[t] / ta),
      "CL / CA": 0.0757 * (cl / ca), "TL > TA dummy": -1.72 * X, Profitability: -2.37 * (A.np[t] / ta),
      "FFO / TL": -1.83 * z0(div(A.ffo[t], tl)), "Two-year loss dummy": 0.285 * Yd, "Change in NI": -0.521 * chNI,
    };
    const T = Object.values(parts).reduce((a, b) => a + b, 0);
    const p = Math.exp(T) / (1 + Math.exp(T));
    return { T, p, parts, signal: p > 0.5 ? "R" : p > 0.2 ? "A" : "G" };
  }

  function zmijewski(m, t) {
    const A = m.A;
    const v = -4.336 - 4.513 * z0(div(A.np[t], A.ta[t])) + 5.679 * z0(div(A.tl[t], A.ta[t])) + 0.004 * z0(div(A.curAssets[t], A.curLiab[t]));
    return isNum(A.ta[t]) ? { X: v, signal: v > 0 ? "R" : v > -1 ? "A" : "G" } : null;
  }

  function springate(m, t) {
    const A = m.A, ta = A.ta[t];
    const a = div(A.nwc[t], ta), b = div(A.ebit[t], ta), c = div(A.pbt[t], A.curLiab[t]), d = div(A.sales[t], ta);
    if (![a, b, c, d].every(isNum)) return null;
    const S = 1.03 * a + 3.07 * b + 0.66 * c + 0.4 * d;
    return { S, a, b, c, d, signal: S < 0.862 ? "R" : "G" };
  }

  function fulmer(m, t) {
    const A = m.A;
    if (t < 1) return null;
    const avgTA = avg2(A.ta, t), avgDebt = avg2(A.borrow, t), eq = A.equity[t];
    if (!isNum(avgDebt) || avgDebt <= 0) return { H: null, note: "Not defined for a debt-free company (debt is a denominator)" };
    if (!isNum(eq) || eq <= 0) return { H: null, note: "Not defined when net worth is negative" };
    const tangibleAvg = avg2(A.ta.map((v, i) => (isNum(v) ? v - z0(A.intangibles[i]) : null)), t);
    const X = {
      X1: div(avg2(A.reserves, t), avgTA), X2: div(A.sales[t], avgTA), X3: div(A.ebit[t], eq), X4: div(A.cfo[t], avgDebt),
      X5: div(avgDebt, eq), X6: div(A.curLiab[t], avgTA), X7: isNum(tangibleAvg) && tangibleAvg > 0 ? Math.log10(tangibleAvg) : null,
      X8: div(avg2(A.nwc, t), avgDebt),
      X9: isNum(A.ebit[t]) && A.ebit[t] > 0 && isNum(A.interest[t]) && A.interest[t] > 0 ? Math.log10(A.ebit[t]) / A.interest[t] : 0,
    };
    if (!Object.values(X).every(isNum)) return null;
    const H = 5.528 * X.X1 + 0.212 * X.X2 + 0.73 * X.X3 + 1.27 * X.X4 - 0.12 * X.X5 + 2.335 * X.X6 + 0.575 * X.X7 + 1.083 * X.X8 + 0.894 * X.X9 - 6.075;
    return { H, X, signal: H < 0 ? "R" : "G" };
  }

  function kzIndex(m, t) {
    const A = m.A, mcap = m.raw.top && m.raw.top["Market Cap"];
    if (t !== m.n - 1 || !isNum(mcap) || t < 1) return null;
    const K = A.nfa[t - 1];
    if (!isNum(K) || K <= 0 || !isNum(A.equity[t]) || A.equity[t] <= 0) return null;
    const cf = sum(A.np[t], A.dep[t]), div_ = isNum(A.payout[t]) && isNum(A.np[t]) ? Math.max(0, (A.np[t] * A.payout[t]) / 100) : 0;
    const Q = (mcap + A.equity[t] - A.equity[t]) / A.equity[t];
    const debtCap = div(A.borrow[t], sum(A.borrow[t], A.equity[t]));
    const KZ = -1.001909 * (cf / K) + 0.2826389 * Q + 3.139193 * z0(debtCap) - 39.3678 * (div_ / K) - 1.314759 * (z0(A.cash[t]) / K);
    return { KZ, Q, cfK: cf / K, debtCap, divK: div_ / K, cashK: z0(A.cash[t]) / K };
  }

  /* ======================= 6. Earnings quality ======================= */
  function accruals(m, t) {
    const A = m.A;
    const sloan = div(sum(A.np[t], isNum(A.cfo[t]) ? -A.cfo[t] : null), avg2(A.ta, t));
    const bsAcc = t > 0 && isNum(A.noa[t]) && isNum(A.noa[t - 1]) ? div(A.noa[t] - A.noa[t - 1], avg2(A.noa, t)) : null;
    const cfAcc = isNum(A.np[t]) && isNum(A.cfo[t]) && isNum(A.cfi[t]) ? div(A.np[t] - (A.cfo[t] + A.cfi[t]), avg2(A.noa, t)) : null;
    const sloanBand = !isNum(sloan) ? "n/a" : sloan <= 0.05 ? "Low risk" : sloan <= 0.1 ? "Moderate" : sloan <= 0.2 ? "High risk" : "Very high risk";
    return { sloan, sloanBand, bsAcc, cfAcc, cfoNp: isNum(A.np[t]) && A.np[t] > 0 ? div(A.cfo[t], A.np[t]) : null,
      signal: band(sloan, 0.05, 0.1, false) };
  }

  function beneish(m, t) {
    const A = m.A, s = t - 1;
    if (s < 0) return null;
    const gm = (i) => (isNum(A.cogs[i]) && A.cogs[i] > 0 ? div(A.sales[i] - A.cogs[i], A.sales[i]) : null);
    const hardCA = (i) => sum(A.inv[i], A.rec[i], A.cash[i]);
    const aq = (i) => (isNum(A.ta[i]) && A.ta[i] > 0 && isNum(hardCA(i)) ? 1 - (hardCA(i) + z0(A.nfa[i]) + z0(A.cwip[i]) + z0(A.invest[i])) / A.ta[i] : null);
    const dr = (i) => div(A.dep[i], sum(A.dep[i], A.nfa[i]));
    const lv = (i) => div(sum(A.curLiab[i], A.ltb[i]), A.ta[i]);
    const ix = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
    const raw = {
      DSRI: ix(div(A.rec[t], A.sales[t]), div(A.rec[s], A.sales[s])), GMI: ix(gm(s), gm(t)), AQI: ix(aq(t), aq(s)),
      SGI: ix(A.sales[t], A.sales[s]), DEPI: ix(dr(s), dr(t)), SGAI: ix(div(A.sga[t], A.sales[t]), div(A.sga[s], A.sales[s])),
      LVGI: ix(lv(t), lv(s)), TATA: isNum(A.cfo[t]) ? div(A.np[t] - A.cfo[t], A.ta[t]) : null,
    };
    if (!isNum(raw.SGI) || !isNum(raw.TATA)) return null;
    const used = {}, neutral = [];
    Object.entries(raw).forEach(([k, x]) => {
      if (!isNum(x) || (k === "AQI" && x < 0)) { used[k] = k === "TATA" ? 0 : 1; neutral.push(k); }
      else used[k] = k === "TATA" ? x : Math.min(x, 5);
    });
    const W = { DSRI: 0.92, GMI: 0.528, AQI: 0.404, SGI: 0.892, DEPI: 0.115, SGAI: -0.172, TATA: 4.679, LVGI: -0.327 };
    const M = -4.84 + Object.keys(W).reduce((a, k) => a + W[k] * used[k], 0);
    return { M, raw, used, W, neutral, signal: M > -2.22 ? "R" : "G" };
  }

  function cScore(m, t) {
    const A = m.A, s = t - 1;
    if (s < 0) return null;
    const otherCA = (i) => div(sum(A.loansAdv[i], A.otherAssetItems[i]), A.sales[i]);
    const depGB = (i) => div(A.dep[i], A.grossBlock[i]);
    const tests = [
      ["Gap between net income and CFO widening", isNum(A.cfo[t]) && isNum(A.cfo[s]) ? (A.np[t] - A.cfo[t]) - (A.np[s] - A.cfo[s]) : null, (x) => x > 0],
      ["Debtor days rising", isNum(A.debtorDays[t]) && isNum(A.debtorDays[s]) ? A.debtorDays[t] - A.debtorDays[s] : null, (x) => x > 0],
      ["Inventory days rising", isNum(A.invDays[t]) && isNum(A.invDays[s]) ? A.invDays[t] - A.invDays[s] : null, (x) => x > 0],
      ["Other current assets rising relative to revenue", isNum(otherCA(t)) && isNum(otherCA(s)) ? otherCA(t) - otherCA(s) : null, (x) => x > 0],
      ["Depreciation falling relative to gross block", isNum(depGB(t)) && isNum(depGB(s)) ? depGB(t) - depGB(s) : null, (x) => x < 0],
      ["Total assets growing above 10%", growth(A.ta, t), (x) => x > 0.1],
    ].map(([name, val, f]) => ({ name, val, flag: isNum(val) ? (f(val) ? 1 : 0) : null }));
    const avail = tests.filter((x) => x.flag !== null);
    if (avail.length < 4) return null;
    const C = avail.reduce((a, b) => a + b.flag, 0);
    return { C, tests, available: avail.length, signal: C >= 4 ? "R" : C === 3 ? "A" : "G" };
  }

  function piotroski(m, t) {
    const A = m.A, s = t - 1;
    if (s < 0) return null;
    const cr = (i) => div(A.curAssets[i], A.curLiab[i]);
    const gm = (i) => (isNum(A.cogs[i]) && A.cogs[i] > 0 ? div(A.sales[i] - A.cogs[i], A.sales[i]) : div(A.ebitda[i], A.sales[i]));
    const at = (i) => div(A.sales[i], A.ta[i]);
    const ltd = (i) => (isNum(A.ltb[i]) ? A.ltb[i] : A.borrow[i]);
    const tests = [
      ["Positive net income", A.np[t], (x) => x > 0],
      ["Positive return on assets", div(A.np[t], A.ta[t]), (x) => x > 0],
      ["Positive operating cash flow", A.cfo[t], (x) => x > 0],
      ["Operating cash flow above net income", isNum(A.cfo[t]) && isNum(A.np[t]) ? A.cfo[t] - A.np[t] : null, (x) => x > 0],
      ["Lower long-term debt than last year", isNum(ltd(t)) && isNum(ltd(s)) ? ltd(t) - ltd(s) : null, (x) => x <= 0],
      ["Higher current ratio than last year", isNum(cr(t)) && isNum(cr(s)) ? cr(t) - cr(s) : null, (x) => x > 0],
      ["No new shares issued", isNum(A.eqCap[t]) && isNum(A.eqCap[s]) ? A.eqCap[t] - A.eqCap[s] : null, (x) => x <= 0],
      ["Higher gross margin than last year", isNum(gm(t)) && isNum(gm(s)) ? gm(t) - gm(s) : null, (x) => x > 0],
      ["Higher asset turnover than last year", isNum(at(t)) && isNum(at(s)) ? at(t) - at(s) : null, (x) => x > 0],
    ].map(([name, val, f]) => ({ name, val, pass: isNum(val) ? (f(val) ? 1 : 0) : null }));
    const avail = tests.filter((x) => x.pass !== null);
    if (avail.length < 7) return null;
    const F = avail.reduce((a, b) => a + b.pass, 0);
    return { F, tests, available: avail.length, signal: F >= 7 ? "G" : F >= 4 ? "A" : "R" };
  }

  // Modified Jones model. Coefficients estimated by OLS on the cross-section of
  // 2,700 Indian listed firms (FY2024, Prowess, Rs million), 1st/99th percentile trimmed.
  const AEM_COEF = { a0: 0.0076446, a1: 0.89536317, b1: 0.04435471, b2: -0.11288105, n: 2700, r2: 0.0545 };
  // Roychowdhury (2006) REM models, OLS on 2,150 Indian listed firms (FY2024, Prowess, Rs million).
  const REM_COEF = {
    cfo: { a0: 0.0592345258894226, a1: -4.520277813274649, b1: 0.0001499250428015247, b2: -0.005743025460873176 },
    prod: { a0: -0.08675064785868271, a1: 1.377676006954212, b1: 0.8992718477583811, b2: 0.05795078844749389, b3: 0.0187284077396749 },
    disx: { a0: 0.02421879371766284, a1: 0.6614312492634205, b1: 0.01830344776942602 }, n: 2150,
  };
  function aem(m, t) {
    const A = m.A, s = t - 1;
    if (s < 0) return null;
    const Am = z0(A.ta[s]) * 10; // Rs crore -> Rs million, the unit of the estimation sample
    if (Am <= 0 || ![A.np[t], A.cfo[t], A.sales[t], A.sales[s]].every(isNum)) return null;
    const ta = (A.np[t] - A.cfo[t]) * 10 / Am;
    const dRev = ((A.sales[t] - A.sales[s]) - (z0(A.rec[t]) - z0(A.rec[s]))) * 10 / Am;
    const ppe = z0(A.nfa[t]) * 10 / Am;
    const nda = AEM_COEF.a0 + AEM_COEF.a1 / Am + AEM_COEF.b1 * dRev + AEM_COEF.b2 * ppe;
    const da = ta - nda;
    return { totalAccruals: ta, nda, da, signal: da > 0.1 ? "R" : da > 0.05 ? "A" : "G" };
  }
  function rem(m, t) {
    const A = m.A, s = t - 1, r = t - 2;
    if (r < 0) return null;
    const Am = z0(A.ta[s]) * 10;
    if (Am <= 0 || ![A.sales[t], A.sales[s], A.sales[r], A.cfo[t]].every(isNum)) return null;
    const St = A.sales[t] * 10 / Am, dS = (A.sales[t] - A.sales[s]) * 10 / Am, dS1 = (A.sales[s] - A.sales[r]) * 10 / Am, Ss = A.sales[s] * 10 / Am;
    const c = REM_COEF;
    const abCfo = A.cfo[t] * 10 / Am - (c.cfo.a0 + c.cfo.a1 / Am + c.cfo.b1 * St + c.cfo.b2 * dS);
    const prodLevel = isNum(A.cogs[t]) && A.cogs[t] > 0 ? (A.cogs[t] + (z0(A.inv[t]) - z0(A.inv[s]))) * 10 / Am : null;
    const abProd = isNum(prodLevel) ? prodLevel - (c.prod.a0 + c.prod.a1 / Am + c.prod.b1 * St + c.prod.b2 * dS + c.prod.b3 * dS1) : null;
    const abDisx = A.sellingReported && isNum(A.selling[t]) ? A.selling[t] * 10 / Am - (c.disx.a0 + c.disx.a1 / Am + c.disx.b1 * Ss) : null;
    const parts = [-abCfo, abProd, isNum(abDisx) ? -abDisx : null].filter(isNum);
    return { abCfo, abProd, abDisx, aggregate: parts.reduce((a, b) => a + b, 0), components: parts.length };
  }

  // Benford first-digit test with the Kolmogorov-Smirnov decision rule (cut-off 1.36 / sqrt N)
  const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));
  function benford(m) {
    const raw = m.raw, vals = [];
    const skip = /%|growth|EPS|Days|Cycle|ROCE|Dividend|Raw PDF|No\. of|CFO\/EBITDA/i;
    const take = (rows) => Object.entries(rows || {}).forEach(([k, arr]) => { if (!skip.test(k)) arr.forEach((v) => isNum(v) && vals.push(v)); });
    if (raw.pl) { [raw.pl, raw.bs, raw.cf, raw.quarters].forEach((b) => b && take(b.rows)); Object.values(raw.schedules || {}).forEach(take); }
    else Object.values(m.A).forEach((arr) => Array.isArray(arr) && arr.forEach((v) => isNum(v) && vals.push(v)));
    const digits = vals.map(Math.abs).filter((v) => v >= 1).map((v) => +String(v).match(/[1-9]/)[0]);
    const N = digits.length;
    if (N < 50) return null;
    const obs = Array(9).fill(0); digits.forEach((d) => obs[d - 1]++);
    const p = obs.map((c) => c / N);
    let cumA = 0, cumE = 0, KS = 0;
    const cum = p.map((x, i) => { cumA += x; cumE += BENFORD[i]; const d = Math.abs(cumA - cumE); KS = Math.max(KS, d); return { actual: cumA, expected: cumE, diff: cumA - cumE }; });
    const cutoff = 1.36 / Math.sqrt(N);
    return { N, obs, p, exp: BENFORD, cum, KS, cutoff, signal: KS > cutoff ? "R" : "G" };
  }

  /* ======================= 7. Profitability ======================= */
  function profitability(m, t) {
    const A = m.A;
    const avgTA = avg2(A.ta, t), avgEq = avg2(A.equity, t);
    const taxBurden = isNum(A.pbt[t]) && A.pbt[t] !== 0 ? div(A.np[t], A.pbt[t]) : null;
    const intBurden = isNum(A.ebit[t]) && A.ebit[t] !== 0 ? div(A.pbt[t], A.ebit[t]) : null;
    const nopat = isNum(A.ebit[t]) ? A.ebit[t] - z0(A.otherIncome[t]) : null;
    const nopatTax = isNum(nopat) ? nopat * (1 - Math.min(Math.max(z0(A.taxPct[t]) / 100, 0), 0.5)) : null;
    const roiic = t >= 3 && isNum(A.noa[t]) && isNum(A.noa[t - 3]) && A.noa[t] - A.noa[t - 3] > 0 ? (() => {
      const nT = (i) => (isNum(A.ebit[i]) ? (A.ebit[i] - z0(A.otherIncome[i])) * (1 - Math.min(Math.max(z0(A.taxPct[i]) / 100, 0), 0.5)) : null);
      return isNum(nT(t)) && isNum(nT(t - 3)) ? (nT(t) - nT(t - 3)) / (A.noa[t] - A.noa[t - 3]) : null;
    })() : null;
    return {
      npm: div(A.np[t], A.sales[t]), ebitdaMargin: div(A.ebitda[t], A.sales[t]), ebitMargin: div(A.ebit[t], A.sales[t]),
      assetTurnover: div(A.sales[t], avgTA), equityMultiplier: div(avgTA, avgEq), roe: div(A.np[t], avgEq),
      taxBurden, intBurden, roce: div(A.ebit[t], sum(avg2(A.equity, t), avg2(A.borrow, t))),
      roic: div(nopatTax, avg2(A.noa, t)), roiic,
    };
  }

  function market(m) {
    const A = m.A, top = m.raw.top || {}, t = m.n - 1;
    const pe = top["Stock P/E"], mcap = top["Market Cap"];
    const g = growth(A.eps, t, 3) ?? growth(A.np, t, 3);
    const dy = isNum(top["Dividend Yield"]) ? top["Dividend Yield"] : null;
    const pocf = isNum(mcap) && isNum(A.cfo[t]) && A.cfo[t] > 0 ? mcap / A.cfo[t] : null;
    return { pe, mcap, price: top["Current Price"], pb: div(top["Current Price"], top["Book Value"]),
      epsGrowth3: g, peg: isNum(pe) && isNum(g) && g > 0 ? pe / (g * 100) : null,
      pegy: isNum(pe) && isNum(g) && g * 100 + z0(dy) > 0 ? pe / (g * 100 + z0(dy)) : null, dy, pocf,
      pocfCheck: isNum(pocf) && isNum(pe) ? (pocf < pe ? "Cash supports earnings" : "Earnings not converting to cash") : null };
  }

  /* ======================= 8. Cash flow life cycle and persistence ======================= */
  function lifeCycle(m, t) {
    const A = m.A, o = A.cfo[t], i = A.cfi[t], f = A.cff[t];
    if (![o, i, f].every(isNum)) return null;
    const s = (x) => (x >= 0 ? "+" : "-"), key = s(o) + s(i) + s(f);
    const map = { "--+": "Introduction", "+-+": "Growth", "+--": "Mature", "-+-": "Decline", "-++": "Decline" };
    return { stage: map[key] || "Shake-out", pattern: `CFO ${s(o)} / CFI ${s(i)} / CFF ${s(f)}` };
  }
  function durbinWatson(m, t) {
    const y = m.A.cfo.slice(0, t + 1).map((v, i) => [i, v]).filter((p) => isNum(p[1]));
    if (y.length < 6) return null;
    const n = y.length, mx = y.reduce((a, p) => a + p[0], 0) / n, my = y.reduce((a, p) => a + p[1], 0) / n;
    const b = y.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / y.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
    const e = y.map((p) => p[1] - (my + b * (p[0] - mx)));
    const den = e.reduce((a, x) => a + x * x, 0);
    if (!den) return null;
    const DW = e.slice(1).reduce((a, x, i) => a + (x - e[i]) ** 2, 0) / den;
    return { DW, n, reading: DW < 1.5 ? "Positive autocorrelation: good and bad cash years cluster" : DW > 2.5 ? "Negative autocorrelation: cash flows alternate year to year" : "No strong autocorrelation" };
  }

  /* ======================= 9. Red flags from the cases ======================= */
  function quarterShare(m, t) {
    const q = m.raw.quarters;
    if (!q || !q.rows || !q.rows.Sales) return null;
    const i = q.cols.indexOf(m.years[t]);
    if (i < 3) return null;
    const four = q.rows.Sales.slice(i - 3, i + 1);
    if (!four.every(isNum)) return null;
    const tot = four.reduce((a, b) => a + b, 0);
    return tot > 0 ? { share: four[3] / tot, cols: q.cols.slice(i - 3, i + 1), vals: four } : null;
  }
  function promoter(m) {
    const s = m.raw.shareholding;
    if (!s || !s.rows || !s.rows.Promoters) return null;
    const v = s.rows.Promoters.map((x, i) => [s.cols[i], x]).filter((x) => isNum(x[1]));
    return v.length >= 2 ? { from: v[0], to: v[v.length - 1], change: v[v.length - 1][1] - v[0][1], series: v } : null;
  }
  // Behavioural velocity: this year's growth in a line item measured against its own history
  function velocity(arr, t) {
    const g = [];
    for (let i = 1; i <= t; i++) { const x = growth(arr, i); if (isNum(x)) g.push(x); }
    if (g.length < 5 || !isNum(growth(arr, t))) return null;
    const hist = g.slice(0, -1), mu = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mu) ** 2, 0) / (hist.length - 1));
    return sd > 0 ? { z: (growth(arr, t) - mu) / sd, g: growth(arr, t), mu } : null;
  }

  function redFlags(m, t) {
    const A = m.A, f = [], s = t - 1;
    const pct = (x) => (isNum(x) ? (100 * x).toFixed(1) + "%" : "n/a");
    const add = (group, name, status, evidence, why) => f.push({ group, name, status, evidence, why });
    if (s < 0) return f;
    const gS = growth(A.sales, t), gNP = growth(A.np, t), gR = growth(A.rec, t), gI = growth(A.inv, t), gD = growth(A.borrow, t);
    // Core red flags
    if (isNum(A.np[t]) && isNum(A.np[s]) && isNum(A.cfo[t]) && isNum(A.cfo[s]))
      add("Core", "Profit up but cash flow down", A.np[t] > A.np[s] && A.cfo[t] < A.cfo[s] ? (A.cfo[t] < 0.7 * A.cfo[s] ? "R" : "A") : "G",
        `PAT ${fmt(A.np[s])} → ${fmt(A.np[t])}; CFO ${fmt(A.cfo[s])} → ${fmt(A.cfo[t])}`, "Cash pays debt; rising profit with falling cash points to aggressive recognition or working-capital build-up.");
    if (isNum(gS) && isNum(gR))
      add("Core", "Revenue up but debtors up faster", gR > gS + 0.15 && gR > 0.1 ? "R" : gR > gS + 0.05 && gR > 0.05 ? "A" : "G",
        `Debtors ${pct(gR)} vs sales ${pct(gS)}`, "Unusually high receivables are the usual footprint of sales that have not happened.");
    if (isNum(gS) && isNum(gI) && A.inv[t] > 0.02 * z0(A.sales[t]))
      add("Core", "Inventory build-up", gI > gS + 0.2 ? "R" : gI > gS + 0.1 ? "A" : "G", `Inventory ${pct(gI)} vs sales ${pct(gS)}`, "Stock growing ahead of sales ties up cash and can hide overstated closing inventory.");
    if (isNum(gD) && A.borrow[t] > 0.05 * z0(A.ta[t]))
      add("Core", "Excess debt growth", gD > 0.25 && gD > z0(gS) + 0.15 ? "R" : gD > 0.15 && gD > z0(gS) + 0.05 ? "A" : "G", `Borrowings ${pct(gD)} vs sales ${pct(gS)}`, "Debt rising faster than the business it funds weakens future coverage.");
    const exYears = A.exceptional.slice(Math.max(0, t - 2), t + 1).filter((v) => isNum(v) && Math.abs(v) > 0.01 * z0(A.sales[t])).length;
    const oiShare = isNum(A.pbt[t]) && A.pbt[t] > 0 ? div(A.otherIncome[t], A.pbt[t]) : null;
    if (A.exceptional.some(isNum) || isNum(oiShare))
      add("Core", "Frequent one-time gains / other income", exYears >= 2 || oiShare > 0.25 ? "R" : exYears === 1 || oiShare > 0.15 ? "A" : "G",
        `Material exceptional items in ${exYears} of last 3 yrs; other income ${pct(oiShare)} of PBT`, "Profit that depends on non-recurring items is not a reliable source of repayment.");
    if (isNum(A.cfo[t])) add("Core", "Cash flow from operations negative", A.cfo[t] < 0 ? "R" : "G", `CFO ${fmt(A.cfo[t])} cr`, "A business that consumes cash must borrow to service existing debt.");
    // Case-based checks
    if (isNum(gS)) add("Case checks", "Abnormal revenue jump (verify subsidiaries and customers)", gS > 1 ? "R" : gS > 0.5 ? "A" : "G", `Sales growth ${pct(gS)}`, "Revenue inflation through newly acquired or questioned subsidiaries.");
    if (isNum(A.eqCap[t]) && isNum(A.eqCap[s]) && isNum(A.borrow[t]) && isNum(A.borrow[s]) && A.borrow[s] > 0) {
      const eqJump = div(A.eqCap[t] - A.eqCap[s], A.eqCap[s]), debtCut = div(A.borrow[s] - A.borrow[t], A.borrow[s]);
      add("Case checks", "Loan-to-equity conversion", eqJump > 0.2 && debtCut > 0.2 ? "R" : eqJump > 0.1 && debtCut > 0.1 ? "A" : "G",
        `Share capital ${pct(eqJump)}; borrowings ${pct(-debtCut)}`, "Converting loans into equity flatters D/E and coverage without fresh money; check the source of funds.");
    }
    const advRev = div(A.loansAdv[t], A.sales[t]), advRevS = div(A.loansAdv[s], A.sales[s]);
    if (isNum(advRev)) add("Case checks", "Advances to revenue", advRev > 0.25 && advRev > z0(advRevS) ? "R" : advRev > 0.15 ? "A" : "G",
      `Loans and advances = ${pct(advRev)} of revenue (last year ${pct(advRevS)})`, "Funds can leave the company as advances to related parties.");
    const qs = quarterShare(m, t);
    if (qs) add("Case checks", "Year-end quarter revenue spike", qs.share > 0.32 ? "R" : qs.share > 0.28 ? "A" : "G",
      `${qs.cols[3]} quarter = ${pct(qs.share)} of annual sales (even spread 25%)`, "Revenue pulled into the closing quarter to meet targets.");
    // Behavioural and governance
    const vD = velocity(A.stb.some(isNum) ? A.stb : A.borrow, t), vI = velocity(A.inv, t);
    const vMax = [vD, vI].filter(Boolean).reduce((a, b) => Math.max(a, b.z), -Infinity);
    if (vMax > -Infinity) add("Behaviour", "Behavioural velocity (sudden change in borrowing or stock)", vMax > 2 ? "R" : vMax > 1 ? "A" : "G",
      [vD && `short-term debt growth ${pct(vD.g)} (z = ${vD.z.toFixed(1)})`, vI && `inventory growth ${pct(vI.g)} (z = ${vI.z.toFixed(1)})`].filter(Boolean).join("; "),
      "A sharp break from the firm's own pattern often signals hidden stress.");
    const stShare = (i) => (isNum(A.stb[i]) && isNum(A.borrow[i]) && A.borrow[i] > 0 ? A.stb[i] / A.borrow[i] : null);
    if (t >= 2 && isNum(stShare(t)) && isNum(stShare(t - 2)) && A.borrow[t] > 0.05 * z0(A.ta[t])) {
      const d = stShare(t) - stShare(t - 2);
      add("Behaviour", "Shift towards short-term borrowing (collateral propensity proxy)", d > 0.2 ? "R" : d > 0.1 ? "A" : "G",
        `Short-term share of debt ${pct(stShare(t - 2))} → ${pct(stShare(t))}`, "Moving away from secured term debt can mean the core assets are already encumbered.");
    }
    if (isNum(A.np[t]) && isNum(A.cfo[t]))
      add("Behaviour", "Liquidity-to-profitability mismatch", A.np[t] > 0 && A.cfo[t] < 0 ? "R" : A.np[t] > 0 && A.cfo[t] < 0.5 * A.np[t] ? "A" : "G",
        `PAT ${fmt(A.np[t])} vs CFO ${fmt(A.cfo[t])}`, "Reported profit without matching cash: asset-rich but cash-poor.");
    const pr = promoter(m);
    if (pr) add("Governance", "Promoter stake falling", pr.change < -10 ? "R" : pr.change < -3 ? "A" : "G",
      `${pr.from[0]} ${pr.from[1].toFixed(1)}% → ${pr.to[0]} ${pr.to[1].toFixed(1)}%`, "Promoters reducing skin in the game while the company borrows.");
    if (isNum(A.equity[t])) add("Governance", "Net worth eroded", A.equity[t] <= 0 ? "R" : A.reserves[t] < 0 ? "A" : "G", `Net worth ${fmt(A.equity[t])} cr`, "Negative net worth leaves lenders with no equity cushion.");
    return f;
  }
  function fmt(v) { return isNum(v) ? Math.round(v).toLocaleString("en-IN") : "n/a"; }

  /* ======================= 10. Credit watch grade ======================= */
  const PILLARS = {
    liquidity: { label: "Liquidity", weight: 20 },
    solvency: { label: "Solvency and debt service", weight: 25 },
    distress: { label: "Distress models", weight: 25 },
    quality: { label: "Earnings quality", weight: 20 },
    flags: { label: "Red flags and behaviour", weight: 10 },
  };
  const GRADES = [[20, "CW1", "Strong"], [35, "CW2", "Adequate"], [50, "CW3", "Watch"], [65, "CW4", "Weak"], [101, "CW5", "Critical"]];

  function assess(m, t, opts = {}) {
    const liq = liquidity(m, t, opts.tacr), sol = solvency(m, t, opts.debt), z = altman(m, t), o = ohlson(m, t),
      zm = zmijewski(m, t), sp = springate(m, t), fu = fulmer(m, t), acc = accruals(m, t), b = beneish(m, t),
      c = cScore(m, t), p = piotroski(m, t), ae = aem(m, t), bf = benford(m), fl = redFlags(m, t);
    const zSig = z ? (z.primaryZone === "Safe" ? "G" : z.primaryZone === "Grey" ? "A" : "R") : "NA";
    const sig = {
      liquidity: liq.signals,
      solvency: sol.signals,
      distress: { altman: zSig, ohlson: o ? o.signal : "NA", zmijewski: zm ? zm.signal : "NA", springate: sp ? sp.signal : "NA", fulmer: fu && isNum(fu.H) ? fu.signal : "NA" },
      quality: { sloan: acc.signal, beneish: b ? b.signal : "NA", cscore: c ? c.signal : "NA", piotroski: p ? p.signal : "NA", aem: ae ? ae.signal : "NA", benford: bf ? bf.signal : "NA" },
      flags: Object.fromEntries(fl.map((x, i) => [i, x.status])),
    };
    const pillar = {};
    let tot = 0, wt = 0;
    Object.entries(sig).forEach(([k, obj]) => {
      const v = Object.values(obj).filter((s) => s in PTS);
      const score = v.length ? v.reduce((a, s) => a + PTS[s], 0) / v.length : null;
      const counts = { G: v.filter((s) => s === "G").length, A: v.filter((s) => s === "A").length, R: v.filter((s) => s === "R").length };
      pillar[k] = { score, counts };
      if (isNum(score)) { tot += score * PILLARS[k].weight; wt += PILLARS[k].weight; }
    });
    const score = wt ? tot / wt : null;
    const g = isNum(score) ? GRADES.find((x) => score < x[0]) : null;
    return { liq, sol, z, o, zm, sp, fu, acc, b, c, p, ae, bf, fl, sig, pillar, score, grade: g ? g[1] : "n/a", gradeLabel: g ? g[2] : "Insufficient data" };
  }

  /* ======================= 11. Borrower Quality Rating (60% quantitative, 40% qualitative) ======================= */
  const QUAL_LEVELS = { Strong: 100, Satisfactory: 75, Acceptable: 50, Weak: 25, Poor: 0 };
  const QUAL_FACTORS = [
    ["management", "Management quality and track record", "CEO tenure and turnover, past conduct, hubris, execution record"],
    ["board", "Board independence and governance", "Share of independent directors, CEO duality, director busyness, SEBI or exchange penalties"],
    ["auditor", "Auditor standing and audit opinion", "Big 4 or not, clean or qualified opinion, any auditor resignation or change"],
    ["promoter", "Promoter commitment", "Promoter stake and its trend, pledged shares, willingness to infuse equity"],
    ["related", "Related-party and group exposure", "Advances and transactions with group entities, round-tripping risk"],
    ["fraud", "Fraud triangle pressure", "Pressure from debt or targets, opportunity from weak controls, rationalisation"],
    ["industry", "Industry outlook", "Cyclicality, regulation, demand outlook and industry-wide stress"],
    ["position", "Business and market position", "Scale and rank within the industry, customer concentration, pricing power"],
    ["flexibility", "Financial flexibility", "Access to banks and capital markets, unencumbered assets, liquidity buffers"],
  ];
  const BQR_SCALE = [[90, 1, "Prime"], [82, 2, "Prime"], [74, 3, "Strong"], [66, 4, "Strong"], [58, 5, "Satisfactory"],
    [50, 6, "Satisfactory"], [42, 7, "Watch"], [34, 8, "Weak"], [26, 9, "Very weak"], [-1, 10, "Default risk"]];
  function bqrFromScore(sc) { const r = BQR_SCALE.find((x) => sc >= x[0]); return { grade: r[1], label: r[2] }; }
  // quantRisk: 0-100 risk score (higher = riskier); qual: {factor: level}; notch: -2..+2 (positive = worse grade)
  function bqr(quantRisk, qual, notch = 0) {
    if (!isNum(quantRisk)) return null;
    const quant = 100 - quantRisk;
    const vals = QUAL_FACTORS.map(([k]) => qual[k]).filter((v) => v in QUAL_LEVELS).map((v) => QUAL_LEVELS[v]);
    const qualScore = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const combined = isNum(qualScore) ? 0.6 * quant + 0.4 * qualScore : quant;
    const base = bqrFromScore(combined);
    const g = Math.max(1, Math.min(10, base.grade + notch));
    return { quant, qualScore, combined, assessed: vals.length, baseGrade: base.grade, grade: g, label: BQR_SCALE.find((x) => x[1] === g)[2] };
  }

  // Data-derived suggestions for six qualitative factors. ctx = { indMedianRisk, sizePct } from the peer universe.
  function qualSuggest(m, t, a, ctx = {}) {
    const A = m.A, out = {}, why = {};
    const pr = promoter(m);
    if (pr) {
      const st = pr.to[1];
      out.promoter = pr.change < -10 ? "Poor" : pr.change < -3 ? "Weak" : st >= 50 ? "Strong" : st >= 30 ? "Satisfactory" : "Acceptable";
      why.promoter = `Promoter stake ${st.toFixed(1)}%, change ${pr.change >= 0 ? "+" : ""}${pr.change.toFixed(1)} points over the period shown`;
    } else { out.promoter = "Acceptable"; why.promoter = "No promoter holding reported (professionally managed or data not available)"; }
    const adv = div(A.loansAdv[t], A.sales[t]);
    if (isNum(adv)) {
      out.related = adv > 0.25 ? "Weak" : adv > 0.15 ? "Acceptable" : adv > 0.05 ? "Satisfactory" : "Strong";
      why.related = `Loans and advances = ${(100 * adv).toFixed(1)}% of revenue (proxy; verify related-party note)`;
    }
    // Red flags only: the distress models already carry 25% of the quantitative score, so they are not counted twice.
    const redF = a.fl.filter((x) => x.status === "R").length;
    out.fraud = redF >= 5 ? "Poor" : redF >= 4 ? "Weak" : redF >= 3 ? "Acceptable" : redF >= 1 ? "Satisfactory" : "Strong";
    why.fraud = `${redF} red flag(s) on the forensic checklist (tab 8)`;
    if (isNum(ctx.indMedianRisk)) {
      const r = ctx.indMedianRisk;
      out.industry = r < 20 ? "Strong" : r < 28 ? "Satisfactory" : r < 36 ? "Acceptable" : r < 45 ? "Weak" : "Poor";
      why.industry = `Median risk score of the industry = ${r.toFixed(0)}`;
    }
    if (isNum(ctx.sizePct)) {
      const q = ctx.sizePct;
      out.position = q >= 0.8 ? "Strong" : q >= 0.5 ? "Satisfactory" : q >= 0.25 ? "Acceptable" : "Weak";
      why.position = `Revenue larger than ${Math.round(q * 100)}% of industry peers`;
    }
    const nd = A.netDebt[t], eb = A.ebitda[t];
    out.flexibility = isNum(nd) && nd <= 0 ? "Strong" : isNum(eb) && eb > 0 && isNum(nd) ? (nd / eb < 2 ? "Satisfactory" : nd / eb < 4 ? "Acceptable" : "Weak") : "Poor";
    why.flexibility = isNum(nd) && nd <= 0 ? "Net cash position" : isNum(eb) && eb > 0 && isNum(nd) ? `Net debt / EBITDA ${(nd / eb).toFixed(1)}x` : "Negative EBITDA limits access to new funding";
    return { levels: out, why };
  }

  /* ======================= 12. Lending policy, loan structure and covenants ======================= */
  // Policy limits are set by the lending institution; these defaults are editable in the dashboard.
  const DEFAULT_POLICY = {
    limits: [ // by BQR grade band: maximum debt/EBITDA and debt/equity after the new loan
      { band: "1-2", from: 1, to: 2, maxLev: 4.0, maxDE: 2.0 }, { band: "3-4", from: 3, to: 4, maxLev: 3.5, maxDE: 1.75 },
      { band: "5-6", from: 5, to: 6, maxLev: 3.0, maxDE: 1.5 }, { band: "7", from: 7, to: 7, maxLev: 2.5, maxDE: 1.25 },
      { band: "8", from: 8, to: 8, maxLev: 1.75, maxDE: 1.0, securedOnly: true }, { band: "9-10", from: 9, to: 10, maxLev: 0, maxDE: 0 },
    ],
    loanTypes: {
      senior: { label: "Senior secured", levAdd: 0.5, cover: 1.5, lgd: 25, note: "First charge on fixed assets; ranks ahead of all other lenders." },
      secured: { label: "Secured", levAdd: 0.25, cover: 1.25, lgd: 35, note: "Charge on assets, shared or second-ranking." },
      unsecured: { label: "Unsecured", levAdd: 0, cover: 0, lgd: 45, note: "No charge on assets; depends entirely on cash flow and covenants." },
    },
  };
  function structure(m, t, o) {
    o = { ...o, debt: o.debt || debtFor(m.industry) };
    const A = m.A, p = o.policy || DEFAULT_POLICY, lt = p.loanTypes[o.loanType];
    const band = p.limits.find((l) => o.grade >= l.from && o.grade <= l.to) || p.limits[p.limits.length - 1];
    const maxLev = band.maxLev > 0 ? band.maxLev + lt.levAdd : 0, maxDE = band.maxDE;
    const debt = z0(A.borrow[t]), ebitda = A.ebitda[t], eq = A.equity[t], ebit = A.ebit[t], intr = z0(A.interest[t]);
    const collateral = sum(A.nfa[t], A.cwip[t]);
    const cfads0 = isNum(A.cfo[t]) ? A.cfo[t] - z0(A.dep[t]) * (o.debt.maintPct / 100) : null;
    const princ0 = (isNum(A.ltb[t]) ? A.ltb[t] : debt) / o.debt.tenor;
    // DSCR limit: largest new loan L with CFADS / (interest + L x rate + existing principal + L / tenor) >= required DSCR
    const caps = {
      leverage: isNum(ebitda) && ebitda > 0 ? maxLev * ebitda - debt : 0,
      gearing: isNum(eq) && eq > 0 ? maxDE * eq - debt : 0,
      dscr: isNum(cfads0) && cfads0 > 0 ? (cfads0 / o.debt.dscr - intr - princ0) / (o.debt.rate / 100 + 1 / o.debt.tenor) : 0,
      security: lt.cover > 0 ? (isNum(collateral) ? collateral / lt.cover - debt : 0) : null,
    };
    // Bands marked securedOnly do not allow unsecured lending at all.
    if (band.securedOnly && !(lt.cover > 0)) caps.policy = 0;
    const binding = Object.entries(caps).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
    const maxLoan = Math.max(0, binding[1]);
    const L = o.amount;
    const newDebt = debt + L, newInt = intr + (L * o.debt.rate) / 100;
    const cfads = cfads0;
    const princ = princ0 + L / o.debt.tenor;
    const pf = {
      debtEbitda: isNum(ebitda) && ebitda > 0 ? newDebt / ebitda : null, de: isNum(eq) && eq > 0 ? newDebt / eq : null,
      intCover: newInt > 0 ? div(ebit, newInt) : null, dscr: isNum(cfads) && newInt + princ > 0 ? cfads / (newInt + princ) : null,
      currentRatio: div(A.curAssets[t], A.curLiab[t]), netWorth: eq, cover: lt.cover > 0 && newDebt > 0 ? div(collateral, newDebt) : null,
    };
    const pd = o.pd, ead = L, lgd = lt.lgd / 100;
    return { band, maxLev, maxDE, caps, binding: binding[0], maxLoan, amount: L, newDebt, pf, collateral, lt,
      el: isNum(pd) ? { pd, lgd, ead, el: pd * lgd * ead } : null, within: L <= maxLoan + 1e-6 };
  }
  // Covenant tests: [key, label, kind, threshold] with kind "max" or "min"
  function covenants(m, t, pf, c) {
    const A = m.A, ebitda = A.ebitda[t], ebit = A.ebit[t];
    const rows = [
      ["debtEbitda", "Maximum debt / EBITDA", "max", c.maxLev, pf.debtEbitda, (x) => fxn(x) + "x"],
      ["de", "Maximum debt / equity", "max", c.maxDE, pf.de, (x) => fxn(x) + "x"],
      ["intCover", "Minimum interest cover", "min", c.minIcr, pf.intCover, (x) => fxn(x) + "x"],
      ["dscr", "Minimum DSCR", "min", c.minDscr, pf.dscr, (x) => fxn(x) + "x"],
      ["currentRatio", "Minimum current ratio", "min", c.minCr, pf.currentRatio, (x) => fxn(x) + "x"],
      ["netWorth", "Minimum tangible net worth (Rs cr)", "min", c.minNw, pf.netWorth, (x) => (isNum(x) ? Math.round(x).toLocaleString("en-IN") : "n/a")],
    ].map(([key, label, kind, thr, actual, fm]) => {
      if (!isNum(thr) || thr <= 0 || !isNum(actual)) return { key, label, kind, thr, actual, fm, status: "NA", headroom: null };
      const headroom = kind === "max" ? (thr - actual) / thr : (actual - thr) / thr;
      return { key, label, kind, thr, actual, fm, headroom, status: headroom < 0 ? "R" : headroom < 0.15 ? "A" : "G" };
    });
    // EBITDA cushion: fall in EBITDA (and EBIT by the same amount) before the first earnings-linked covenant breaks
    let cushion = null;
    const lev = rows[0], icr = rows[2];
    const c1 = isNum(lev.thr) && lev.thr > 0 && isNum(lev.actual) && isNum(ebitda) && ebitda > 0 ? 1 - lev.actual / lev.thr : null;
    const c2 = isNum(icr.thr) && icr.thr > 0 && isNum(icr.actual) && isNum(ebit) && ebit > 0 ? (ebit - icr.thr * (ebit / icr.actual)) / ebitda : null;
    const cs = [c1, c2].filter(isNum);
    if (cs.length) cushion = Math.min(...cs);
    return { rows, cushion };
  }
  function fxn(x) { return isNum(x) ? x.toFixed(2) : "n/a"; }

  root.Models = { fromScreener, fromWide, liquidity, cceLabel, solvency, debtCapacity, altman, ohlson, zmijewski, springate,
    fulmer, kzIndex, accruals, beneish, cScore, piotroski, aem, rem, benford, profitability, market, lifeCycle, durbinWatson,
    redFlags, quarterShare, promoter, assess, PILLARS, GRADES, IMPORT_FIELDS, DEFAULT_TACR, DEFAULT_DEBT, AEM_COEF, REM_COEF,
    isNum, div, growth, band, MANUFACTURING, LONG_TENOR, debtFor, QUAL_LEVELS, QUAL_FACTORS, BQR_SCALE, bqr, bqrFromScore, qualSuggest, DEFAULT_POLICY, structure, covenants };
})(typeof window !== "undefined" ? window : globalThis);
