// Dashboard validation suite: data, calculations, grading, BQR balance, loan logic and text.
// Run: node tests/dashboard_checks.js   (exit code 1 if any check fails)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "assets", "models.js"));
const M = globalThis.Models;

const U = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "universe.json"), "utf8"));
const rows = U.companies;
const files = fs.readdirSync(path.join(ROOT, "data", "companies")).filter((f) => f.endsWith(".json"));
const raws = {};
files.forEach((f) => (raws[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "companies", f), "utf8"))));

const results = [];
function check(id, name, fn) {
  const fails = [];
  let tested = 0;
  try { tested = fn((msg) => fails.push(msg)) || 0; } catch (e) { fails.push("exception: " + e.message); }
  results.push({ id, name, tested, fails });
}
const num = (v) => typeof v === "number" && Number.isFinite(v);
const close = (a, b, rel = 0.005, abs = 0.0015) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));
// Year labels: "Mar 202618m" marks an 18-month transition period; it is matched on "Mar 2026".
const clean = (c) => String(c).replace(/\(S\)/g, "").replace(/\s+/g, " ").trim();
const key = (c) => clean(c).replace(/(\d{4}) ?\d+m$/, "$1");
const ann = (raw, fy) => { const c = raw.pl.cols.find((x) => key(x) === fy); const mm = c && clean(c).match(/\d{4} ?(\d+)m$/); return mm ? 12 / +mm[1] : 1; };
// raw row value for a fiscal year label
function rv(raw, sec, label, fy) {
  const s = raw[sec]; if (!s || !s.rows[label]) return null;
  const i = s.cols.map(key).indexOf(fy); const v = i >= 0 ? s.rows[label][i] : null;
  return num(v) ? v : null;
}
function sv(raw, sec, label, fy) {
  const s = raw.schedules && raw.schedules[sec]; if (!s || !s[label]) return null;
  const cols = sec === "profit-loss" ? raw.pl.cols : sec === "balance-sheet" ? raw.bs.cols : raw.cf.cols;
  const i = cols.map(key).indexOf(fy); const v = i >= 0 ? s[label][i] : null;
  return num(v) ? v : null;
}
const z = (v) => (num(v) ? v : 0);

// 1. Data integrity
check(1, "Data integrity: files parse, years ordered, universe complete", (fail) => {
  let n = 0;
  for (const [t, raw] of Object.entries(raws)) {
    n++;
    const yrs = raw.pl.cols.filter((c) => /\d{4}/.test(c) && c !== "TTM").map((c) => new Date("1 " + key(c)).getTime());
    for (let i = 1; i < yrs.length; i++) if (!(yrs[i] > yrs[i - 1])) { fail(`${t}: profit and loss years not in order`); break; }
    if (new Set(raw.pl.cols).size !== raw.pl.cols.length) fail(`${t}: duplicate year columns`);
  }
  const skipped = U.skipped.map((s) => s[0]);
  if (rows.length + skipped.length !== files.length) fail(`universe ${rows.length} + skipped ${skipped.length} != files ${files.length}`);
  if (U.count !== rows.length) fail("universe count field disagrees with rows");
  if (new Set(rows.map((r) => r.t)).size !== rows.length) fail("duplicate tickers in universe");
  return n;
});

// 2. Balance sheet identity in the source data
check(2, "Balance sheet: total assets = equity + borrowings + other liabilities", (fail) => {
  let n = 0;
  for (const r of rows) {
    const raw = raws[r.t];
    for (const fy of raw.bs.cols.map(key)) {
      const ta = rv(raw, "bs", "Total Assets", fy), tl = rv(raw, "bs", "Total Liabilities", fy);
      if (!num(ta)) continue; n++;
      const parts = z(rv(raw, "bs", "Equity Capital", fy)) + z(rv(raw, "bs", "Reserves", fy)) + z(rv(raw, "bs", "Borrowings", fy)) + z(rv(raw, "bs", "Other Liabilities", fy));
      const assets = z(rv(raw, "bs", "Fixed Assets", fy)) + z(rv(raw, "bs", "CWIP", fy)) + z(rv(raw, "bs", "Investments", fy)) + z(rv(raw, "bs", "Other Assets", fy));
      if (num(tl) && Math.abs(ta - tl) > Math.max(2, 0.001 * ta)) fail(`${r.t} ${fy}: TA ${ta} vs TL ${tl}`);
      if (Math.abs(parts - ta) > Math.max(2, 0.002 * ta)) fail(`${r.t} ${fy}: liabilities side ${parts} vs TA ${ta}`);
      if (Math.abs(assets - ta) > Math.max(2, 0.002 * ta)) fail(`${r.t} ${fy}: assets side ${assets} vs TA ${ta}`);
    }
  }
  return n;
});

// 3. Core ratios recomputed directly from the source rows (independent of the engine)
check(3, "Ratios recomputed from source rows: D/E, debt/EBITDA, interest cover, CFO/EBITDA, EBITDA margin", (fail) => {
  let n = 0;
  for (const r of rows) {
    const raw = raws[r.t], fy = r.fy;
    const eq = z(rv(raw, "bs", "Equity Capital", fy)) + z(rv(raw, "bs", "Reserves", fy));
    const debt = rv(raw, "bs", "Borrowings", fy), eb = rv(raw, "pl", "Operating Profit", fy), sales = rv(raw, "pl", "Sales", fy);
    const pbt = rv(raw, "pl", "Profit before tax", fy), intr = rv(raw, "pl", "Interest", fy), cfo = rv(raw, "cf", "Cash from Operating Activity", fy);
    const exp = {
      de: eq > 0 ? debt / eq : "neg",
      dEb: !num(debt) ? null : debt <= 0 ? 0 : eb > 0 ? debt / (eb * ann(raw, fy)) : "neg",
      ic: intr > 0 ? (pbt + intr) / intr : null,
      cce: num(cfo) && eb > 0 ? cfo / eb : null,
      ebm: sales ? eb / sales : null,
    };
    for (const [k, e] of Object.entries(exp)) {
      const got = r[k]; n++;
      if (e === "neg" || got === "neg") { if (e !== got) fail(`${r.t} ${k}: expected ${e} got ${got}`); continue; }
      if (e === null) continue;
      if (!num(got) || !close(got, e, 0.005, k === "ic" ? 0.006 : 0.0015)) fail(`${r.t} ${k}: expected ${e.toFixed(3)} got ${got}`);
    }
  }
  return n;
});

// 4. Distress models recomputed by formula
check(4, "Altman Z'/Z'' and Ohlson recomputed by formula; Ohlson P within 0-1", (fail) => {
  let n = 0;
  for (const r of rows) {
    const raw = raws[r.t], fy = r.fy;
    const ta = rv(raw, "bs", "Total Assets", fy), eq = z(rv(raw, "bs", "Equity Capital", fy)) + z(rv(raw, "bs", "Reserves", fy)), tl = ta - eq;
    const ca = rv(raw, "bs", "Other Assets", fy);
    const cl = z(rv(raw, "bs", "Other Liabilities", fy)) - z(sv(raw, "balance-sheet", "Non controlling int", fy)) + z(sv(raw, "balance-sheet", "Short term Borrowings", fy));
    const k1 = ann(raw, fy);
    const ebit = (z(rv(raw, "pl", "Profit before tax", fy)) + z(rv(raw, "pl", "Interest", fy))) * k1, sales = rv(raw, "pl", "Sales", fy) * k1;
    const X1 = (ca - cl) / ta, X2 = z(rv(raw, "bs", "Reserves", fy)) / ta, X3 = ebit / ta, X4 = eq / tl, X5 = sales / ta;
    if (num(r.z) && num(X1)) {
      n++;
      const zz = r.zv === "Z'" ? 0.717 * X1 + 0.847 * X2 + 3.107 * X3 + 0.42 * X4 + 0.998 * X5 : 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
      if (!close(r.z, zz, 0.005, 0.006)) fail(`${r.t} ${r.zv}: expected ${zz.toFixed(3)} got ${r.z}`);
      const zone = r.zv === "Z'" ? (zz > 2.9 ? "Safe" : zz >= 1.23 ? "Grey" : "Distress") : zz > 2.6 ? "Safe" : zz >= 1.1 ? "Grey" : "Distress";
      if (zone !== r.zz && Math.abs(zz - (r.zv === "Z'" ? 2.9 : 2.6)) > 0.01 && Math.abs(zz - (r.zv === "Z'" ? 1.23 : 1.1)) > 0.01) fail(`${r.t}: zone ${r.zz}, expected ${zone}`);
    }
    if (r.op !== null) {
      n++;
      if (!(r.op >= 0 && r.op <= 1)) fail(`${r.t}: Ohlson P ${r.op} outside 0-1`);
      const i = raw.pl.cols.map(key).indexOf(fy), fy0 = key(raw.pl.cols[i - 1]);
      const np = rv(raw, "pl", "Net Profit", fy) * k1, np0 = rv(raw, "pl", "Net Profit", fy0) * ann(raw, fy0);
      const ffo = np + (z(rv(raw, "pl", "Depreciation", fy)) - z(sv(raw, "profit-loss", "Exceptional items", fy))) * k1;
      const ch = Math.abs(np) + Math.abs(np0) > 0 ? (np - np0) / (Math.abs(np) + Math.abs(np0)) : 0;
      const T = -1.32 - 0.407 * Math.log(ta / 100) + 6.03 * (tl / ta) - 1.43 * ((ca - cl) / ta) + 0.0757 * (cl / ca) - 1.72 * (tl > ta ? 1 : 0)
        - 2.37 * (np / ta) - 1.83 * (ffo / tl) + 0.285 * (np < 0 && np0 < 0 ? 1 : 0) - 0.521 * ch;
      const p = 1 / (1 + Math.exp(-T));
      if (!close(r.op, p, 0.005, 0.0015)) fail(`${r.t} Ohlson: expected ${p.toFixed(4)} got ${r.op}`);
    }
  }
  return n;
});

// 5. Score ranges and model signals
check(5, "Score ranges: Piotroski 0-9, C-score 0-6, Benford G/A/R, pillars 0-100", (fail) => {
  let n = 0;
  for (const r of rows) {
    n++;
    if (r.fs !== null && !(Number.isInteger(r.fs) && r.fs >= 0 && r.fs <= 9)) fail(`${r.t}: F-score ${r.fs}`);
    if (r.cs !== null && !(Number.isInteger(r.cs) && r.cs >= 0 && r.cs <= 6)) fail(`${r.t}: C-score ${r.cs}`);
    if (r.bf !== null && !["G", "A", "R"].includes(r.bf)) fail(`${r.t}: Benford ${r.bf}`);
    for (const [k, v] of Object.entries(r.pil)) if (v !== null && !(v >= 0 && v <= 100)) fail(`${r.t}: pillar ${k} ${v}`);
    if (!(r.sc >= 0 && r.sc <= 100)) fail(`${r.t}: risk score ${r.sc}`);
  }
  return n;
});

// 6. Risk score = weighted pillar average; credit watch grade mapping
check(6, "Risk score = weighted pillar average; CW grade follows the score bands", (fail) => {
  let n = 0;
  for (const r of rows) {
    n++;
    let tot = 0, wt = 0;
    for (const [k, p] of Object.entries(M.PILLARS)) if (num(r.pil[k])) { tot += r.pil[k] * p.weight; wt += p.weight; }
    // pillar scores are rounded in the file, so allow 0.6 points
    if (Math.abs(tot / wt - r.sc) > 0.6) fail(`${r.t}: weighted pillars ${(tot / wt).toFixed(1)} vs score ${r.sc}`);
    const g = M.GRADES.find((x) => r.sc < x[0]), g2 = M.GRADES.find((x) => r.sc - 0.05 < x[0]); // file score is rounded to 0.1
    if (g[1] !== r.g && g2[1] !== r.g) fail(`${r.t}: score ${r.sc} should be ${g[1]}, file has ${r.g}`);
  }
  return n;
});

// 7. BQR arithmetic: 60/40 blend and scale mapping
check(7, "BQR: combined = 0.6 x (100 - risk) + 0.4 x qualitative; grade follows the scale", (fail) => {
  let n = 0;
  for (const r of rows) {
    n++;
    const comb = 0.6 * (100 - r.sc) + 0.4 * r.bqq;
    if (Math.abs(comb - r.bqc) > 0.35) fail(`${r.t}: blend ${comb.toFixed(1)} vs ${r.bqc}`);
    const g = M.bqrFromScore(r.bqc).grade, g2 = M.bqrFromScore(r.bqc - 0.05).grade; // combined score is rounded to 0.1
    if (g !== r.bqr && g2 !== r.bqr) fail(`${r.t}: combined ${r.bqc} maps to ${g}, file has ${r.bqr}`);
    const b = M.bqr(40, { management: "Strong", board: "Strong" }, 3);
    if (b.grade < 1 || b.grade > 10) fail("notch not clamped");
  }
  return n;
});

// 8. Differentiation: weaker grades must look weaker on measures that are reported, not modelled
check(8, "Differentiation: BQR rank-correlates with cover, leverage and Ohlson P; medians ordered across lending zones", (fail) => {
  const zones = [[1, 2], [3, 4], [5, 6], [7, 10]];
  const med = (a) => { a = a.filter(num).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), rk = Array(a.length); let i = 0;
    while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) rk[o[k][1]] = (i + j) / 2; i = j + 1; } return rk; };
  const spear = (x, y) => { const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => num(a) && num(b)); const rx = rank(p.map((q) => q[0])), ry = rank(p.map((q) => q[1]));
    const mx = rx.reduce((a, b) => a + b) / rx.length, my = ry.reduce((a, b) => a + b) / ry.length; let sxy = 0, sxx = 0, syy = 0;
    rx.forEach((v, i) => { sxy += (v - mx) * (ry[i] - my); sxx += (v - mx) ** 2; syy += (ry[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
  const metrics = { "interest cover": [(r) => (num(r.ic) ? Math.min(r.ic, 100) : null), -1], "debt / EBITDA": [(r) => (r.dEb === "neg" ? 99 : r.dEb), 1],
    "Ohlson P": [(r) => r.op, 1], ROCE: [(r) => r.roce, -1] };
  // EBITDA margin is reported for information only: capital-intensive sectors (power, realty) earn high margins with high debt.
  let n = 0;
  for (const [k, [f, dir]] of Object.entries(metrics)) {
    n++;
    const rho = spear(rows.map((r) => r.bqr), rows.map(f));
    if (!(dir * rho > 0.2)) fail(`${k}: rank correlation with BQR ${rho.toFixed(2)} (expected sign ${dir > 0 ? "+" : "-"}, size above 0.2)`);
    const meds = zones.map(([a, b]) => med(rows.filter((r) => r.bqr >= a && r.bqr <= b).map(f)));
    for (let i = 1; i < meds.length; i++) if (dir * (meds[i] - meds[i - 1]) < 0) fail(`${k}: zone medians out of order ${JSON.stringify(meds.map((x) => +x.toFixed(2)))}`);
    console.log(`        ${k.padEnd(15)} rho ${rho.toFixed(2)}  zone medians ${meds.map((x) => x.toFixed(2)).join(" / ")}`);
  }
  const em = zones.map(([a, b]) => med(rows.filter((r) => r.bqr >= a && r.bqr <= b).map((r) => r.ebm)));
  console.log(`        EBITDA margin   (information) zone medians ${em.map((x) => x.toFixed(2)).join(" / ")}`);
  return n;
});

// 9. Balance: the scale must allow a lender to do business while separating weak names
check(9, "Balance: most borrowers lendable, few in no-lending band, every lending grade used", (fail) => {
  const N = rows.length, c = (f) => rows.filter(f).length;
  const noLend = c((r) => r.bqr >= 9) / N, pass = c((r) => r.bqr <= 6) / N, top = c((r) => r.bqr <= 2) / N;
  if (noLend > 0.03) fail(`no-lending band holds ${(100 * noLend).toFixed(1)}% (limit 3%)`);
  if (pass < 0.8) fail(`normal-lending grades hold ${(100 * pass).toFixed(1)}% (minimum 80%)`);
  if (top > 0.4) fail(`grades 1-2 hold ${(100 * top).toFixed(1)}%; the top of the scale does not separate`);
  for (let g = 1; g <= 8; g++) if (!c((r) => r.bqr === g)) fail(`grade ${g} is empty`);
  for (let g = 1; g <= 10; g++) if (c((r) => r.bqr === g) / N > 0.35) fail(`grade ${g} holds more than 35% of borrowers`);
  return 5;
});

// 10. Loan structuring invariants for every borrower and loan type
check(10, "Loan sizing: max loan = lowest limit, DSCR limit gives exactly the required DSCR, policy bands respected", (fail) => {
  let n = 0;
  for (const r of rows) {
    const raw = { ...raws[r.t], industry: r.ind };
    const m = M.fromScreener(raw), t = m.years.indexOf(r.fy);
    const debt = M.debtFor(m.industry);
    for (const lt of ["senior", "secured", "unsecured"]) {
      n++;
      const s0 = M.structure(m, t, { grade: r.bqr, loanType: lt, amount: 0, debt, pd: r.op });
      const caps = Object.values(s0.caps).filter((v) => v !== null);
      if (Math.abs(s0.maxLoan - Math.max(0, Math.min(...caps))) > 1e-6) fail(`${r.t} ${lt}: max loan is not the lowest limit`);
      if (s0.maxLoan < 0) fail(`${r.t} ${lt}: negative max loan`);
      if (r.bqr >= 9 && s0.maxLoan > 0) fail(`${r.t} ${lt}: BQR ${r.bqr} should get no fresh lending`);
      if (r.bqr === 8 && lt === "unsecured" && s0.maxLoan > 0) fail(`${r.t}: unsecured lending allowed at BQR 8`);
      if (s0.maxLoan > 1) {
        const s = M.structure(m, t, { grade: r.bqr, loanType: lt, amount: s0.maxLoan, debt, pd: r.op });
        if (s.binding === "dscr" && !close(s.pf.dscr, debt.dscr, 1e-6, 1e-6)) fail(`${r.t} ${lt}: DSCR at limit ${s.pf.dscr}`);
        if (s.binding === "leverage" && !close(s.pf.debtEbitda, s0.maxLev, 1e-6, 1e-6)) fail(`${r.t} ${lt}: leverage at limit ${s.pf.debtEbitda}`);
        if (s.binding === "gearing" && !close(s.pf.de, s0.maxDE, 1e-6, 1e-6)) fail(`${r.t} ${lt}: gearing at limit ${s.pf.de}`);
        if (s.binding === "security" && !close(s.pf.cover, s.lt.cover, 1e-6, 1e-6)) fail(`${r.t} ${lt}: cover at limit ${s.pf.cover}`);
        if (!s.within) fail(`${r.t} ${lt}: loan at the maximum flagged as outside policy`);
        if (s.el && Math.abs(s.el.el - r.op * (s.lt.lgd / 100) * s0.maxLoan) > 1e-6) fail(`${r.t} ${lt}: expected loss arithmetic`);
      }
    }
  }
  return n;
});

// 11. Covenant tests: status follows headroom; EBITDA cushion brings the tightest covenant to its threshold
check(11, "Covenants: status follows headroom; EBITDA cushion lands on the threshold", (fail) => {
  let n = 0;
  for (const r of rows.slice(0, 400)) {
    const m = M.fromScreener({ ...raws[r.t], industry: r.ind }), t = m.years.indexOf(r.fy);
    const s = M.structure(m, t, { grade: Math.min(r.bqr, 7), loanType: "senior", amount: 0, debt: M.debtFor(m.industry) });
    const cov = { maxLev: s.maxLev, maxDE: s.maxDE, minIcr: 2, minDscr: 1.2, minCr: 1.0, minNw: 1 };
    const c = M.covenants(m, t, s.pf, cov);
    for (const row of c.rows) {
      n++;
      if (row.status === "NA") continue;
      const exp = row.headroom < 0 ? "R" : row.headroom < 0.15 ? "A" : "G";
      if (exp !== row.status) fail(`${r.t} ${row.key}: status ${row.status} vs headroom ${row.headroom}`);
    }
    const A = m.A, eb = A.ebitda[t];
    if (num(c.cushion) && c.cushion > 0 && eb > 0 && s.pf.debtEbitda > 0) {
      const eb2 = eb * (1 - c.cushion), ebit2 = A.ebit[t] - eb * c.cushion;
      const lev2 = s.pf.debtEbitda * eb / eb2, icr2 = s.pf.intCover * ebit2 / A.ebit[t];
      const hitLev = num(lev2) && close(lev2, cov.maxLev, 1e-4, 1e-4), hitIcr = num(icr2) && close(icr2, cov.minIcr, 1e-4, 1e-4);
      if (!hitLev && !hitIcr) fail(`${r.t}: cushion ${c.cushion.toFixed(3)} does not bring leverage (${lev2}) or ICR (${icr2}) to the threshold`);
    }
  }
  return n;
});

// 12. Universe hygiene: no NaN or infinite values, markers only where valid
check(12, "Universe file: no NaN or infinity; 'neg' markers only for negative equity or EBITDA", (fail) => {
  let n = 0;
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object") walk(v, p + "." + k); else if (typeof v === "number" && !Number.isFinite(v)) fail(`${p}.${k} = ${v}`); } };
  for (const r of rows) {
    n++; walk(r, r.t);
    const raw = raws[r.t], eq = z(rv(raw, "bs", "Equity Capital", r.fy)) + z(rv(raw, "bs", "Reserves", r.fy));
    if ((r.de === "neg") !== (eq <= 0)) fail(`${r.t}: D/E marker ${r.de} with equity ${eq}`);
    if (r.bqr === undefined || r.bqr === null) fail(`${r.t}: missing BQR`);
  }
  return n;
});

// 13. Text: no em dashes, no AI-style vocabulary, no course or exam references, no build notes
check(13, "Text: no em dashes, no AI-style phrasing, no session or exam references, no build notes", (fail) => {
  const targets = ["index.html", "assets/app.js", "README.md"];
  const banned = [/—/, /\bdelve/i, /\bseamless/i, /\brobust\b/i, /\bunderscore/i, /testament to/i, /\bImportantly\b/, /\bNotably\b/, /worth noting/i, /\bcutting-edge/i,
    /\bgame.?changer/i, /\bunlock/i, /\bempower/i, /\bholistic/i, /\bsynerg/i, /\bin today's/i, /\bnavigate the/i, /\blandscape\b/i, /\bcrucial\b/i, /\bpivotal\b/i, /\bmeticulous/i,
    /\bsession\b/i, /\bexam\b/i, /\blecture/i, /\bprofessor\b/i, /\bClaude\b/, /\bChatGPT\b/, /\bAI[- ]generated/i, /\bTODO\b/, /\bTBD\b/, /\[VERIFY\]/, /lorem ipsum/i, /Wells Fargo/i];
  let n = 0;
  for (const f of targets) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
    lines.forEach((ln, i) => { n++; banned.forEach((re) => { if (re.test(ln)) fail(`${f}:${i + 1} matches ${re}: ${ln.trim().slice(0, 90)}`); }); });
  }
  return n;
});

// 14. Course worked examples and the independent Python cross-check
check(14, "Course worked examples (14) and Python cross-check", (fail) => {
  const a = execSync("node " + path.join(__dirname, "validate_course_examples.js"), { encoding: "utf8" });
  const pass = (a.match(/PASS/g) || []).length, bad = (a.match(/FAIL/g) || []).length;
  if (bad || pass < 14) fail(`course examples: ${pass} pass, ${bad} fail`);
  const p = execSync("python3 " + path.join(__dirname, "crosscheck_python.py"), { encoding: "utf8" });
  if (!/All figures match/.test(p)) fail("Python cross-check reports a mismatch");
  return pass + 6;
});

let failed = 0;
for (const r of results) {
  const ok = r.fails.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(r.id).padStart(2)}. ${r.name}  [${r.tested} items]`);
  r.fails.slice(0, 8).forEach((f) => console.log("        - " + f));
  if (r.fails.length > 8) console.log(`        ... ${r.fails.length - 8} more`);
}
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
