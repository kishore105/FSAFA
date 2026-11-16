/* Scores every company in data/companies/ with assets/models.js and writes
   data/universe.json (portfolio table, industry peer statistics).
   Run: node build_summary.js */
const fs = require("fs");
const path = require("path");
require("./assets/models.js");
const M = globalThis.Models;

const dir = path.join(__dirname, "data", "companies");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const out = [], skipped = [], keep = {};
const r = (x, d = 3) => (M.isNum(x) ? +x.toFixed(d) : x === Infinity ? "inf" : null);

for (const f of files) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { console.error("bad file", f); continue; }
  if (!raw.pl || !raw.pl.rows || !raw.pl.rows.Sales) { console.error("skip (no Sales row)", f); skipped.push([raw.ticker || f, "statements not in the standard format"]); continue; }
  const m = M.fromScreener(raw);
  let t = m.n - 1;
  while (t > 0 && !(M.isNum(m.A.sales[t]) && M.isNum(m.A.ta[t]))) t--; // latest year with both P&L and balance sheet
  if (t < 2) { console.error("skip (short history)", f); skipped.push([raw.ticker, "fewer than three annual reports"]); continue; }
  const a = M.assess(m, t);
  keep[raw.ticker] = { m, t, a };
  const hist = [];
  for (let k = Math.max(1, t - 5); k <= t; k++) { const h = M.assess(m, k); hist.push([m.years[k], r(h.score, 1)]); }
  const A = m.A;
  out.push({
    t: raw.ticker, n: raw.nse_name || raw.name, ind: m.industry, basis: raw.basis, fy: m.years[t], yrs: m.n,
    mcap: r(raw.top && raw.top["Market Cap"], 0), sales: r(A.sales[t], 0), ebitda: r(A.ebitda[t], 0), np: r(A.np[t], 0),
    debt: r(A.borrow[t], 0), cash: r(A.cash[t], 0),
    cr: r(a.liq.currentRatio), cce: r(a.liq.cce), ocf: r(a.liq.ocfRatio), wcd: r(a.liq.wcDays, 0), dd: r(A.debtorDays[t], 0),
    de: a.sol.deNote ? "neg" : r(a.sol.de), dEb: a.sol.debtEbitdaNote ? "neg" : r(a.sol.debtEbitda), ic: r(a.sol.intCover, 2), dscr: r(a.sol.dscr, 2), ffo: r(a.sol.ffoTl),
    ebm: r(M.div(A.ebitda[t], A.sales[t])), roce: r(M.profitability(m, t).roce),
    z: a.z ? r(a.z.primaryValue, 2) : null, zv: a.z ? (a.z.primary === "zPrime" ? "Z'" : "Z''") : null, zz: a.z ? a.z.primaryZone : null,
    op: a.o ? r(a.o.p) : null, ms: a.b ? r(a.b.M, 2) : null, cs: a.c ? a.c.C : null, fs: a.p ? a.p.F : null,
    sl: r(a.acc.sloan), kz: (() => { const k = M.kzIndex(m, m.n - 1); return k ? r(k.KZ) : null; })(), da: a.ae ? r(a.ae.da) : null, bf: a.bf ? a.bf.signal : null,
    fR: a.fl.filter((x) => x.status === "R").length, fA: a.fl.filter((x) => x.status === "A").length,
    pil: Object.fromEntries(Object.entries(a.pillar).map(([k, v]) => [k, r(v.score, 0)])),
    sc: r(a.score, 1), g: a.grade, gl: a.gradeLabel, hist,
  });
}
// Second pass: industry context, data-derived qualitative factors and the system BQR (60/40)
const med = (v) => { v = v.filter(M.isNum).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const byInd = {};
out.forEach((c) => (byInd[c.ind] = byInd[c.ind] || []).push(c));
out.forEach((c) => {
  const peers = byInd[c.ind], k = keep[c.t];
  const sizes = peers.map((p) => p.sales).filter(M.isNum);
  const ctx = { indMedianRisk: med(peers.map((p) => p.sc)), sizePct: M.isNum(c.sales) && sizes.length > 1 ? sizes.filter((x) => x < c.sales).length / (sizes.length - 1) : null };
  const q = M.qualSuggest(k.m, k.t, k.a, ctx);
  const b = M.bqr(k.a.score, q.levels, 0);
  if (b) { c.bqr = b.grade; c.bql = b.label; c.bqc = r(b.combined, 1); c.bqq = r(b.qualScore, 0); }
});
out.sort((x, y) => (y.mcap || 0) - (x.mcap || 0));
const universe = { built: new Date().toISOString(), count: out.length, skipped, source: "screener.in; NSE Nifty 500 constituent list", companies: out };
fs.writeFileSync(path.join(__dirname, "data", "universe.json"), JSON.stringify(universe));
console.log(`universe.json: ${out.length} companies`);
const by = {}; out.forEach((c) => (by[c.g] = (by[c.g] || 0) + 1));
console.log("grade distribution", by);
const bq = {}; out.forEach((c) => (bq[c.bqr] = (bq[c.bqr] || 0) + 1)); console.log("BQR distribution", bq);
