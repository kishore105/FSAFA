/* Credit Risk Monitor: user interface */
(function () {
  "use strict";
  const M = window.Models, isNum = M.isNum;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const S = { U: null, list: [], byT: {}, imported: {}, m: null, t: null, view: "portfolio",
    tacr: { ...M.DEFAULT_TACR }, debt: { ...M.DEFAULT_DEBT }, sort: { key: "bqr", asc: false }, page: 0, charts: {},
    loan: { type: "senior", amount: null }, policy: JSON.parse(JSON.stringify(M.DEFAULT_POLICY)), cov: null };
  const PAGE = 25;
  const COLORS = { navy: "#12355b", teal: "#0e7c86", gold: "#b7862b", g: "#1f8a4c", a: "#c27c0e", r: "#c0392b", grey: "#a3acbd", light: "#dfe6ee",
    CW1: "#1f7a46", CW2: "#5c9a3c", CW3: "#c9971c", CW4: "#d0632a", CW5: "#b3261e" };

  /* ---------------- formatting ---------------- */
  const z0 = (v) => (isNum(v) ? v : 0);
  const val = (v) => (v === "inf" ? Infinity : v === "neg" ? -Infinity : v);
  const f = (v, d = 2) => { v = val(v); return v === Infinity ? "No debt" : v === -Infinity ? "n/a" : isNum(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "n/a"; };
  const fx = (v, d = 2) => { const neg = v === "neg"; v = val(v); return neg ? '<span style="color:#c0392b">Negative</span>' : v === Infinity ? "No debt" : isNum(v) ? f(v, d) + "x" : "n/a"; };
  const fp = (v, d = 1) => (isNum(val(v)) ? (100 * v).toFixed(d) + "%" : "n/a");
  const fc = (v) => (isNum(v) ? Math.round(v).toLocaleString("en-IN") : "n/a");
  const fd = (v) => (isNum(v) ? Math.round(v) + " days" : "n/a");
  const sig = (s, txt) => `<span class="sig ${s || "NA"}">${txt || { G: "Green", A: "Amber", R: "Red", NA: "n/a" }[s || "NA"]}</span>`;
  const info = (tip) => `<span class="info" data-tip="${tip.replace(/"/g, "&quot;")}">i</span>`;
  const gradeChip = (g) => `<span class="grade ${g && g !== "n/a" ? g : "na"}">${g || "n/a"}</span>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BQR_COL = ["#1f7a46", "#2f8a45", "#5c9a3c", "#86a535", "#b5a32a", "#c9971c", "#d08424", "#d0632a", "#c4452a", "#b3261e"];
  const bqrChip = (g, l) => (isNum(g) ? `<span class="grade" style="background:${BQR_COL[g - 1]}" title="${l || ""}">BQR ${g}</span>` : '<span class="grade na">n/a</span>');
  const scoreColor = (s) => (!isNum(s) ? COLORS.grey : s < 20 ? COLORS.CW1 : s < 35 ? COLORS.CW2 : s < 50 ? COLORS.CW3 : s < 65 ? COLORS.CW4 : COLORS.CW5);
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }

  /* ---------------- charts ---------------- */
  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5; Chart.defaults.color = "#5d6880";
    Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.maintainAspectRatio = false; Chart.defaults.animation.duration = 250;
  }
  function chart(id, cfg) {
    if (!window.Chart) { const c = document.getElementById(id); if (c) c.parentElement.innerHTML = '<div class="empty small">Charts need an internet connection (Chart.js).</div>'; return; }
    if (S.charts[id]) S.charts[id].destroy();
    const c = document.getElementById(id);
    if (c) S.charts[id] = new Chart(c, cfg);
  }
  const gridY = { grid: { color: "#eef1f6" }, border: { display: false } };
  const gridX = { grid: { display: false }, border: { color: "#dfe6ee" } };
  function lineCfg(labels, sets, yfmt, extra = {}) {
    return { type: "line", data: { labels, datasets: sets.map((s, i) => ({ borderWidth: 2, pointRadius: 2.5, tension: 0.25, spanGaps: true,
      borderColor: s.color || [COLORS.navy, COLORS.teal, COLORS.gold, COLORS.r][i], backgroundColor: s.color || [COLORS.navy, COLORS.teal, COLORS.gold, COLORS.r][i], ...s })) },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${yfmt(c.parsed.y)}` } }, ...(extra.plugins || {}) },
        scales: { x: gridX, y: { ...gridY, ticks: { callback: (v) => yfmt(v) }, ...(extra.y || {}) } } } };
  }
  // horizontal reference lines (thresholds)
  const refLines = { id: "refLines", afterDraw(ch, _a, o) {
    if (!o || !o.lines) return; const { ctx, chartArea: a, scales: { y } } = ch;
    o.lines.forEach((l) => { const yy = y.getPixelForValue(l.v); if (yy < a.top || yy > a.bottom) return;
      ctx.save(); ctx.strokeStyle = l.c; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
      ctx.fillStyle = l.c; ctx.font = "10.5px Inter, sans-serif"; ctx.fillText(l.t, a.left + 4, yy - 4); ctx.restore(); });
  } };
  if (window.Chart) Chart.register(refLines);

  /* ---------------- data loading ---------------- */
  async function load() {
    try {
      const r = await fetch("data/universe.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      S.U = await r.json();
    } catch (e) {
      $("#dataStatus").innerHTML = "<i style='background:#e5534b'></i>Data not loaded";
      $("#pfKpis").innerHTML = `<div class="card span2" style="grid-column:1/-1"><h3>Data could not be loaded</h3><p class="muted">Open the dashboard through its website address, or locally with <span class="mono">python3 -m http.server</span> in the dashboard folder. Browsers block data files when a page is opened directly from disk.</p></div>`;
      return;
    }
    S.list = S.U.companies;
    S.list.forEach((c) => (S.byT[c.t] = c));
    const d = new Date(S.U.built);
    $("#dataStatus").innerHTML = `<i></i>${S.list.length} borrowers · data as of ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
    refreshDatalist();
    const inds = [...new Set(S.list.map((c) => c.ind))].sort();
    $("#fInd").innerHTML = '<option value="">All industries</option>' + inds.map((i) => `<option>${esc(i)}</option>`).join("");
    $("#impInd").innerHTML = inds.map((i) => `<option>${esc(i)}</option>`).join("");
    $("#fGrade").innerHTML = '<option value="">All grades</option>' + M.GRADES.map((g) => `<option value="${g[1]}">${g[1]} ${g[2]}</option>`).join("");
    renderPortfolio();
    renderMethod();
    route();
  }
  function refreshDatalist() {
    const all = [...S.list, ...Object.values(S.imported).map((x) => x.row)];
    $("#coList").innerHTML = all.map((c) => `<option value="${esc(c.n)} (${c.t})"></option>`).join("");
  }

  async function selectCompany(ticker, view) {
    ticker = (ticker || "").toUpperCase();
    let raw, m;
    if (S.imported[ticker]) m = S.imported[ticker].m;
    else {
      if (!S.byT[ticker]) { toast("Borrower not found in the coverage universe"); return; }
      try { const r = await fetch(`data/companies/${encodeURIComponent(ticker)}.json`); raw = await r.json(); }
      catch (e) { toast("Could not load the statements for " + ticker); return; }
      raw.industry = raw.industry || S.byT[ticker].ind;
      m = M.fromScreener(raw);
    }
    S.m = m; S.cov = null; S.loan.amount = null;
    S.debt.tenor = M.debtFor(m.industry).tenor; // tenor follows the asset life of the borrower's industry
    const yrs = m.years.map((y, i) => [y, i]).filter(([, i]) => isNum(m.A.sales[i]) && isNum(m.A.ta[i]) && i >= 1);
    S.t = yrs.length ? yrs[yrs.length - 1][1] : m.n - 1;
    $("#fySel").disabled = false;
    const mo = (i) => (m.months && m.months[i] !== 12 ? ` (${m.months[i]}-month period, annualised)` : "");
    $("#fySel").innerHTML = yrs.reverse().map(([y, i]) => `<option value="${i}" ${i === S.t ? "selected" : ""}>FY ending ${y}${mo(i)}</option>`).join("");
    $("#coSearch").value = "";
    $$(".nav-item[data-needs]").forEach((b) => b.classList.remove("disabled"));
    const row = S.byT[ticker] || (S.imported[ticker] && S.imported[ticker].row);
    $("#sideBorrower").innerHTML = `<b>${esc(m.raw.nse_name || m.raw.name)}</b>${esc(m.industry)}<br>${row ? gradeChip(row.g) + " " + esc(row.gl) : ""}`;
    renderBorrower();
    go(view || (S.view === "portfolio" || S.view === "import" || S.view === "method" ? "summary" : S.view));
  }

  function renderBorrower() {
    S.a = M.assess(S.m, S.t, { tacr: S.tacr, debt: S.debt });
    computeBqr();
    renderSummary(); renderBqr(); renderLoan(); renderLiquidity(); renderSolvency(); renderDistress(); renderQuality(); renderFlags(); renderPeers();
  }

  /* ---------------- navigation ---------------- */
  function go(view) {
    S.view = view;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "v-" + view));
    const tk = S.m ? S.m.raw.ticker : "";
    history.replaceState(null, "", "#" + view + (tk && !["portfolio", "import", "method"].includes(view) ? "/" + tk : ""));
    window.scrollTo({ top: 0 });
    Object.values(S.charts).forEach((c) => c && c.resize());
  }
  function route() {
    const [view, tk] = location.hash.replace("#", "").split("/");
    if (tk && S.byT[tk.toUpperCase()]) selectCompany(tk, view);
    else if (view && $("#v-" + view) && !$(`.nav-item[data-view="${view}"]`).dataset.needs) go(view);
  }

  /* ================= 1. PORTFOLIO ================= */
  const COLS = [
    ["n", "Borrower", (c) => `<div class="co">${esc(c.n)}<small>${esc(c.t)} · ${esc(c.ind)} · FY ${esc(c.fy)}</small></div>`, "str"],
    ["bqr", "BQR", (c) => bqrChip(c.bqr, c.bql) + `<div class="small muted">${esc(c.bql || "")}</div>`],
    ["sc", "Quant. grade / risk", (c) => `${gradeChip(c.g)} <span class="bar" title="Risk score ${f(c.sc, 1)}"><i style="width:${Math.min(100, c.sc || 0)}%;background:${scoreColor(c.sc)}"></i></span> <span class="num small">${f(c.sc, 0)}</span>`],
    ["z", "Altman", (c) => (c.z == null ? "n/a" : `<span class="num">${f(c.z)}</span> <span class="zone ${c.zz}">${c.zv} ${c.zz}</span>`)],
    ["op", "Ohlson P", (c) => fp(c.op, 0), "n"],
    ["de", "D/E", (c) => fx(c.de), "n"],
    ["ic", "Int. cover", (c) => fx(c.ic, 1), "n"],
    ["dscr", "DSCR", (c) => fx(c.dscr, 2), "n"],
    ["cce", "CFO/EBITDA", (c) => fp(c.cce, 0), "n"],
    ["ms", "M-score", (c) => (c.ms == null ? "n/a" : `<span style="color:${c.ms > -2.22 ? COLORS.r : "inherit"}">${f(c.ms)}</span>`), "n"],
    ["fR", "Red flags", (c) => `<span class="sig R" title="Red">${c.fR}</span> <span class="sig A" title="Amber">${c.fA}</span>`, "n"],
  ];
  function filtered() {
    const ind = $("#fInd").value, g = $("#fGrade").value, z = $("#fZone").value, q = $("#fText").value.trim().toLowerCase();
    let L = S.list.filter((c) => (!ind || c.ind === ind) && (!g || c.g === g) && (!z || c.zz === z) && (!q || c.n.toLowerCase().includes(q) || c.t.toLowerCase().includes(q)));
    const { key, asc } = S.sort;
    const num = (v) => { if (v === "neg") return ["de", "dEb"].includes(key) ? 1e10 : -1e10; v = val(v); return v === Infinity ? 1e9 : isNum(v) ? v : asc ? 1e12 : -1e12; };
    L = L.slice().sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) : num(a[key]) - num(b[key])) * (asc ? 1 : -1));
    return L;
  }
  function renderPortfolio() {
    const L = S.list;
    const cnt = (fn) => L.filter(fn).length;
    const weak = cnt((c) => c.g === "CW4" || c.g === "CW5"), dist = cnt((c) => c.zz === "Distress"), ohl = cnt((c) => c.op > 0.5);
    const m5 = cnt((c) => c.ms > -2.22), negCfo = cnt((c) => c.cce != null && c.cce < 0);
    $("#pfKpis").innerHTML = [
      ["Borrowers covered", L.length, "Nifty 500 excluding financial services", "accent"],
      ["BQR 9-10 (no fresh lending)", cnt((c) => c.bqr >= 9), `${fp(cnt((c) => c.bqr >= 9) / L.length, 1)} of the portfolio; ${cnt((c) => c.bqr === 8)} more at BQR 8 (secured lending only)`],
      ["Altman distress zone", dist, "Z' or Z'' below the distress cut-off"],
      ["Ohlson probability above 50%", ohl, "Model reads default within two years"],
      ["Beneish M-score above -2.22", m5, `${negCfo} borrowers with negative operating cash flow`],
    ].map(([l, v, n, cls]) => `<div class="card kpi ${cls || ""}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="note">${n}</div></div>`).join("");
    drawTable();
    // grade distribution
    const grades = M.GRADES.map((g) => g[1]);
    chart("chGrades", { type: "bar", data: { labels: M.GRADES.map((g) => `${g[1]} ${g[2]}`), datasets: [{ data: grades.map((g) => cnt((c) => c.g === g)), backgroundColor: grades.map((g) => COLORS[g]), borderRadius: 5, maxBarThickness: 60 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: gridX, y: { ...gridY, ticks: { precision: 0 } } },
        onClick: (_e, el) => { if (el.length) { $("#fGrade").value = grades[el[0].index]; S.page = 0; drawTable(); $("#pfTable").scrollIntoView({ behavior: "smooth", block: "center" }); } } } });
    // distress map
    const pts = L.filter((c) => isNum(c.z) && isNum(c.op));
    chart("chMap", { type: "scatter", data: { datasets: M.GRADES.map((g) => ({ label: g[1], data: pts.filter((c) => c.g === g[1]).map((c) => ({ x: Math.max(-4, Math.min(12, c.z)), y: c.op, c })),
      backgroundColor: COLORS[g[1]] + "cc", pointRadius: 4, pointHoverRadius: 6 })) },
      options: { plugins: { tooltip: { callbacks: { label: (x) => `${x.raw.c.n}: Z ${f(x.raw.c.z)}, P ${fp(x.raw.c.op, 0)}` } }, refLines: { lines: [{ v: 0.5, c: COLORS.r, t: "P = 50%" }] } },
        scales: { x: { ...gridY, reverse: true, title: { display: true, text: "Altman Z (lower = weaker, axis reversed)" } }, y: { ...gridY, min: 0, max: 1, ticks: { callback: (v) => fp(v, 0) }, title: { display: true, text: "Ohlson probability" } } },
        onClick: (_e, el) => { if (el.length) { const p = S.charts.chMap.data.datasets[el[0].datasetIndex].data[el[0].index]; selectCompany(p.c.t); } } } });
    // industry table
    const byInd = {};
    L.forEach((c) => (byInd[c.ind] = byInd[c.ind] || []).push(c));
    const med = (a) => { a = a.filter(isNum).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
    const rows = Object.entries(byInd).map(([k, a]) => ({ k, n: a.length, sc: med(a.map((c) => c.sc)), de: med(a.map((c) => val(c.de)).filter((x) => isNum(x))), ic: med(a.map((c) => val(c.ic)).filter((x) => x !== Infinity)), cce: med(a.map((c) => c.cce)), g: grades.map((g) => a.filter((c) => c.g === g).length) }))
      .sort((a, b) => b.sc - a.sc);
    $("#indTable").innerHTML = `<thead><tr><th>Industry</th><th class="n">Borrowers</th><th>Median score</th><th class="n">Median D/E</th><th class="n">Median int. cover</th><th class="n">Median CFO/EBITDA</th><th>Grade mix (CW1 to CW5)</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="click" data-ind="${esc(r.k)}"><td><b>${esc(r.k)}</b></td><td class="n">${r.n}</td><td><span class="bar" style="width:110px"><i style="width:${r.sc}%;background:${scoreColor(r.sc)}"></i></span> <span class="num small">${f(r.sc, 0)}</span></td><td class="n">${fx(r.de)}</td><td class="n">${fx(r.ic, 1)}</td><td class="n">${fp(r.cce, 0)}</td>
        <td><div style="display:flex;height:12px;border-radius:3px;overflow:hidden;width:180px">${r.g.map((x, i) => x ? `<i title="${grades[i]}: ${x}" style="flex:${x};background:${COLORS[grades[i]]}"></i>` : "").join("")}</div></td></tr>`).join("") + "</tbody>";
    $$("#indTable tr[data-ind]").forEach((tr) => tr.addEventListener("click", () => { $("#fInd").value = tr.dataset.ind; S.page = 0; drawTable(); $("#pfTable").scrollIntoView({ behavior: "smooth", block: "center" }); }));
  }
  function drawTable() {
    const L = filtered(), pages = Math.max(1, Math.ceil(L.length / PAGE));
    S.page = Math.min(S.page, pages - 1);
    const rows = L.slice(S.page * PAGE, S.page * PAGE + PAGE);
    $("#pfTable").innerHTML = `<thead><tr>${COLS.map(([k, l, , t]) => `<th class="sortable ${t === "n" ? "n" : ""} ${S.sort.key === k ? "sorted" + (S.sort.asc ? " asc" : "") : ""}" data-k="${k}">${l}</th>`).join("")}</tr></thead><tbody>` +
      (rows.length ? rows.map((c) => `<tr class="click ${S.m && S.m.raw.ticker === c.t ? "sel" : ""}" data-t="${c.t}">${COLS.map(([, , fn, t]) => `<td class="${t === "n" ? "n" : ""}">${fn(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${COLS.length}" class="empty">No borrower matches these filters.</td></tr>`) + "</tbody>";
    $("#pfCount").textContent = `${L.length} of ${S.list.length} borrowers`;
    $("#pgInfo").textContent = `Page ${S.page + 1} of ${pages}`;
    $$("#pfTable th.sortable").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; S.sort = { key: k, asc: S.sort.key === k ? !S.sort.asc : ["n", "fy", "ic", "dscr", "cce", "z"].includes(k) }; drawTable(); }));
    $$("#pfTable tr[data-t]").forEach((tr) => tr.addEventListener("click", () => selectCompany(tr.dataset.t)));
  }
  function exportCsv() {
    const L = filtered();
    const head = ["Symbol", "Company", "Industry", "FY", "BQR", "BQR label", "Quantitative grade", "Risk score", "Altman version", "Altman Z", "Altman zone", "Ohlson probability", "D/E", "Interest cover", "DSCR", "CFO/EBITDA", "Sloan ratio", "M-score", "C-score", "F-score", "Red flags (red)", "Red flags (amber)"];
    const rows = L.map((c) => [c.t, c.n, c.ind, c.fy, c.bqr, c.bql, c.g, c.sc, c.zv, c.z, c.zz, c.op, c.de, c.ic, c.dscr, c.cce, c.sl, c.ms, c.cs, c.fs, c.fR, c.fA]);
    download("credit_watch_portfolio.csv", [head, ...rows].map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
  }
  function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

  /* ================= helpers for borrower views ================= */
  const yrsUpTo = () => { const m = S.m, out = []; for (let i = Math.max(1, S.t - 9); i <= S.t; i++) out.push(i); return out; };
  const labels = (ix) => ix.map((i) => S.m.years[i].replace("Mar ", "FY").replace("Dec ", "CY").replace(/(\D+)20(\d\d)/, "$1$2"));
  const series = (ix, fn) => ix.map((i) => { const v = fn(i); return isNum(v) ? v : null; });
  const yLabel = () => `FY ending ${S.m.years[S.t]}`;
  function metricRow(name, value, signal, tip, meaning) {
    return `<tr><td><b>${name}</b> ${tip ? info(tip) : ""}</td><td class="n num">${value}</td><td>${signal ? sig(signal) : ""}</td><td class="muted small">${meaning || ""}</td></tr>`;
  }
  function kpi(label, value, note, s, tip) {
    return `<div class="card kpi"><div class="lbl">${label} ${tip ? info(tip) : ""}</div><div class="val">${value}</div><div class="note">${s ? sig(s) + " " : ""}${note || ""}</div></div>`;
  }

  /* ================= 3. SUMMARY ================= */
  const QUESTIONS = {
    currentRatio: "Current assets do not cover current liabilities with comfort. Ask for the maturity profile of current liabilities and undrawn working-capital lines.",
    ocfRatio: "Operating cash flow covers only a small part of current liabilities. Ask how short-term obligations will be met if receivables are delayed.",
    cce: "EBITDA is not converting into cash. Ask for the receivables ageing and any change in credit terms to customers.",
    tacr: "After realisation haircuts, current assets barely cover current liabilities. Ask for the inventory ageing and the share of overdue receivables.",
    dir: "Defensive assets would fund operating costs for only a short period. Ask about committed bank lines.",
    wcDays: "A large amount of sales is blocked in working capital. Ask what drives the cycle and whether it is lengthening.",
    de: "Leverage is high relative to net worth. Ask for the planned deleveraging path and any equity commitments from promoters.",
    debtEbitda: "Debt is several years of EBITDA. Ask for the repayment schedule against projected cash flow.",
    intCover: "Operating profit only thinly covers interest. Ask about refinancing plans and the sensitivity to a rate increase.",
    dscr: "Cash available for debt service does not comfortably cover interest and principal. Ask for a projected DSCR schedule over the loan tenor.",
    ffoTl: "Funds from operations are small against total liabilities. Ask how the liability burden will be reduced.",
    altman: "The Altman score is outside the safe zone. Ask what is being done to restore working capital and retained earnings.",
    ohlson: "The Ohlson model gives a material probability of distress. Review covenant headroom and existing lender exposure.",
    sloan: "A large part of profit is accruals rather than cash. Ask for the reconciliation of profit to operating cash flow.",
    beneish: "The M-score is above the manipulation cut-off. Commission a closer review of revenue recognition and receivables.",
    cscore: "Several simple accounting red flags appear together. Ask about receivable, inventory and depreciation policy changes.",
    piotroski: "Fundamentals are weakening on several fronts. Ask management to explain the deterioration in margins, liquidity or leverage.",
    aem: "Discretionary accruals are high compared with Indian listed firms. Review provisions, depreciation and revenue recognition notes.",
    benford: "The digit pattern of reported numbers departs from Benford's law. Sample the underlying schedules for a closer check.",
  };
  function analystNote(a) {
    const strengths = [], concerns = [], asks = [];
    const s = a.sig;
    const add = (cond, list, text) => cond && list.push(text);
    add(s.solvency.intCover === "G", strengths, `interest cover of ${fx(a.sol.intCover, 1)}`);
    add(s.solvency.de === "G", strengths, `moderate leverage (D/E ${fx(a.sol.de)})`);
    add(s.liquidity.cce === "G", strengths, `strong cash conversion (CFO/EBITDA ${fp(a.liq.cce, 0)})`);
    add(a.z && a.z.primaryZone === "Safe", strengths, `an Altman ${a.z && a.z.primary === "zPrime" ? "Z'" : "Z''"} in the safe zone (${f(a.z && a.z.primaryValue)})`);
    add(a.p && a.p.F >= 7, strengths, `a Piotroski score of ${a.p && a.p.F}/9`);
    add(s.solvency.dscr === "G", strengths, `DSCR of ${fx(a.sol.dscr)}`);
    const all = { ...s.liquidity, ...s.solvency, ...s.distress, ...s.quality };
    const names = { currentRatio: "current ratio", ocfRatio: "operating cash flow ratio", cce: "cash conversion efficiency", tacr: "time-adjusted current ratio", dir: "defensive interval", wcDays: "working capital days",
      de: "debt to equity", debtEbitda: "debt to EBITDA", intCover: "interest cover", dscr: "DSCR", ffoTl: "FFO to total liabilities", altman: "Altman Z", ohlson: "Ohlson probability", zmijewski: "Zmijewski score",
      springate: "Springate score", fulmer: "Fulmer H", sloan: "Sloan ratio", beneish: "Beneish M-score", cscore: "Montier C-score", piotroski: "Piotroski F-score", aem: "discretionary accruals", benford: "Benford test" };
    Object.entries(all).forEach(([k, v]) => { if (v === "R") { concerns.push(names[k] || k); if (QUESTIONS[k]) asks.push(QUESTIONS[k]); } });
    Object.entries(all).forEach(([k, v]) => { if (v === "A" && QUESTIONS[k] && asks.length < 6) asks.push(QUESTIONS[k]); });
    a.fl.filter((x) => x.status === "R").forEach((x) => concerns.push(x.name.toLowerCase()));
    const actions = {
      CW1: ["Eligible on standard terms", COLORS.CW1, "Annual review is sufficient. Standard financial covenants apply."],
      CW2: ["Eligible with standard covenants", COLORS.CW2, "Annual review with covenants on leverage and interest cover."],
      CW3: ["Lend with tighter structure", COLORS.CW3, "Tighter covenants on DSCR and leverage, adequate security cover and half-yearly monitoring."],
      CW4: ["Enhanced due diligence required", COLORS.CW4, "No fresh exposure until the red signals are explained. If lending, use shorter tenor, full security and quarterly monitoring."],
      CW5: ["Avoid fresh exposure", COLORS.CW5, "Review existing exposure for restructuring or exit. Escalate to the credit committee."],
    };
    const g = S.b ? S.b.grade : null;
    const bAct = !isNum(g) ? null : g <= 4 ? ["Eligible on standard terms", BQR_COL[g - 1], "Annual review. Standard financial covenants on leverage and interest cover."]
      : g <= 6 ? ["Eligible with covenants", BQR_COL[g - 1], "Financial covenants on DSCR and leverage, prior consent for additional borrowing, half-yearly monitoring."]
      : g === 7 ? ["Lend with tighter structure", BQR_COL[g - 1], "Lower leverage limits, security preferred, tighter covenants, shorter tenor and quarterly monitoring."]
      : g === 8 ? ["Secured lending only", BQR_COL[g - 1], "Senior secured or secured facilities within reduced leverage limits, full security cover, quarterly monitoring and credit committee approval."]
      : ["Avoid fresh exposure", BQR_COL[g - 1], "Review existing exposure for restructuring or exit. Escalate to the credit committee."];
    return { strengths, concerns: [...new Set(concerns)], asks: [...new Set(asks)].slice(0, 6), action: bAct || actions[a.grade] || ["Insufficient data", COLORS.grey, "Not enough reported data to grade this borrower."] };
  }
  function renderSummary() {
    const m = S.m, A = m.A, t = S.t, a = S.a, raw = m.raw;
    const note = analystNote(a), lc = M.lifeCycle(m, t), mk = M.market(m);
    const pil = Object.entries(M.PILLARS).map(([k, p]) => { const v = a.pillar[k]; return `<div class="p"><span>${p.label} <span class="muted small">(${p.weight}%)</span></span><div class="track"><i style="width:${v.score ?? 0}%;background:${scoreColor(v.score)}"></i></div><span class="num small">${f(v.score, 0)}</span></div>`; }).join("");
    const span = []; for (let i = Math.max(0, t - 4); i <= t; i++) span.push(i);
    const finRows = [["Revenue", "sales"], ["EBITDA", "ebitda"], ["Profit after tax", "np"], ["Cash from operations", "cfo", 1], ["Free cash flow", "fcf"], ["Borrowings", "borrow", 1], ["Cash and equivalents", "cash"], ["Net worth", "equity", 1]];
    const hist = []; for (let i = Math.max(1, t - 6); i <= t; i++) hist.push([m.years[i], M.assess(m, i).score]);
    $("#sumBody").innerHTML = `
      <div class="card mb"><div class="bhead">
        <div><div class="bname">${esc(raw.nse_name || raw.name)}</div>
          <div class="bmeta"><span class="tag">${esc(raw.ticker)}</span><span>${esc(m.industry)}</span><span>${raw.basis === "consolidated" ? "Consolidated" : raw.basis === "standalone" ? "Standalone" : "Imported"} statements</span><span>${yLabel()}</span>
          ${isNum(mk.mcap) ? `<span>Market cap Rs ${fc(mk.mcap)} cr</span>` : ""}${raw.source && raw.source.startsWith("http") ? `<a href="${raw.source}" target="_blank" rel="noopener">Source statements</a>` : ""}</div>
          ${raw.about ? `<p class="small muted" style="margin:10px 0 0;max-width:900px">${esc(raw.about.replace(/\s*\[\d+\]/g, "").slice(0, 330))}${raw.about.length > 330 ? "..." : ""}</p>` : ""}</div>
        <div class="gradebox">${S.b ? `<div><div class="lbl">Borrower quality rating</div><div class="big" style="color:${BQR_COL[S.b.grade - 1]}">BQR ${S.b.grade}</div><div class="small" style="font-weight:600">${S.b.label}</div></div>
          <div style="border-left:1px solid var(--line);padding-left:16px"><div class="lbl">Quantitative grade (60%)</div><div style="font-weight:700;font-size:16px">${gradeChip(a.grade)} ${a.gradeLabel}</div><div class="small muted">Qualitative score ${f(S.b.qualScore, 0)} / 100 (40%)</div>
          <div class="small"><a href="#" data-goto="bqr">Review the rating</a></div></div>` : `<div><div class="lbl">Credit watch grade</div><div class="big">${a.grade}</div></div>`}</div>
      </div></div>
      <div class="grid g3 mb">
        <div class="card"><h3>Where the risk comes from</h3><div class="sub">Pillar risk scores, 0 = no concern, 100 = all signals red</div><div class="pillars">${pil}</div>
          <div class="chart-box short" style="margin-top:12px"><canvas id="chHist"></canvas></div></div>
        <div class="card span2"><h3>Analyst note</h3><div class="sub">Generated from the signals on tabs 4 to 8 for ${yLabel()}</div>
          <div class="note-box"><span class="rec" style="background:${note.action[1]}1f;color:${note.action[1]}">${note.action[0]}</span>
            <p>${note.strengths.length ? `<b>Supports the credit:</b> ${note.strengths.join("; ")}.` : "<b>Supports the credit:</b> no signal is clearly in the comfortable range."}</p>
            <p>${note.concerns.length ? `<b>Main concerns:</b> ${note.concerns.join("; ")}.` : "<b>Main concerns:</b> none of the measured signals is red."}</p>
            <p><b>Suggested structure:</b> ${note.action[2]}</p></div>
          ${note.asks.length ? `<h4 style="margin:14px 0 6px;font-size:13.5px">Questions for management</h4><ol class="list-tight small">${note.asks.map((q) => `<li>${q}</li>`).join("")}</ol>` : ""}
        </div>
      </div>
      <div class="grid g4 mb">
        ${kpi("Cash flow life cycle", lc ? lc.stage : "n/a", lc ? lc.pattern : "", null, "Stage read from the signs of operating, investing and financing cash flow (Dickinson classification).")}
        ${kpi("Debt structuring fit", a.sol.matrix || "n/a", a.sol.matrix ? `${a.sol.assetRich ? "Asset rich" : "Asset poor"}, ${a.sol.cashRich ? "cash rich" : "cash poor"}` : "", null, "Asset rich: fixed assets and CWIP at least 35% of total assets. Cash rich: CFO at least 25% of borrowings.")}
        ${kpi("DSCR", fx(a.sol.dscr), "CFADS / (interest + principal)", a.sol.signals.dscr, "CFADS = CFO less maintenance capex. Principal = long-term borrowings spread over the assumed tenor (tab 5).")}
        ${kpi("Altman " + (a.z ? (a.z.primary === "zPrime" ? "Z'" : "Z''") : "Z"), a.z ? f(a.z.primaryValue) : "n/a", a.z ? a.z.primaryZone + " zone" : "", a.sig.distress.altman)}
      </div>
      <div class="grid g2">
        <div class="card"><h3>Key figures</h3><div class="sub">Rs crore</div><div class="tbl-wrap"><table class="fin"><thead><tr><th></th>${span.map((i) => `<th class="n">${m.years[i]}</th>`).join("")}</tr></thead><tbody>
          ${finRows.map(([l, k, strong]) => `<tr class="${strong ? "strong" : ""}"><td>${l}</td>${span.map((i) => `<td class="n">${fc(A[k][i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
        <div class="card"><h3>Profit against cash</h3><div class="sub">If profit rises while operating cash flow does not follow, the gap must be explained before lending.</div><div class="chart-box"><canvas id="chProfitCash"></canvas></div></div>
      </div>`;
    $$("#sumBody [data-goto]").forEach((x) => x.addEventListener("click", (e) => { e.preventDefault(); go(x.dataset.goto); }));
    chart("chHist", lineCfg(hist.map((h) => h[0].replace("Mar ", "FY")), [{ label: "Risk score", data: hist.map((h) => h[1]), color: COLORS.navy, fill: false }], (v) => f(v, 0), { y: { min: 0, max: 100 } }));
    const ix = yrsUpTo();
    chart("chProfitCash", { type: "bar", data: { labels: labels(ix), datasets: [
      { type: "line", label: "Profit after tax", data: series(ix, (i) => A.np[i]), borderColor: COLORS.gold, backgroundColor: COLORS.gold, tension: 0.25, borderWidth: 2.5, pointRadius: 2.5 },
      { label: "Cash from operations", data: series(ix, (i) => A.cfo[i]), backgroundColor: COLORS.teal + "cc", borderRadius: 3 },
      { label: "EBITDA", data: series(ix, (i) => A.ebitda[i]), backgroundColor: COLORS.light, borderRadius: 3 }] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: gridX, y: { ...gridY, ticks: { callback: (v) => fc(v) } } } } });
  }

  /* ================= 4. LIQUIDITY ================= */
  function renderLiquidity() {
    const m = S.m, A = m.A, t = S.t, L = S.a.liq, sg = L.signals;
    $("#liqBody").innerHTML = `
      <div class="grid g4 mb">
        ${kpi("Current ratio", fx(L.currentRatio), "Current assets / current liabilities", sg.currentRatio)}
        ${kpi("Cash conversion efficiency", fp(L.cce, 0), M.cceLabel(L.cce), sg.cce, "CFO / EBITDA. Above 100% outstanding, 80-100% strong, 60-80% acceptable, 40-60% weak, below 40% major concern.")}
        ${kpi("Operating cash flow ratio", fx(L.ocfRatio), "CFO / current liabilities", sg.ocfRatio)}
        ${kpi("Defensive interval", fd(L.dir), "Days of cash costs covered without new revenue", sg.dir, "(Cash + receivables) / (annual cash operating expenses / 365).")}
      </div>
      <div class="grid g32 mb">
        <div class="card"><h3>Liquidity signal table</h3><div class="sub">${yLabel()}. Read from top to bottom: each measure is stricter than the one above it.</div>
          <div class="tbl-wrap"><table><thead><tr><th>Metric</th><th class="n">Value</th><th>Signal</th><th>Question it answers</th></tr></thead><tbody>
          ${metricRow("Current ratio", fx(L.currentRatio), sg.currentRatio, "Current assets / current liabilities. Green at 1.5 or above, red below 1.0.", "Does liquidity appear adequate?")}
          ${metricRow("Quick ratio", fx(L.quickRatio), sg.quickRatio, "(Current assets less inventory) / current liabilities.", "Is liquidity adequate without selling stock?")}
          ${metricRow("Cash ratio", fx(L.cashRatio), null, "Cash and equivalents / current liabilities. The most conservative test.", "Can obligations be met from cash alone?")}
          ${metricRow("Net working capital", "Rs " + fc(L.nwc) + " cr", null, "Current assets less current liabilities.", "What is the absolute liquidity buffer?")}
          ${metricRow("Working capital days", fd(L.wcDays), sg.wcDays, "Net working capital / sales x 365. Green below 45 days, red above 120.", "How many days of sales are blocked?")}
          ${metricRow("Cash conversion cycle", fd(L.ccc), null, "Debtor days + inventory days less payable days.", "How fast does cash come back?")}
          ${metricRow("Operating cash flow ratio", fx(L.ocfRatio), sg.ocfRatio, "CFO / current liabilities. Green at 0.4 or above, red below 0.2.", "Is the business generating cash?")}
          ${metricRow("Cash conversion efficiency", fp(L.cce, 0), sg.cce, "CFO / EBITDA.", "Is EBITDA converting into cash?")}
          ${metricRow("Time-adjusted current ratio", fx(L.tacr), sg.tacr, "Current assets weighted by how much of each is realisable in time, divided by current liabilities. Weights set with the sliders.", "How much liquidity remains after conversion delays?")}
          ${metricRow("Defensive interval ratio", fd(L.dir), sg.dir, "Green at 180 days or more, red below 90.", "How long can the company survive without new revenue?")}
          ${L.burn ? metricRow("Cash burn (monthly)", "Rs " + fc(L.burn) + " cr", "R", "Negative CFO / 12.", "How much cash is lost each month?") + metricRow("Cash runway", f(L.runway, 1) + " months", L.runway < 12 ? "R" : "A", "Cash / monthly burn.", "How long until cash runs out?") : ""}
          </tbody></table></div></div>
        <div class="card"><h3>Time-adjusted current ratio</h3><div class="sub">Share of each current asset that can be realised in time. Defaults: cash 100%, receivables 80%, inventory 40%, other current assets 50%.</div>
          ${[["cash", "Cash"], ["rec", "Receivables"], ["inv", "Inventory"], ["other", "Other current assets"]].map(([k, l]) => `<div class="field"><label>${l} <b id="tw_${k}">${S.tacr[k]}%</b></label><input type="range" min="0" max="100" step="5" value="${S.tacr[k]}" data-tacr="${k}"></div>`).join("")}
          <div class="grid g2"><div class="kpi" style="padding:0"><div class="lbl">Traditional current ratio</div><div class="val">${fx(L.currentRatio)}</div></div>
          <div class="kpi" style="padding:0"><div class="lbl">Time-adjusted</div><div class="val" id="tacrVal">${fx(L.tacr)}</div><div class="note" id="tacrSig">${sig(sg.tacr)}</div></div></div>
          <p class="small muted">Use lower receivable weights for EPC, infrastructure and government-facing businesses, where collections are slow, and lower inventory weights for slow-moving stock.</p>
        </div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Liquidity ratios over time</h3><div class="sub">Current, quick and operating cash flow ratios</div><div class="chart-box"><canvas id="chLiq"></canvas></div></div>
        <div class="card"><h3>Working capital cycle</h3><div class="sub">Debtor days, inventory days and working capital days</div><div class="chart-box"><canvas id="chWc"></canvas></div></div>
      </div>`;
    $$("[data-tacr]").forEach((r) => r.addEventListener("input", () => {
      S.tacr[r.dataset.tacr] = +r.value; $("#tw_" + r.dataset.tacr).textContent = r.value + "%";
      const l = M.liquidity(S.m, S.t, S.tacr); $("#tacrVal").textContent = fx(l.tacr); $("#tacrSig").innerHTML = sig(l.signals.tacr);
    }));
    const ix = yrsUpTo();
    const liqs = ix.map((i) => M.liquidity(m, i, S.tacr));
    chart("chLiq", lineCfg(labels(ix), [{ label: "Current ratio", data: liqs.map((l) => l.currentRatio) }, { label: "Quick ratio", data: liqs.map((l) => l.quickRatio) }, { label: "OCF ratio", data: liqs.map((l) => l.ocfRatio) }],
      (v) => fx(v), { plugins: { refLines: { lines: [{ v: 1, c: COLORS.r, t: "1.0x" }] } } }));
    chart("chWc", lineCfg(labels(ix), [{ label: "Debtor days", data: series(ix, (i) => A.debtorDays[i]) }, { label: "Inventory days", data: series(ix, (i) => A.invDays[i]) }, { label: "Working capital days", data: liqs.map((l) => l.wcDays) }], (v) => f(v, 0)));
  }

  /* ================= 5. SOLVENCY ================= */
  function renderSolvency() {
    const m = S.m, A = m.A, t = S.t, s = S.a.sol, sg = s.signals;
    $("#solBody").innerHTML = `
      <div class="grid g5 mb">
        ${kpi("Debt / equity", s.deNote ? "n/a" : fx(s.de), s.deNote || "Borrowings / net worth", sg.de)}
        ${kpi("Debt / EBITDA", s.debtEbitdaNote ? "n/a" : fx(s.debtEbitda, 1), s.debtEbitdaNote || `Net debt / EBITDA ${fx(s.netDebtEbitda, 1)}`, sg.debtEbitda)}
        ${kpi("Interest cover", fx(s.intCover, 1), "EBIT / interest", sg.intCover)}
        ${kpi("DSCR", fx(s.dscr), `CFADS Rs ${fc(s.cfads)} cr`, sg.dscr, "CFADS / (interest + principal). Principal = long-term borrowings / tenor set below. Green at 1.5 or above, red below 1.2.")}
        ${kpi("FFO / total liabilities", fp(s.ffoTl, 0), "(PAT + depreciation - exceptional items) / TL", sg.ffoTl, "Funds from operations relative to the liability burden. Higher means lower distress.")}
      </div>
      <div class="grid g3 mb">
        <div class="card"><h3>Debt capacity calculator</h3><div class="sub">Sizes the loan the borrower's cash flow can carry, with repayments sculpted to cash flow.</div>
          ${[["dscr", "Target DSCR", 1, 3, 0.05, "x"], ["rate", "Interest rate", 6, 16, 0.25, "%"], ["tenor", "Tenor", 3, 25, 1, " yrs"], ["growth", "CFADS growth per year", -10, 15, 1, "%"], ["maintPct", "Maintenance capex (% of depreciation)", 0, 150, 10, "%"]]
            .map(([k, l, mn, mx, st, u]) => `<div class="field"><label>${l} <b id="dv_${k}">${S.debt[k]}${u}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${S.debt[k]}" data-debt="${k}" data-u="${u}"></div>`).join("")}
          <p class="small muted">Base CFADS = operating cash flow less maintenance capex for ${yLabel()}.</p></div>
        <div class="card span2"><div class="card-head"><div><h3>Sculpted repayment profile</h3><div class="sub">Debt service each year = CFADS / target DSCR. Interest falls as the balance amortises.</div></div></div>
          <div class="grid g4 mb" id="dcKpis"></div><div class="chart-box"><canvas id="chDebt"></canvas></div></div>
      </div>
      <div class="grid g3 mb">
        <div class="card"><h3>Debt structuring matrix</h3><div class="sub">Approach that fits the borrower's asset and cash strength</div>
          <div class="matrix"><div></div><div class="hd">Asset rich</div><div class="hd">Asset poor</div>
            <div class="hd">Cash rich</div><div class="cell ${s.matrix === "Debt sculpting" ? "on" : ""}"><b>Debt sculpting</b>Match repayments to the cash flow pattern.</div><div class="cell ${s.matrix === "Debt avalanche" ? "on" : ""}"><b>Debt avalanche</b>Use cash strength to retire the costliest debt first.</div>
            <div class="hd">Cash poor</div><div class="cell ${s.matrix === "Debt sizing" ? "on" : ""}"><b>Debt sizing</b>Size debt conservatively to hold coverage.</div><div class="cell ${s.matrix === "Debt snowball" ? "on" : ""}"><b>Debt snowball</b>Small steps; clear smaller loans first.</div></div>
          <p class="small muted">Fixed assets and CWIP = ${fp(s.tangibleShare, 0)} of total assets; CFO / borrowings = ${s.cfoToDebt === Infinity ? "no debt" : fp(s.cfoToDebt, 0)}.</p></div>
        <div class="card"><h3>Trading on equity</h3><div class="sub">Borrowing helps shareholders only while assets earn more than the debt costs.</div>
          <table><tbody>${metricRow("Return on assets (EBIT / avg TA)", fp(s.roaEbit), null)}${metricRow("Cost of debt (interest / avg debt)", fp(s.costDebt))}
          ${metricRow("Spread", fp(s.leverageSpread), isNum(s.leverageSpread) ? (s.leverageSpread > 0.02 ? "G" : s.leverageSpread > 0 ? "A" : "R") : null)}</tbody></table>
          <p class="small muted">${isNum(s.leverageSpread) ? (s.leverageSpread > 0 ? "Leverage is favourable: each rupee of debt earns more than it costs." : "Leverage is unfavourable: debt costs more than the assets earn, so more borrowing would reduce returns and coverage.") : ""}</p></div>
        <div class="card"><h3>Growth the borrower can fund</h3><div class="sub">Growth above these rates needs new external finance.</div>
          <table><tbody>${metricRow("Internal growth rate", fp(s.igr), null, "ROA x (1 - dividend payout). Growth possible without any new debt.")}
          ${metricRow("Sustainable growth rate", fp(s.sgr), null, "ROE x (1 - dividend payout). Growth possible keeping the debt-equity mix constant.")}
          ${metricRow("Actual sales growth", fp(s.salesGrowth), isNum(s.salesGrowth) && isNum(s.sgr) ? (s.salesGrowth > s.sgr + 0.05 ? "A" : "G") : null)}
          ${metricRow("Retention ratio", fp(s.retention, 0))}</tbody></table>
          <p class="small muted">${isNum(s.salesGrowth) && isNum(s.sgr) && s.salesGrowth > s.sgr ? "Sales grew faster than the sustainable rate, so the gap was funded by new debt or equity." : "Growth is within what retained earnings and the current capital mix can fund."}</p></div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Leverage over time</h3><div class="sub">Debt to equity and debt to EBITDA</div><div class="chart-box"><canvas id="chLev"></canvas></div></div>
        <div class="card"><h3>Coverage over time</h3><div class="sub">Interest cover and DSCR</div><div class="chart-box"><canvas id="chCov"></canvas></div></div>
      </div>`;
    $$("[data-debt]").forEach((r) => r.addEventListener("input", () => { S.debt[r.dataset.debt] = +r.value; $("#dv_" + r.dataset.debt).textContent = r.value + r.dataset.u; drawDebt(); }));
    drawDebt();
    const ix = yrsUpTo(), sv = ix.map((i) => M.solvency(m, i, S.debt));
    const cap = (v, c) => (v === Infinity ? null : isNum(v) ? Math.min(v, c) : null);
    chart("chLev", lineCfg(labels(ix), [{ label: "Debt / equity", data: sv.map((x) => cap(x.de, 10)) }, { label: "Debt / EBITDA", data: sv.map((x) => cap(x.debtEbitda, 15)) }], (v) => fx(v, 1)));
    chart("chCov", lineCfg(labels(ix), [{ label: "Interest cover", data: sv.map((x) => cap(x.intCover, 30)) }, { label: "DSCR", data: sv.map((x) => cap(x.dscr, 30)) }], (v) => fx(v, 1),
      { plugins: { refLines: { lines: [{ v: 1.5, c: COLORS.a, t: "1.5x" }, { v: 1, c: COLORS.r, t: "1.0x" }] } } }));
  }
  function drawDebt() {
    const d = M.debtCapacity(S.m, S.t, S.debt);
    if (!(d.base > 0)) {
      $("#dcKpis").innerHTML = `<div style="grid-column:1/-1">${sig("R", "No debt capacity")} <span class="small">Base CFADS for ${yLabel()} is Rs ${fc(d.base)} cr (operating cash flow less maintenance capex). Cash flow in this year cannot support any debt service, so existing borrowings of Rs ${fc(d.existing)} cr depend on refinancing or asset sales. Try a lower maintenance capex share, or select an earlier year in the top bar.</span></div>`;
      if (S.charts.chDebt) { S.charts.chDebt.destroy(); delete S.charts.chDebt; }
      return;
    }
    $("#dcKpis").innerHTML = [
      ["Maximum debt", "Rs " + fc(d.maxDebt) + " cr", "PV of debt service at the target DSCR"],
      ["Existing borrowings", "Rs " + fc(d.existing) + " cr", yLabel()],
      ["Headroom", (d.headroom >= 0 ? "Rs " : "-Rs ") + fc(Math.abs(d.headroom)) + " cr", d.headroom >= 0 ? "Additional debt the cash flow supports" : "Existing debt exceeds capacity"],
      ["LLCR", d.llcr ? fx(d.llcr) : "No debt", "PV of CFADS over tenor / existing debt"],
    ].map(([l, v, n], i) => `<div><div class="lbl small muted" style="text-transform:uppercase;letter-spacing:.05em">${l}</div><div style="font-size:19px;font-weight:700;color:${i === 2 ? (d.headroom >= 0 ? COLORS.g : COLORS.r) : i === 3 && d.llcr ? (d.llcr >= 1.3 ? COLORS.g : d.llcr >= 1 ? COLORS.a : COLORS.r) : "inherit"}">${v}</div><div class="small muted">${n}</div></div>`).join("");
    chart("chDebt", { type: "bar", data: { labels: d.rows.map((r) => "Year " + r.y), datasets: [
      { label: "Interest", data: d.rows.map((r) => r.interest), backgroundColor: COLORS.gold, stack: "s", borderRadius: 2 },
      { label: "Principal", data: d.rows.map((r) => r.principal), backgroundColor: COLORS.navy, stack: "s", borderRadius: 2 },
      { type: "line", label: "CFADS", data: d.rows.map((r) => r.cfads), borderColor: COLORS.teal, backgroundColor: COLORS.teal, borderWidth: 2, pointRadius: 2 },
      { type: "line", label: "Closing balance", data: d.rows.map((r) => r.close), borderColor: COLORS.grey, borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, yAxisID: "y2" }] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: Rs ${fc(c.parsed.y)} cr` } } },
        scales: { x: { ...gridX, stacked: true }, y: { ...gridY, stacked: true, ticks: { callback: (v) => fc(v) } }, y2: { position: "right", grid: { display: false }, ticks: { callback: (v) => fc(v) }, title: { display: true, text: "Balance" } } } } });
  }

  /* ================= 6. DISTRESS ================= */
  function renderDistress() {
    const m = S.m, t = S.t, a = S.a, z = a.z, o = a.o, zm = a.zm, sp = a.sp, fu = a.fu, kz = M.kzIndex(m, m.n - 1);
    const zSig = a.sig.distress.altman;
    const agree = Object.values(a.sig.distress).filter((x) => x === "R").length, nAv = Object.values(a.sig.distress).filter((x) => x !== "NA").length;
    const zrow = (name, v, zone, cut, on) => `<tr ${on ? 'style="background:#f2f9f9"' : ""}><td><b>${name}</b>${on ? ' <span class="tag">Primary</span>' : ""}</td><td class="n num">${f(v)}</td><td><span class="zone ${zone || ""}">${zone || "n/a"}</span></td><td class="small muted">${cut}</td></tr>`;
    $("#disBody").innerHTML = `
      <div class="card mb"><div class="card-head"><div><h3>Model agreement</h3><div class="sub">${yLabel()}. ${agree} of ${nAv} models signal distress.</div></div>
        <div style="font-size:26px;font-weight:800;color:${agree >= 3 ? COLORS.r : agree >= 1 ? COLORS.a : COLORS.g}">${agree} / ${nAv}</div></div>
        <div class="grid g5">${[["Altman Z", zSig, z ? f(z.primaryValue) : "n/a"], ["Ohlson O", o ? o.signal : "NA", o ? fp(o.p, 1) : "n/a"], ["Zmijewski", zm ? zm.signal : "NA", zm ? f(zm.X) : "n/a"], ["Springate", sp ? sp.signal : "NA", sp ? f(sp.S) : "n/a"], ["Fulmer H", fu && isNum(fu.H) ? fu.signal : "NA", fu && isNum(fu.H) ? f(fu.H) : "n/a"]]
          .map(([l, s, v]) => `<div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px"><div class="small muted">${l}</div><div style="font-size:19px;font-weight:700">${v}</div>${sig(s)}</div>`).join("")}</div></div>
      <div class="grid g2 mb">
        <div class="card"><h3>Altman Z-score family</h3><div class="sub">${m.manufacturing ? "Manufacturer: Z' (book equity, five variables) is the primary version." : "Non-manufacturer: Z'' (four variables, no asset turnover) is the primary version."}</div>
          <table><thead><tr><th>Version</th><th class="n">Score</th><th>Zone</th><th>Cut-offs (safe / distress)</th></tr></thead><tbody>
          ${z ? zrow("Z (listed, market value of equity)", z.zListed, z.zoneListed, "2.99 / 1.81; latest year only", false) + zrow("Z' (book value of equity)", z.zPrime, z.zonePrime, "2.90 / 1.23", z.primary === "zPrime") + zrow("Z'' (non-manufacturing / emerging market)", z.zDouble, z.zoneDouble, "2.60 / 1.10", z.primary === "zDouble") : '<tr><td colspan="4" class="empty">Not enough data</td></tr>'}</tbody></table>
          ${z ? `<table style="margin-top:10px"><tbody>${metricRow("X1 Working capital / TA", f(z.X1, 3))}${metricRow("X2 Retained earnings / TA", f(z.X2, 3), null, "Reserves are used for retained earnings.")}${metricRow("X3 EBIT / TA", f(z.X3, 3))}${metricRow("X4 Book equity / total liabilities", f(z.X4b, 3))}${metricRow("X5 Sales / TA", f(z.X5, 3))}</tbody></table>` : ""}</div>
        <div class="card"><h3>Ohlson O-score</h3><div class="sub">${o ? `O = ${f(o.T)}; probability of distress = e^O / (1 + e^O) = <b>${fp(o.p, 1)}</b>. Above 50% suggests default within two years.` : "Needs two years of data."}</div>
          <div class="chart-box tall"><canvas id="chOhlson"></canvas></div></div>
      </div>
      <div class="grid g3 mb">
        <div class="card"><h3>Zmijewski score</h3><div class="sub">-4.336 - 4.513 NI/TA + 5.679 TL/TA + 0.004 CA/CL</div>
          <div style="font-size:26px;font-weight:700">${zm ? f(zm.X) : "n/a"} ${zm ? sig(zm.signal) : ""}</div><p class="small muted">Higher means greater distress risk; values above zero are read as distressed.</p></div>
        <div class="card"><h3>Springate score</h3><div class="sub">1.03 WC/TA + 3.07 EBIT/TA + 0.66 PBT/CL + 0.4 Sales/TA</div>
          <div style="font-size:26px;font-weight:700">${sp ? f(sp.S) : "n/a"} ${sp ? sig(sp.signal) : ""}</div><p class="small muted">Below 0.862 indicates potential financial stress.</p></div>
        <div class="card"><h3>Fulmer H-factor</h3><div class="sub">Nine-variable model covering profitability, cash flow, leverage, liquidity and debt service</div>
          <div style="font-size:26px;font-weight:700">${fu && isNum(fu.H) ? f(fu.H) : "n/a"} ${fu && isNum(fu.H) ? sig(fu.signal) : ""}</div><p class="small muted">${fu && fu.note ? fu.note + "." : "Below zero is a distress warning; above zero is stable."}</p></div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Distress scores over time</h3><div class="sub">Primary Altman version and Ohlson probability</div><div class="chart-box"><canvas id="chDis"></canvas></div></div>
        <div class="card"><h3>Kaplan-Zingales index</h3><div class="sub">Dependence on external finance, latest year (needs market value). Higher = more financially constrained.</div>
          ${kz ? `<div style="font-size:26px;font-weight:700">${f(kz.KZ)}</div><table style="margin-top:8px"><tbody>${metricRow("Cash flow / K", f(kz.cfK, 3), null, "K = net fixed assets of the previous year; cash flow = PAT + depreciation")}${metricRow("Q (market cap / net worth)", f(kz.Q))}${metricRow("Debt / total capital", f(kz.debtCap, 3))}${metricRow("Dividends / K", f(kz.divK, 3))}${metricRow("Cash / K", f(kz.cashK, 3))}</tbody></table>
          <p class="small muted">${kzPeer(kz.KZ)}</p>` : '<div class="empty">Not available</div>'}</div>
      </div>`;
    if (o) {
      const parts = Object.entries(o.parts);
      chart("chOhlson", { type: "bar", data: { labels: parts.map((p) => p[0]), datasets: [{ data: parts.map((p) => p[1]), backgroundColor: parts.map((p) => (p[1] > 0 ? COLORS.r + "cc" : COLORS.g + "cc")), borderRadius: 3 }] },
        options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "Contribution " + f(c.parsed.x, 3) } } }, scales: { x: { ...gridY, title: { display: true, text: "Contribution to O-score (positive raises distress)" } }, y: { grid: { display: false } } } } });
    }
    const ix = yrsUpTo();
    const zs = ix.map((i) => M.altman(m, i)), os = ix.map((i) => M.ohlson(m, i));
    chart("chDis", { type: "line", data: { labels: labels(ix), datasets: [
      { label: z && z.primary === "zPrime" ? "Altman Z'" : "Altman Z''", data: zs.map((x) => (x ? x.primaryValue : null)), borderColor: COLORS.navy, backgroundColor: COLORS.navy, tension: 0.25, borderWidth: 2, spanGaps: true },
      { label: "Ohlson probability", data: os.map((x) => (x ? x.p : null)), borderColor: COLORS.r, backgroundColor: COLORS.r, tension: 0.25, borderWidth: 2, yAxisID: "y2", spanGaps: true }] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { refLines: { lines: z ? (z.primary === "zPrime" ? [{ v: 2.9, c: COLORS.g, t: "Safe 2.90" }, { v: 1.23, c: COLORS.r, t: "Distress 1.23" }] : [{ v: 2.6, c: COLORS.g, t: "Safe 2.60" }, { v: 1.1, c: COLORS.r, t: "Distress 1.10" }]) : [] } },
        scales: { x: gridX, y: { ...gridY, suggestedMin: 0, suggestedMax: z && z.primary === "zPrime" ? 3.2 : 3, title: { display: true, text: "Altman" } }, y2: { position: "right", min: 0, max: 1, grid: { display: false }, ticks: { callback: (v) => fp(v, 0) }, title: { display: true, text: "Ohlson P" } } } } });
  }
  function kzPeer(v) {
    const peers = S.list.filter((c) => c.ind === S.m.industry && isNum(c.kz)).map((c) => c.kz);
    if (peers.length < 5) return "The index has no fixed cut-off; it is most useful for ranking borrowers within an industry.";
    const pct = peers.filter((x) => x <= v).length / peers.length;
    return `More constrained than ${Math.round(pct * 100)}% of the ${peers.length} ${S.m.industry} borrowers. The index has no fixed cut-off, so it is read against peers.`;
  }

  /* ================= 7. QUALITY ================= */
  function renderQuality() {
    const m = S.m, A = m.A, t = S.t, a = S.a, acc = a.acc, b = a.b, c = a.c, p = a.p, ae = a.ae, rm = M.rem(m, t), bf = a.bf, pr = M.profitability(m, t), mk = M.market(m), dw = M.durbinWatson(m, t);
    const csm = S.U && S.U.csModel, cs = M.classShift(m, t, csm);
    const uePct = cs ? S.list.filter((x) => isNum(x.ue) && x.ue < cs.ue).length / Math.max(1, S.list.filter((x) => isNum(x.ue)).length) : null;
    const BEN = { DSRI: "Days sales in receivables index", GMI: "Gross margin index", AQI: "Asset quality index", SGI: "Sales growth index", DEPI: "Depreciation index", SGAI: "SG&A expense index", LVGI: "Leverage index", TATA: "Total accruals to total assets" };
    $("#qBody").innerHTML = `
      <div class="grid g4 mb">
        ${kpi("Sloan ratio", fp(acc.sloan), acc.sloanBand, acc.signal, "(Net income - CFO) / average total assets. 0-5% low risk, 5-10% moderate, 10-20% high, above 20% very high.")}
        ${kpi("Beneish M-score", b ? f(b.M) : "n/a", b ? (b.M > -2.22 ? "Above -2.22: likely manipulator" : "Below -2.22: unlikely manipulator") : "", b ? b.signal : "NA")}
        ${kpi("Montier C-score", c ? c.C + " / " + c.available : "n/a", "Simple accounting red flags present", c ? c.signal : "NA")}
        ${kpi("Piotroski F-score", p ? p.F + " / " + p.available : "n/a", "Higher = financially stronger", p ? p.signal : "NA")}
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Accrual measures</h3><div class="sub">How much of profit is not backed by cash</div>
          <table><thead><tr><th>Measure</th><th class="n">Value</th><th>Signal</th><th>Question it answers</th></tr></thead><tbody>
          ${metricRow("Sloan ratio (TATA)", fp(acc.sloan), acc.signal, "(NI - CFO) / average total assets", "How much of earnings is non-cash?")}
          ${metricRow("Balance sheet accrual ratio", fp(acc.bsAcc), null, "Change in net operating assets / average NOA. NOA = (total assets - cash - investments) - (other liabilities excluding minority interest).", "Where did the profits go?")}
          ${metricRow("Cash flow accrual ratio", fp(acc.cfAcc), null, "[NI - (CFO + CFI)] / average NOA", "Why did the profits not become cash?")}
          ${metricRow("CFO / PAT", fx(acc.cfoNp), null, "", "Is each rupee of profit collected?")}
          ${metricRow("Discretionary accruals (modified Jones)", ae ? fp(ae.da) : "n/a", ae ? ae.signal : null, "Total accruals less the normal level predicted for Indian listed firms of similar revenue change and fixed assets. Positive values raise reported profit.", "Is management using accounting discretion to raise profit?")}
          </tbody></table></div>
        <div class="card"><h3>Accruals over time</h3><div class="sub">Sloan ratio with the risk bands, and discretionary accruals</div><div class="chart-box"><canvas id="chAcc"></canvas></div></div>
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Beneish M-score components</h3><div class="sub">${b ? `M = ${f(b.M)}. ${b.neutral.length ? `Neutral value used where an input is not reported: ${b.neutral.join(", ")}.` : "All eight inputs available."}` : "Needs two years of data."}</div>
          ${b ? `<table><thead><tr><th>Index</th><th class="n">Value</th><th class="n">Weight</th><th class="n">Contribution</th></tr></thead><tbody>${Object.keys(b.W).map((k) => `<tr><td><b>${k}</b> <span class="muted small">${BEN[k]}</span></td><td class="n num">${f(b.raw[k], 3)}</td><td class="n num">${b.W[k]}</td><td class="n num">${f(b.W[k] * b.used[k], 3)}</td></tr>`).join("")}<tr><td><b>Constant</b></td><td></td><td></td><td class="n num">-4.840</td></tr></tbody></table>` : ""}</div>
        <div class="card"><h3>M-score trend</h3><div class="sub">Above the -2.22 line the company resembles known manipulators</div><div class="chart-box"><canvas id="chM"></canvas></div></div>
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Montier C-score tests</h3><div class="sub">One point for each warning sign present</div>
          ${c ? `<table><tbody>${c.tests.map((x) => `<tr><td>${x.name}</td><td>${x.flag === null ? sig("NA") : x.flag ? sig("R", "Present") : sig("G", "Absent")}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Not available</div>'}</div>
        <div class="card"><h3>Piotroski F-score tests</h3><div class="sub">One point for each test passed</div>
          ${p ? `<table><tbody>${p.tests.map((x) => `<tr><td>${x.name}</td><td>${x.pass === null ? sig("NA") : x.pass ? sig("G", "Pass") : sig("R", "Fail")}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Not available</div>'}</div>
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Benford's law: first-digit test</h3><div class="sub">${bf ? `${bf.N} reported amounts. KS statistic ${f(bf.KS, 4)} against a cut-off of 1.36 / &radic;N = ${f(bf.cutoff, 4)}. ${bf.KS > bf.cutoff ? "Above the cut-off: the digit pattern departs from Benford's law." : "Within the cut-off: the digit pattern conforms."}` : "Not enough reported numbers."}</div><div class="chart-box"><canvas id="chBen"></canvas></div></div>
        <div class="card"><h3>Real earnings management</h3><div class="sub">Abnormal levels against the cross-section of Indian listed firms. Income-increasing REM shows as low CFO, high production cost and low discretionary spending.</div>
          ${rm ? `<table><tbody>${metricRow("Abnormal CFO", f(rm.abCfo, 3), null, "Actual CFO / lagged assets less the level expected for the firm's sales and sales change. Negative = possible sales push through discounts or easy credit.")}
          ${metricRow("Abnormal production cost", isNum(rm.abProd) ? f(rm.abProd, 3) : "n/a", null, "Positive = possible overproduction to spread fixed cost and lower cost of goods sold.")}
          ${metricRow("Abnormal discretionary expense", isNum(rm.abDisx) ? f(rm.abDisx, 3) : "n/a (selling cost not reported)", null, "Negative = possible cuts to selling or R&D spending to lift profit.")}
          ${metricRow("Aggregate REM", f(rm.aggregate, 3), null, "-Ab_CFO + Ab_PROD - Ab_DISX, using the components available. Higher = more income-increasing real activity management.")}</tbody></table>
          <p class="small muted">Computed from ${rm.components} of 3 components.</p>` : '<div class="empty">Needs three years of data</div>'}
        </div>
      </div>
      <div class="card mb"><h3>Classification shifting: operating revenue</h3><div class="sub">Is non-operating income being reported as revenue? Revenue is compared with the level expected from last year's revenue, market-to-book and receivables, estimated on the latest-year cross-section of the coverage universe.</div>
        ${cs ? `<div class="grid g2"><table><tbody>
          ${metricRow("Operating revenue / lagged assets", f(cs.or, 3))}
          ${metricRow("Expected from the model", f(cs.fitted, 3), null, `OR = ${csm.coef[0]} + ${csm.coef[1]} lagged OR + ${csm.coef[2]} MTB + ${csm.coef[3]} AR, all scaled by lagged total assets (n = ${csm.n}, R-squared ${csm.r2}).`)}
          ${metricRow("Unexpected operating revenue (UE_OR)", f(cs.ue, 3), cs.signal, `Higher than ${fp(uePct, 0)} of the coverage universe. Amber when UE_OR is in the top decile and non-operating income fell in the same year.`)}
          ${metricRow("Non-operating income / lagged assets", isNum(cs.nor) ? f(cs.nor, 3) : "n/a", null, isNum(cs.norPrev) ? `Previous year ${f(cs.norPrev, 3)}` : "")}
          </tbody></table>
          <div class="small"><p><b>Reading.</b> ${cs.signal === "A" ? "Revenue is well above the expected level while other income fell. Ask for the composition of revenue and whether any income was reclassified." : "No sign that non-operating income has moved into revenue this year."}</p>
          <p class="muted">Across the universe, UE_OR regressed on non-operating income gives a coefficient of ${csm.stage2.b} (t = ${csm.stage2.t}, n = ${csm.stage2.n}). A significant negative coefficient would indicate shifting; ${csm.stage2.b < 0 && Math.abs(csm.stage2.t) >= 1.96 ? "this one is significant at 5%" : "this one is not significant at 5%"}. Expense and cash flow shifting are not tested.</p></div></div>`
          : `<div class="empty">Available for the latest financial year only, because market value is needed for the market-to-book ratio.</div>`}
      </div>
      <div class="grid g3">
        <div class="card"><h3>DuPont analysis</h3><div class="sub">Three-step and five-step (modified) breakdown of ROE</div>
          <table><tbody>${metricRow("Net profit margin", fp(pr.npm))}${metricRow("Asset turnover", fx(pr.assetTurnover))}${metricRow("Equity multiplier", fx(pr.equityMultiplier))}${metricRow("<b>Return on equity</b>", fp(pr.roe))}
          <tr><td colspan="4" class="small muted" style="padding-top:12px">Five-step: tax burden x interest burden x EBIT margin x asset turnover x equity multiplier</td></tr>
          ${metricRow("Tax burden (PAT / PBT)", f(pr.taxBurden, 3))}${metricRow("Interest burden (PBT / EBIT)", f(pr.intBurden, 3))}${metricRow("EBIT margin", fp(pr.ebitMargin))}</tbody></table></div>
        <div class="card"><h3>Returns on capital</h3><div class="sub">The credit analyst's view is ROCE: return on all capital, debt included</div>
          <table><tbody>${metricRow("ROCE", fp(pr.roce), null, "EBIT / (average net worth + average borrowings)")}${metricRow("ROIC", fp(pr.roic), null, "NOPAT / average net operating assets. NOPAT = (EBIT - other income) x (1 - tax rate).")}
          ${metricRow("ROIIC (3 years)", fp(pr.roiic), null, "Change in NOPAT / change in invested capital over three years.")}${metricRow("EBITDA margin", fp(pr.ebitdaMargin))}</tbody></table>
          ${dw ? `<p class="small" style="margin-top:12px"><b>Cash flow persistence:</b> Durbin-Watson on operating cash flow = ${f(dw.DW)} (${dw.n} years). ${dw.reading}.</p>` : ""}</div>
        <div class="card"><h3>Market cross-checks</h3><div class="sub">Latest price. Is the market valuing earnings or cash?</div>
          <table><tbody>${metricRow("P/E", fx(mk.pe, 1))}${metricRow("P/OCF", fx(mk.pocf, 1), mk.pocfCheck ? (mk.pocfCheck.startsWith("Cash") ? "G" : "A") : null, "Market cap / operating cash flow. P/OCF below P/E means cash supports earnings.")}
          ${metricRow("PEG", f(mk.peg), null, "P/E / EPS growth (3-year CAGR, %)")}${metricRow("PEGY", f(mk.pegy), null, "P/E / (EPS growth % + dividend yield %)")}${metricRow("Price / book", fx(mk.pb, 1))}</tbody></table>
          <p class="small muted">${mk.pocfCheck || ""}</p></div>
      </div>`;
    const ix = yrsUpTo();
    chart("chAcc", lineCfg(labels(ix), [{ label: "Sloan ratio", data: ix.map((i) => M.accruals(m, i).sloan) }, { label: "Discretionary accruals", data: ix.map((i) => { const x = M.aem(m, i); return x ? x.da : null; }) }],
      (v) => fp(v, 0), { plugins: { refLines: { lines: [{ v: 0.1, c: COLORS.r, t: "10% high" }, { v: 0.05, c: COLORS.a, t: "5%" }] } } }));
    chart("chM", lineCfg(labels(ix), [{ label: "Beneish M-score", data: ix.map((i) => { const x = M.beneish(m, i); return x ? x.M : null; }), color: COLORS.navy }], (v) => f(v, 2),
      { plugins: { refLines: { lines: [{ v: -2.22, c: COLORS.r, t: "-2.22" }] } } }));
    if (bf) chart("chBen", { type: "bar", data: { labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], datasets: [
      { label: "Observed", data: bf.p, backgroundColor: COLORS.teal + "cc", borderRadius: 3 },
      { type: "line", label: "Benford expected", data: bf.exp, borderColor: COLORS.navy, backgroundColor: COLORS.navy, pointRadius: 3, borderWidth: 2 }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fp(c.parsed.y)}` } } }, scales: { x: { ...gridX, title: { display: true, text: "First digit" } }, y: { ...gridY, ticks: { callback: (v) => fp(v, 0) } } } } });
  }

  /* ================= 8. FLAGS ================= */
  function renderFlags() {
    const m = S.m, a = S.a, fl = a.fl, pr = M.promoter(m), q = m.raw.quarters;
    const groups = ["Core", "Case checks", "Behaviour", "Governance"];
    const desc = { Core: "Classic statement-level red flags for lenders", "Case checks": "Patterns from Indian enforcement cases", Behaviour: "Sudden changes against the borrower's own history", Governance: "Promoter and net worth signals" };
    const cnt = (s) => fl.filter((x) => x.status === s).length;
    $("#flBody").innerHTML = `
      <div class="grid g4 mb">${kpi("Red", cnt("R"), "Affect the lending decision", "R")}${kpi("Amber", cnt("A"), "Need an explanation", "A")}${kpi("Green", cnt("G"), "No concern", "G")}${kpi("Checks run", fl.length, yLabel())}</div>
      ${groups.map((g) => { const L = fl.filter((x) => x.group === g); return L.length ? `<div class="card mb"><h3>${g}</h3><div class="sub">${desc[g]}</div><div class="tbl-wrap"><table><thead><tr><th style="width:26%">Check</th><th>Result</th><th style="width:30%">Evidence</th><th>Why it matters to a lender</th></tr></thead><tbody>
        ${L.map((x) => `<tr><td><b>${x.name}</b></td><td>${sig(x.status)}</td><td class="small num">${esc(x.evidence)}</td><td class="small muted">${x.why}</td></tr>`).join("")}</tbody></table></div></div>` : ""; }).join("")}
      <div class="card mb"><h3>Purchase-to-inventory ratio</h3><div class="sub">Purchases booked against the inventory they added (the Coffee Day check). Purchases = material cost + increase in inventory. A ratio far above the borrower's own history or its industry means purchases are not showing up as stock or sales: ask where the goods went.</div>
        ${(() => {
          const rowsPi = yrsUpTo().slice(-4).map((i) => [m.years[i], M.purchaseInv(m, i)]).filter(([, x]) => x);
          const indPi = S.list.filter((x) => x.ind === m.industry && isNum(x.pi)).map((x) => x.pi).sort((p1, p2) => p1 - p2);
          const medPi = indPi.length ? indPi[Math.floor((indPi.length - 1) / 2)] : null;
          return rowsPi.length ? `<table><thead><tr><th>Year</th><th class="n">Purchases (Rs cr)</th><th class="n">Inventory added (Rs cr)</th><th class="n">Ratio</th></tr></thead><tbody>
            ${rowsPi.map(([y, x]) => `<tr><td>${y}</td><td class="n">${fc(x.purchases)}</td><td class="n">${fc(x.dInv)}</td><td class="n">${isNum(x.ratio) ? fx(x.ratio, 1) : "n/a (inventory fell)"}</td></tr>`).join("")}</tbody></table>
            <p class="small muted">Industry median (latest year): ${isNum(medPi) ? fx(medPi, 1) : "n/a"} across ${indPi.length} peers. Shown for information; not scored, because the ratio has no fixed threshold.</p>`
            : '<div class="empty">Material cost or inventory not reported</div>';
        })()}
      </div>
      <div class="grid g2">
        <div class="card"><h3>Quarterly revenue</h3><div class="sub">Look for revenue concentrated in the last quarter of each year</div><div class="chart-box"><canvas id="chQ"></canvas></div></div>
        <div class="card"><h3>Promoter shareholding</h3><div class="sub">${pr ? `${pr.from[1].toFixed(2)}% to ${pr.to[1].toFixed(2)}% over the period shown` : "Not available"}</div><div class="chart-box"><canvas id="chPr"></canvas></div></div>
      </div>`;
    if (q && q.rows && q.rows.Sales) {
      const yEnd = m.years[S.t].slice(0, 3);
      chart("chQ", { type: "bar", data: { labels: q.cols, datasets: [{ label: "Sales", data: q.rows.Sales, backgroundColor: q.cols.map((c) => (c.startsWith(yEnd) ? COLORS.gold : COLORS.navy + "bb")), borderRadius: 3 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "Rs " + fc(c.parsed.y) + " cr" } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: (v) => fc(v) } } } } });
    } else $("#chQ").parentElement.innerHTML = '<div class="empty">Quarterly data not available</div>';
    if (pr) chart("chPr", lineCfg(pr.series.map((x) => x[0]), [{ label: "Promoter holding", data: pr.series.map((x) => x[1]), color: COLORS.teal }], (v) => f(v, 1) + "%"));
    else $("#chPr").parentElement.innerHTML = '<div class="empty">Shareholding not available</div>';
  }

  /* ================= BORROWER QUALITY RATING ================= */
  const QKEY = () => "crm_qual_" + S.m.raw.ticker;
  function loadQual() { try { return JSON.parse(localStorage.getItem(QKEY())) || {}; } catch (e) { return {}; } }
  function saveQual(q) { try { localStorage.setItem(QKEY(), JSON.stringify(q)); } catch (e) {} }
  function peerCtx() {
    const peers = S.list.filter((c) => c.ind === S.m.industry);
    const med = (v) => { v = v.filter(isNum).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
    const sales = S.m.A.sales[S.t], sizes = peers.filter((c) => c.t !== S.m.raw.ticker).map((c) => c.sales).filter(isNum);
    return { indMedianRisk: med(peers.map((c) => c.sc)), sizePct: isNum(sales) && sizes.length ? sizes.filter((x) => x < sales).length / sizes.length : null };
  }
  function computeBqr() {
    S.qs = M.qualSuggest(S.m, S.t, S.a, peerCtx());
    S.q = loadQual();
    const levels = {};
    M.QUAL_FACTORS.forEach(([k]) => { const v = (S.q.levels || {})[k]; levels[k] = v && v !== "auto" ? v : S.qs.levels[k]; });
    S.qLevels = levels;
    S.b = M.bqr(S.a.score, levels, +(S.q.notch || 0));
  }
  function renderBqr() {
    const b = S.b, qs = S.qs, q = S.q, a = S.a;
    if (!b) { $("#bqrBody").innerHTML = '<div class="card empty">Not enough data to rate this borrower.</div>'; return; }
    const opts = (k, cur) => { const auto = qs.levels[k]; const list = [["auto", auto ? `Data suggestion (${auto})` : "Not assessed"], ...Object.keys(M.QUAL_LEVELS).map((l) => [l, l])];
      return list.map(([v, l]) => `<option value="${v}" ${(cur || "auto") === v ? "selected" : ""}>${l}</option>`).join(""); };
    const rows = M.QUAL_FACTORS.map(([k, label, guide]) => { const cur = (q.levels || {})[k], eff = S.qLevels[k];
      return `<tr><td style="width:24%"><b>${label}</b><div class="small muted">${guide}</div></td>
        <td style="width:26%" class="small">${qs.why[k] ? esc(qs.why[k]) : '<span class="muted">Not in the data. Assess from the annual report, auditor\'s report and corporate governance report.</span>'}</td>
        <td style="width:18%"><select data-qf="${k}" style="width:100%;height:30px;border:1px solid var(--line);border-radius:6px">${opts(k, cur)}</select></td>
        <td>${eff ? `<span class="sig ${M.QUAL_LEVELS[eff] >= 75 ? "G" : M.QUAL_LEVELS[eff] >= 50 ? "A" : "R"}">${eff} (${M.QUAL_LEVELS[eff]})</span>` : sig("NA", "Excluded")}</td>
        <td><input data-qn="${k}" value="${esc((q.notes || {})[k] || "")}" placeholder="Analyst note" style="width:100%;height:30px;border:1px solid var(--line);border-radius:6px;padding:0 8px"></td></tr>`; }).join("");
    const notch = +(q.notch || 0);
    $("#bqrBody").innerHTML = `
      <div class="grid g4 mb">
        ${kpi("Quantitative score (60%)", f(b.quant, 0) + " / 100", `100 less the risk score; quantitative grade ${a.grade}`)}
        ${kpi("Qualitative score (40%)", isNum(b.qualScore) ? f(b.qualScore, 0) + " / 100" : "n/a", `${b.assessed} of ${M.QUAL_FACTORS.length} factors assessed`)}
        ${kpi("Combined score", f(b.combined, 1), `0.6 x ${f(b.quant, 0)} + 0.4 x ${f(b.qualScore, 0)}`)}
        <div class="card kpi" style="border-top:4px solid ${BQR_COL[b.grade - 1]}"><div class="lbl">Borrower quality rating</div><div class="val" style="color:${BQR_COL[b.grade - 1]}">BQR ${b.grade}</div><div class="note"><b>${b.label}</b>${notch ? ` · model grade ${b.baseGrade}, notched ${notch > 0 ? "down" : "up"} ${Math.abs(notch)}` : ""}</div></div>
      </div>
      <div class="card mb"><div class="card-head"><div><h3>Qualitative scorecard</h3><div class="sub">Six factors are pre-filled from the data. Management, board and auditor need the analyst's judgement from the annual report. Choices are saved in this browser.</div></div>
        <button class="btn sm" id="qReset">Reset to data suggestions</button></div>
        <div class="tbl-wrap"><table><thead><tr><th>Factor</th><th>Evidence from the data</th><th>Analyst assessment</th><th>Used in rating</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="small muted">Scale: Strong 100, Satisfactory 75, Acceptable 50, Weak 25, Poor 0. The qualitative score is the average of the factors assessed.</p></div>
      <div class="grid g2">
        <div class="card"><h3>Override (notching)</h3><div class="sub">The system grade is a standalone assessment of the borrower. Support from the government or a strong parent, or a known event after the balance sheet date, is added here: up to two notches either way, with a recorded reason.</div>
          <div class="grid g2"><div class="field"><label>Notch</label><select id="qNotch">${[-2, -1, 0, 1, 2].map((n) => `<option value="${n}" ${n === notch ? "selected" : ""}>${n === 0 ? "No override" : n < 0 ? `Upgrade ${-n} notch${n === -1 ? "" : "es"}` : `Downgrade ${n} notch${n === 1 ? "" : "es"}`}</option>`).join("")}</select></div>
          <div class="field"><label>Model grade</label><div style="font-size:20px;font-weight:700">BQR ${b.baseGrade}</div></div></div>
          <div class="field"><label>Reason for override</label><input id="qReason" value="${esc(q.reason || "")}" placeholder="e.g. Parent group support confirmed; auditor resigned after year end"></div>
          <div id="qWarn" class="small">${notch && !(q.reason || "").trim() ? sig("R", "Record a reason for the override") : ""}</div></div>
        <div class="card"><h3>Rating scale</h3><div class="sub">Combined score to BQR grade. The lender's leverage limits are set by grade band (tab 10).</div>
          <table><thead><tr><th>BQR</th><th>Label</th><th class="n">Combined score</th></tr></thead><tbody>${M.BQR_SCALE.map((x, i) => `<tr ${x[1] === b.grade ? 'class="sel"' : ""}><td>${bqrChip(x[1])}</td><td>${x[2]}</td><td class="n">${x[0] < 0 ? "below 26" : `${x[0]}${i ? " to " + (M.BQR_SCALE[i - 1][0] - 0.1).toFixed(1) : " and above"}`}</td></tr>`).join("")}</tbody></table></div>
      </div>`;
    const update = () => { saveQual(S.q); computeBqr(); renderSummary(); renderBqr(); renderLoan(); };
    $$("[data-qf]").forEach((el) => el.addEventListener("change", () => { S.q.levels = { ...(S.q.levels || {}), [el.dataset.qf]: el.value }; update(); }));
    $$("[data-qn]").forEach((el) => el.addEventListener("change", () => { S.q.notes = { ...(S.q.notes || {}), [el.dataset.qn]: el.value }; saveQual(S.q); }));
    $("#qNotch").addEventListener("change", (e) => { S.q.notch = +e.target.value; update(); });
    $("#qReason").addEventListener("change", (e) => { S.q.reason = e.target.value; saveQual(S.q); $("#qWarn").innerHTML = S.q.notch && !e.target.value.trim() ? sig("R", "Record a reason for the override") : ""; });
    $("#qReset").addEventListener("click", () => { S.q = {}; update(); toast("Qualitative factors reset to the data suggestions"); });
  }

  /* ================= LOAN STRUCTURING AND COVENANTS ================= */
  function nonFinCovenants(st) {
    const fl = Object.fromEntries(S.a.fl.map((x) => [x.name, x.status])), lv = S.qLevels, bad = (k) => ["Weak", "Poor"].includes(lv[k]);
    const flag = (name) => ["R", "A"].includes(fl[name]);
    return [
      ["Prior lender consent before raising any other external borrowing", true, flag("Excess debt growth") || flag("Behavioural velocity (sudden change in borrowing or stock)") ? "Borrowings have grown faster than the business or changed suddenly." : "Standard: protects the lender's position and coverage."],
      ["Negative pledge: no new charge on assets without consent", st.lt.label === "Unsecured" || flag("Shift towards short-term borrowing (collateral propensity proxy)"), st.lt.label === "Unsecured" ? "Unsecured loan: keeps assets unencumbered for this lender." : flag("Shift towards short-term borrowing (collateral propensity proxy)") ? "Borrowing is shifting to short-term debt, a sign that assets may already be pledged." : "Usual for secured loans; already covered by the charge."],
      ["Minimum promoter shareholding and change-of-control clause", flag("Promoter stake falling") || bad("promoter"), flag("Promoter stake falling") ? "Promoter stake has fallen over the period shown." : "Standard: keeps the sponsor committed."],
      ["Dividends only while the DSCR covenant is met", flag("Dividends paid out of borrowed or negative free cash") || S.a.sol.signals.dscr !== "G", S.a.sol.signals.dscr !== "G" ? `Current DSCR ${fx(S.a.sol.dscr)} is not comfortably above 1.5x.` : "Standard."],
      ["No loans or advances to group companies without consent", flag("Advances to revenue") || bad("related"), flag("Advances to revenue") || bad("related") ? "Advances are high relative to revenue; funds could leave through related parties." : "Standard."],
      ["End-use certificate for loan proceeds", flag("Abnormal revenue jump (verify subsidiaries and customers)") || flag("Loan-to-equity conversion"), flag("Loan-to-equity conversion") ? "Loans were converted into equity; the source and use of funds need tracking." : flag("Abnormal revenue jump (verify subsidiaries and customers)") ? "Revenue jumped abnormally; confirm money is used in the business." : "Standard for term loans."],
      ["Notify the lender of auditor resignation or a qualified opinion", bad("auditor"), bad("auditor") ? "Auditor standing assessed as weak." : "Standard information covenant."],
      [S.b && S.b.grade >= 6 ? "Quarterly financials and covenant compliance certificate" : "Half-yearly financials and covenant compliance certificate", S.b && S.b.grade >= 6, S.b && S.b.grade >= 6 ? `BQR ${S.b.grade} warrants closer monitoring.` : "Standard monitoring frequency for this grade."],
    ];
  }
  function renderLoan() {
    const m = S.m, t = S.t, a = S.a, b = S.b, A = m.A;
    if (!b) { $("#loanBody").innerHTML = '<div class="card empty">Rate the borrower first.</div>'; return; }
    const pol = S.policy;
    if (S.loan.amount === null) {
      const probe = M.structure(m, t, { grade: b.grade, loanType: S.loan.type, amount: 0, debt: S.debt, policy: pol, pd: a.o && a.o.p });
      S.loan.amount = Math.round(Math.max(probe.maxLoan * 0.8, 0) / 10) * 10 || Math.round(Math.max(z0(A.ebitda[t]) * 0.25, 0) / 10) * 10;
    }
    const st = M.structure(m, t, { grade: b.grade, loanType: S.loan.type, amount: S.loan.amount, debt: S.debt, policy: pol, pd: a.o && a.o.p });
    if (!S.cov) S.cov = { maxLev: st.maxLev, maxDE: st.maxDE, minIcr: 2.0, minDscr: 1.2, minCr: isNum(A.curAssets[t]) && isNum(A.curLiab[t]) && A.curLiab[t] > 0 ? Math.min(1.1, Math.floor(85 * A.curAssets[t] / A.curLiab[t]) / 100) : 1.1, minNw: isNum(A.equity[t]) && A.equity[t] > 0 ? Math.round(A.equity[t] * 0.9) : 0 };
    const cv = M.covenants(m, t, st.pf, S.cov);
    const cur = M.structure(m, t, { grade: b.grade, loanType: S.loan.type, amount: 0, debt: S.debt, policy: pol, pd: a.o && a.o.p });
    const capName = { leverage: "Leverage limit (debt / EBITDA)", gearing: "Gearing limit (debt / equity)", dscr: `DSCR limit (required ${S.debt.dscr}x)`, security: `Security cover (${st.lt.cover}x on fixed assets)`, policy: "Policy: secured lending only at this grade" };
    const capMax = Math.max(...Object.values(st.caps).filter(isNum).map((v) => Math.max(v, 0)), 1);
    const nf = nonFinCovenants(st);
    const ok = st.within && cv.rows.every((r) => r.status !== "R");
    const decision = st.maxLoan <= 0 ? ["Decline the proposal", COLORS.r] : !st.within ? ["Reduce the amount to the maximum loan", COLORS.a] : ok ? ["Recommend for sanction", COLORS.g] : ["Sanction only with covenant reset", COLORS.a];
    $("#loanBody").innerHTML = `
      <div class="grid g3 mb">
        <div class="card"><h3>Proposed facility</h3><div class="sub">Rating ${bqrChip(b.grade)} ${b.label}. Pricing terms (rate, tenor, target DSCR) are shared with the debt capacity calculator on tab 5.</div>
          <div class="field"><label>Loan type</label></div>
          ${Object.entries(pol.loanTypes).map(([k, v]) => `<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid ${S.loan.type === k ? "var(--teal)" : "var(--line)"};background:${S.loan.type === k ? "var(--teal-soft)" : "#fff"};border-radius:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer"><input type="radio" name="ltype" value="${k}" ${S.loan.type === k ? "checked" : ""}><span><b>${v.label}</b><br><span class="small muted">${v.note}</span></span></label>`).join("")}
          <div class="field" style="margin-top:10px"><label>Proposed amount (Rs crore)</label><input type="number" id="loanAmt" min="0" step="10" value="${S.loan.amount}"></div>
          <p class="small muted">Rate ${S.debt.rate}% · tenor ${S.debt.tenor} years · target DSCR ${S.debt.dscr}x</p></div>
        <div class="card span2"><div class="card-head"><div><h3>Maximum loan</h3><div class="sub">The lowest of four limits binds. Negative values mean the borrower is already above that limit.</div></div>
          <div style="text-align:right"><div class="small muted">Maximum new loan</div><div style="font-size:24px;font-weight:800;color:${st.maxLoan > 0 ? COLORS.g : COLORS.r}">Rs ${fc(st.maxLoan)} cr</div><div class="small muted">Binding: ${capName[st.binding]}</div></div></div>
          ${Object.entries(st.caps).map(([k, v]) => `<div class="pctl" style="grid-template-columns:230px 1fr 110px"><span>${capName[k]}${k === st.binding ? ' <span class="tag">binding</span>' : ""}</span>${v === null ? '<span class="small muted">Not applicable to unsecured loans</span><span></span>' : `<div class="track" style="height:10px;border-radius:5px;background:var(--line-2);position:relative"><i style="position:absolute;left:0;top:0;bottom:0;border-radius:5px;width:${Math.max(0, v) / capMax * 100}%;background:${k === st.binding ? COLORS.teal : COLORS.grey}"></i></div><span class="num small" style="text-align:right;color:${v < 0 ? COLORS.r : "inherit"}">Rs ${fc(v)} cr</span>`}</div>`).join("")}
          <div class="note-box" style="margin-top:12px"><span class="rec" style="background:${decision[1]}1f;color:${decision[1]}">${decision[0]}</span>
            <p>Proposed Rs ${fc(st.amount)} cr ${st.lt.label.toLowerCase()} against a maximum of Rs ${fc(st.maxLoan)} cr. Policy limit for BQR ${b.grade} (band ${st.band.band}): debt / EBITDA up to ${f(st.maxLev, 2)}x${st.lt.levAdd ? ` (including ${st.lt.levAdd}x allowed for ${st.lt.label.toLowerCase()} lending)` : ""}, debt / equity up to ${f(st.maxDE, 2)}x.${st.maxLev === 0 ? " The policy allows no fresh lending at this grade." : st.band.securedOnly ? " At this grade the policy allows secured or senior secured lending only." : ""}</p></div></div>
      </div>
      <div class="grid g32 mb">
        <div class="card"><h3>Financial covenants</h3><div class="sub">Thresholds default to the lender policy and can be edited. The current ratio covenant defaults to the lower of 1.1x and 85% of the current level, because current investments are not counted in current assets. Tested on pro-forma figures, after the proposed loan.</div>
          <div class="tbl-wrap"><table><thead><tr><th>Covenant</th><th class="n">Threshold</th><th class="n">Current</th><th class="n">Pro-forma</th><th class="n">Headroom</th><th>Status</th></tr></thead><tbody>
          ${cv.rows.map((r) => { const curV = cur.pf[r.key]; const key = { debtEbitda: "maxLev", de: "maxDE", intCover: "minIcr", dscr: "minDscr", currentRatio: "minCr", netWorth: "minNw" }[r.key];
            return `<tr><td><b>${r.label}</b></td><td class="n"><input data-cov="${key}" type="number" step="${key === "minNw" ? 100 : 0.05}" value="${S.cov[key]}" style="width:${key === "minNw" ? 95 : 70}px;height:28px;border:1px solid var(--line);border-radius:6px;padding:0 6px;text-align:right"></td>
            <td class="n">${r.fm(curV)}</td><td class="n"><b>${r.fm(r.actual)}</b></td><td class="n">${isNum(r.headroom) ? fp(r.headroom, 0) : "n/a"}</td><td>${sig(r.status)}</td></tr>`; }).join("")}</tbody></table></div>
          <p class="small">${isNum(cv.cushion) ? (cv.cushion > 0 ? `<b>EBITDA cushion:</b> EBITDA can fall by ${fp(cv.cushion, 0)} before the leverage or interest cover covenant is breached.` : "<b>EBITDA cushion:</b> none. A leverage or interest cover covenant is already breached on pro-forma figures.") : ""}</p></div>
        <div class="card"><h3>Pro-forma position and expected loss</h3><div class="sub">Effect of the proposed loan on the borrower's balance sheet</div>
          <table><tbody>${metricRow("Borrowings", `Rs ${fc(z0(A.borrow[t]))} cr → Rs ${fc(st.newDebt)} cr`)}
          ${metricRow("Collateral (net fixed assets + CWIP)", "Rs " + fc(st.collateral) + " cr")}
          ${metricRow("Asset cover after loan", st.pf.cover ? fx(st.pf.cover) : "Unsecured", st.pf.cover ? (st.pf.cover >= st.lt.cover ? "G" : "R") : null, "Collateral / total borrowings after the loan, against the required cover for the loan type.")}
          ${st.el ? metricRow("Probability of default (Ohlson)", fp(st.el.pd, 1), null, "Ohlson probability of distress used as an indicative PD.") + metricRow("Loss given default", fp(st.el.lgd, 0), null, "Set by lender policy for the loan type; editable below.") + metricRow("Exposure at default", "Rs " + fc(st.el.ead) + " cr") + metricRow("<b>Expected loss = PD x LGD x EAD</b>", `Rs ${fc(st.el.el)} cr (${fp(st.el.el / Math.max(st.el.ead, 1), 1)} of the loan)`) : ""}
          </tbody></table></div>
      </div>
      <div class="grid g32">
        <div class="card"><h3>Non-financial covenants</h3><div class="sub">Recommended from this borrower's own red flags and qualitative assessment. Standard clauses are listed for completeness.</div>
          <table><tbody>${nf.map(([n, rec, why]) => `<tr><td style="width:52%"><b>${n}</b></td><td>${rec ? sig("A", "Recommended") : sig("G", "Standard")}</td><td class="small muted">${why}</td></tr>`).join("")}</tbody></table></div>
        <div class="card"><div class="card-head"><div><h3>Lender policy</h3><div class="sub">Set by the lending institution. Changes apply to every borrower until the page is reloaded.</div></div><button class="btn sm" id="polReset">Reset policy</button></div>
          <table class="policy"><thead><tr><th>BQR band</th><th class="n">Max debt / EBITDA</th><th class="n">Max debt / equity</th><th>Secured only</th></tr></thead><tbody>
          ${pol.limits.map((l, i) => `<tr ${l === st.band ? 'class="sel"' : ""}><td>${l.band}</td><td class="n"><input data-pl="${i}" data-f="maxLev" type="number" step="0.25" value="${l.maxLev}" style="width:70px;height:28px;border:1px solid var(--line);border-radius:6px;text-align:right;padding:0 6px"></td><td class="n"><input data-pl="${i}" data-f="maxDE" type="number" step="0.25" value="${l.maxDE}" style="width:70px;height:28px;border:1px solid var(--line);border-radius:6px;text-align:right;padding:0 6px"></td><td><input data-ps="${i}" type="checkbox" ${l.securedOnly ? "checked" : ""}></td></tr>`).join("")}</tbody></table>
          <table style="margin-top:10px"><thead><tr><th>Loan type</th><th class="n">Extra debt / EBITDA</th><th class="n">Required cover</th><th class="n">LGD %</th></tr></thead><tbody>
          ${Object.entries(pol.loanTypes).map(([k, v]) => `<tr><td>${v.label}</td>${["levAdd", "cover", "lgd"].map((fld) => `<td class="n"><input data-lt="${k}" data-f="${fld}" type="number" step="${fld === "lgd" ? 5 : 0.25}" value="${v[fld]}" style="width:64px;height:28px;border:1px solid var(--line);border-radius:6px;text-align:right;padding:0 6px"></td>`).join("")}</tr>`).join("")}</tbody></table>
          <p class="small muted">Defaults are illustrative and should be replaced with the lending institution's credit policy.</p>
          <button class="btn primary" id="memoBtn" style="margin-top:6px">Download credit memo</button></div>
      </div>`;
    $$("input[name=ltype]").forEach((r) => r.addEventListener("change", () => { S.loan.type = r.value; S.cov = null; renderLoan(); }));
    $("#loanAmt").addEventListener("change", (e) => { S.loan.amount = Math.max(0, +e.target.value || 0); renderLoan(); });
    $$("[data-cov]").forEach((el) => el.addEventListener("change", () => { S.cov[el.dataset.cov] = +el.value; renderLoan(); }));
    $$("[data-pl]").forEach((el) => el.addEventListener("change", () => { S.policy.limits[+el.dataset.pl][el.dataset.f] = +el.value; S.cov = null; renderLoan(); }));
    $$("[data-ps]").forEach((el) => el.addEventListener("change", () => { S.policy.limits[+el.dataset.ps].securedOnly = el.checked; S.cov = null; renderLoan(); }));
    $$("[data-lt]").forEach((el) => el.addEventListener("change", () => { S.policy.loanTypes[el.dataset.lt][el.dataset.f] = +el.value; S.cov = null; renderLoan(); }));
    $("#polReset").addEventListener("click", () => { S.policy = JSON.parse(JSON.stringify(M.DEFAULT_POLICY)); S.cov = null; renderLoan(); toast("Lender policy reset to defaults"); });
    $("#memoBtn").addEventListener("click", () => downloadMemo(st, cv, nf, decision));
  }
  function downloadMemo(st, cv, nf, decision) {
    const m = S.m, a = S.a, b = S.b, n = analystNote(a), L = [];
    const name = m.raw.nse_name || m.raw.name;
    L.push(`CREDIT MEMO: ${name} (${m.raw.ticker})`, `Industry: ${m.industry}    Financial year: ${m.years[S.t]}    Prepared: ${new Date().toLocaleDateString("en-IN")}`, "");
    L.push(`RATING`, `Borrower quality rating: BQR ${b.grade} (${b.label})`, `Quantitative score ${b.quant.toFixed(0)} (60%), qualitative score ${isNum(b.qualScore) ? b.qualScore.toFixed(0) : "n/a"} (40%), combined ${b.combined.toFixed(1)}`);
    if (S.q.notch) L.push(`Override: ${S.q.notch > 0 ? "downgraded" : "upgraded"} ${Math.abs(S.q.notch)} notch(es). Reason: ${S.q.reason || "not recorded"}`);
    L.push("", "QUALITATIVE ASSESSMENT");
    M.QUAL_FACTORS.forEach(([k, l]) => L.push(`- ${l}: ${S.qLevels[k] || "not assessed"}${(S.q.notes || {})[k] ? " (" + S.q.notes[k] + ")" : S.qs.why[k] ? " (" + S.qs.why[k] + ")" : ""}`));
    L.push("", "KEY RISKS", ...(n.concerns.length ? n.concerns.map((x) => "- " + x) : ["- None of the measured signals is red."]), "", "STRENGTHS", ...(n.strengths.length ? n.strengths.map((x) => "- " + x) : ["- None clearly in the comfortable range."]));
    L.push("", "PROPOSED FACILITY", `${st.lt.label} loan of Rs ${Math.round(st.amount)} cr; rate ${S.debt.rate}%, tenor ${S.debt.tenor} years`, `Maximum loan under policy: Rs ${Math.round(st.maxLoan)} cr (binding limit: ${st.binding})`);
    if (st.el) L.push(`Expected loss: PD ${(st.el.pd * 100).toFixed(1)}% x LGD ${(st.el.lgd * 100).toFixed(0)}% x EAD Rs ${Math.round(st.el.ead)} cr = Rs ${Math.round(st.el.el)} cr`);
    L.push("", "FINANCIAL COVENANTS (pro-forma)", ...cv.rows.map((r) => `- ${r.label}: threshold ${r.thr}, pro-forma ${r.fm(r.actual)}, headroom ${isNum(r.headroom) ? (r.headroom * 100).toFixed(0) + "%" : "n/a"}`));
    L.push("", "NON-FINANCIAL COVENANTS", ...nf.map(([x, rec, why]) => `- ${x}${rec ? " [recommended: " + why + "]" : ""}`));
    L.push("", "QUESTIONS FOR MANAGEMENT", ...n.asks.map((x, i) => `${i + 1}. ${x}`), "", `RECOMMENDATION: ${decision[0]}. ${n.action[2]}`);
    const blob = new Blob([L.join("\n")], { type: "text/plain" }); const el = document.createElement("a");
    el.href = URL.createObjectURL(blob); el.download = `credit_memo_${m.raw.ticker}_${m.years[S.t].replace(" ", "")}.txt`; el.click();
  }

  /* ================= 2. PEERS ================= */
  const PEER_METRICS = [
    ["sc", "Risk score", false, (v) => f(v, 0)], ["de", "Debt / equity", false, (v) => fx(v)], ["dEb", "Debt / EBITDA", false, (v) => fx(v, 1)],
    ["ic", "Interest cover", true, (v) => fx(v, 1)], ["dscr", "DSCR", true, (v) => fx(v)], ["cce", "CFO / EBITDA", true, (v) => fp(v, 0)],
    ["cr", "Current ratio", true, (v) => fx(v)], ["dd", "Debtor days", false, (v) => fd(v)], ["ebm", "EBITDA margin", true, (v) => fp(v)],
    ["roce", "ROCE", true, (v) => fp(v)], ["sl", "Sloan ratio", false, (v) => fp(v)],
  ];
  function currentRow() {
    const m = S.m, t = S.t, a = S.a, A = m.A;
    return { t: m.raw.ticker, n: m.raw.nse_name || m.raw.name, ind: m.industry, sc: a.score, de: a.sol.deNote ? "neg" : a.sol.de, dEb: a.sol.debtEbitdaNote ? "neg" : a.sol.debtEbitda, ic: a.sol.intCover, dscr: a.sol.dscr, cce: a.liq.cce, cr: a.liq.currentRatio,
      dd: A.debtorDays[t], ebm: M.div(A.ebitda[t], A.sales[t]), roce: M.profitability(m, t).roce, sl: a.acc.sloan, g: a.grade, zz: a.z && a.z.primaryZone, z: a.z && a.z.primaryValue, op: a.o && a.o.p, fy: m.years[t] };
  }
  function renderPeers() {
    const me = currentRow(), peers = S.list.filter((c) => c.ind === me.ind);
    if (peers.length < 3) { $("#peerBody").innerHTML = `<div class="card empty">Too few companies in ${esc(me.ind)} for a peer comparison.</div>`; return; }
    const num = (v) => (v === "neg" ? 1e7 : (v = val(v)) === Infinity ? 1e6 : v);
    const rows = PEER_METRICS.map(([k, l, hiGood, fm]) => {
      const vals = peers.map((c) => num(c[k])).filter(isNum).sort((a, b) => a - b), v = num(me[k]);
      if (!isNum(v) || vals.length < 3) return null;
      const pct = vals.filter((x) => x <= v).length / vals.length, medv = vals[Math.floor((vals.length - 1) / 2)];
      const out = pct <= 0.1 || pct >= 0.9, bad = hiGood ? pct <= 0.1 : pct >= 0.9;
      return `<div class="pctl"><span><b>${l}</b><br><span class="small muted">Borrower ${fm(me[k])} · median ${fm(medv)}</span></span><div class="scale"><span></span><i style="left:${pct * 100}%;background:${bad ? COLORS.r : out ? COLORS.a : COLORS.navy}"></i></div><span class="num small" style="color:${bad ? COLORS.r : out ? COLORS.a : "inherit"}">${Math.round(pct * 100)}th${out ? (bad ? " · weak" : " · unusual") : ""}</span></div>`;
    }).filter(Boolean);
    const anomalies = rows.filter((r) => r.includes("weak") || r.includes("unusual")).length;
    const sorted = peers.slice().sort((a, b) => (a.sc ?? 99) - (b.sc ?? 99));
    $("#peerBody").innerHTML = `
      <div class="grid g3 mb">${kpi("Industry", esc(me.ind), `${peers.length} borrowers in the universe`)}${kpi("Rank by risk score", (sorted.findIndex((c) => c.t === me.t) + 1 || "n/a") + " of " + peers.length, "1 = lowest risk in the industry")}
        ${kpi("Peer group anomalies", anomalies + " of " + rows.length, "Metrics in the bottom or top 10% of the industry", anomalies >= 4 ? "R" : anomalies >= 2 ? "A" : "G")}</div>
      <div class="grid g2">
        <div class="card"><h3>Peer Group Anomaly Index</h3><div class="sub">Percentile of the borrower within ${esc(me.ind)}. Red marker = weak tail, amber = unusual but not adverse.${S.t !== S.m.n - 1 ? " Peers are shown at their latest year." : ""}</div>${rows.join("")}</div>
        <div class="card"><h3>Industry peers</h3><div class="sub">Sorted from lowest to highest risk score. Click a row to open that borrower.</div>
          <div class="tbl-wrap" style="max-height:560px;overflow:auto"><table><thead><tr><th>Borrower</th><th>Grade</th><th class="n">D/E</th><th class="n">Int. cover</th><th class="n">CFO/EBITDA</th><th class="n">Altman</th></tr></thead><tbody>
          ${sorted.map((c) => `<tr class="click ${c.t === me.t ? "sel" : ""}" data-t="${c.t}"><td><div class="co">${esc(c.n)}<small>${c.t}</small></div></td><td>${gradeChip(c.g)}</td><td class="n">${fx(c.de)}</td><td class="n">${fx(c.ic, 1)}</td><td class="n">${fp(c.cce, 0)}</td><td class="n"><span class="zone ${c.zz}">${f(c.z)}</span></td></tr>`).join("")}</tbody></table></div></div>
      </div>`;
    $$("#peerBody tr[data-t]").forEach((tr) => tr.addEventListener("click", () => selectCompany(tr.dataset.t, "peers")));
  }

  /* ================= 9. IMPORT ================= */
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function templateCsv() {
    const yrs = ["Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025", "Mar 2026"];
    const lines = [["Line item", ...yrs], ...Object.entries(M.IMPORT_FIELDS).map(([, al]) => [al[0].replace(/\b\w/g, (c) => c.toUpperCase()), "", "", "", "", ""])];
    download("borrower_import_template.csv", lines.map((r) => r.join(",")).join("\n"));
  }
  async function doImport() {
    const file = $("#impFile").files[0], name = $("#impName").value.trim() || "Imported borrower", unit = +$("#impUnit").value, ind = $("#impInd").value;
    const msg = $("#impMsg");
    if (!file) { msg.innerHTML = sig("R", "Choose a CSV file first"); return; }
    const rows = parseCsv(await file.text());
    if (rows.length < 5) { msg.innerHTML = sig("R", "The file has too few rows"); return; }
    const years = rows[0].slice(1).map((s) => s.trim()).filter(Boolean);
    const body = rows.slice(1).map((r) => [r[0].trim(), years.map((_, i) => { const x = parseFloat(String(r[i + 1] ?? "").replace(/[, ]/g, "").replace(/^\((.*)\)$/, "-$1")); return isNum(x) ? x * unit : null; })]);
    const m = M.fromWide(name, { years, rows: body }, ind);
    if (!m.A.sales.some(isNum) || !m.A.ta.some(isNum)) { msg.innerHTML = sig("R", "Revenue and total assets are required"); return; }
    let tk = "IMP-" + m.raw.ticker.slice(0, 8); m.raw.ticker = tk;
    const t = m.n - 1, a = M.assess(m, t);
    const row = { t: tk, n: name + " (imported)", ind, g: a.grade, gl: a.gradeLabel, sc: a.score };
    S.imported[tk] = { m, row };
    refreshDatalist();
    msg.innerHTML = `${sig("G", "Loaded")} ${m.raw.importMap.length} line items recognised: ${m.raw.importMap.map((x) => esc(x[0])).join(", ")}.`;
    selectCompany(tk, "summary");
  }

  /* ================= 10. METHOD ================= */
  function renderMethod() {
    const sec = (title, body) => `<div class="card mb"><h3>${title}</h3>${body}</div>`;
    const fm = (s) => `<div class="formula">${s}</div>`;
    $("#methodBody").innerHTML =
      sec("Purpose and scope", `<p>The dashboard supports a credit analyst who must decide whether a company can repay its debt, how much can be lent and on what terms. It covers the non-financial constituents of the Nifty 500 (${S.U ? S.U.count : "about 400"} companies). ${S.U && S.U.skipped && S.U.skipped.length ? `${S.U.skipped.length} recently listed or non-standard companies are left out (${S.U.skipped.map((x) => x[0]).join(", ")}) because the models need at least three annual reports. ` : ""}Banks, NBFCs and insurers are excluded because the Beneish, Altman and related models are not defined for financial companies, whose balance sheets are built from loans and deposits.</p>
        <p>Each borrower is assessed on five pillars. Every metric in a pillar is given a Green, Amber or Red signal (0, 50 or 100 risk points). The pillar score is the average of its signals, and the overall risk score is the weighted average of the pillars: liquidity 20%, solvency and debt service 25%, distress models 25%, earnings quality 20%, red flags 10%. Scores map to the credit watch grade: below 20 CW1 Strong, 20-35 CW2 Adequate, 35-50 CW3 Watch, 50-65 CW4 Weak, 65 and above CW5 Critical. The grade is an internal screening tool and not a credit rating.</p>`) +
      sec("Data and definitions", `<p>Annual statements (up to twelve years), quarterly results and shareholding are taken from screener.in, which compiles them from stock exchange filings. Consolidated figures are used where the company reports them; otherwise standalone. The line-item breakdowns (receivables, inventories, borrowings, trade payables, capex) come from the same source. The Nifty 500 constituent list and industry classification are from NSE. Data is refreshed weekly by an automated job and the date is shown in the top bar.</p>
        <p><b>Current assets and current liabilities.</b> The source groups all assets other than fixed assets, CWIP and investments as "other assets", and all liabilities other than equity and borrowings as "other liabilities". Current assets are taken as other assets; current liabilities as other liabilities less minority interest plus short-term borrowings. Current investments are reported together with long-term investments and are excluded, so the current ratio is understated for companies that hold their treasury in mutual funds.</p>
        <p><b>Other proxies.</b> Retained earnings = reserves. Cost of goods sold = material, manufacturing and power costs. SG&A = selling and administrative cost where reported, otherwise other expenses. FFO = PAT + depreciation less exceptional items (non-operating gains). CFADS = CFO less maintenance capex (a share of depreciation, adjustable). Principal due = long-term borrowings divided by the assumed tenor, 7 years by default and 15 years for power companies, whose project loans are repaid over the life of the plant. Total liabilities = total assets less net worth.</p>`) +
      sec("Liquidity", fm("Current ratio = CA / CL        Quick ratio = (CA - inventory) / CL        Cash ratio = cash / CL\nWorking capital days = (CA - CL) / sales x 365     Cash conversion cycle = debtor days + inventory days - payable days\nOCF ratio = CFO / CL        Cash conversion efficiency (CCE) = CFO / EBITDA\nTACR = (cash x w1 + receivables x w2 + inventory x w3 + other CA x w4) / CL   (defaults 100%, 80%, 40%, 50%)\nDefensive interval = (cash + receivables) / (cash operating expenses / 365)\nCash burn = -CFO / 12;  Runway = cash / monthly burn") +
        `<p>CCE bands: above 100% outstanding, 80-100% strong, 60-80% acceptable, 40-60% weak, below 40% major concern. Signals: current ratio green from 1.5, red below 1.0; OCF ratio green from 0.4, red below 0.2; TACR green from 1.2, red below 1.0; defensive interval green from 180 days, red below 90.</p>`) +
      sec("Solvency, debt service and capacity", fm("D/E = borrowings / net worth      Debt / EBITDA      Interest cover = EBIT / interest\nDSCR = CFADS / (interest + principal)      FFO / TL\nMaximum debt = sum over the tenor of [CFADS_t / target DSCR] / (1 + r)^t   (debt sculpting)\nLLCR = PV of CFADS over the loan life / outstanding debt\nIGR = ROA x (1 - payout)      SGR = ROE x (1 - payout)\nTrading on equity: spread = EBIT / average assets - interest / average debt") +
        `<p>Signals: D/E green up to 1, red above 2; debt/EBITDA green up to 2.5, red above 4; interest cover green from 3, red below 1.5; DSCR green from 1.5, red below 1.2; FFO/TL green from 20%, red below 10%. The debt structuring matrix treats a borrower as asset rich when fixed assets and CWIP are at least 35% of total assets and cash rich when CFO is at least 25% of borrowings.</p>`) +
      sec("Distress models", fm("Altman Z (listed manufacturer)  = 1.2 X1 + 1.4 X2 + 3.3 X3 + 0.6 X4(market) + 1.0 X5     safe > 2.99, distress < 1.81\nAltman Z' (book equity)          = 0.717 X1 + 0.847 X2 + 3.107 X3 + 0.420 X4 + 0.998 X5   safe > 2.90, distress < 1.23\nAltman Z'' (non-manufacturing)   = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4                   safe > 2.60, distress < 1.10\n  X1 = WC/TA, X2 = RE/TA, X3 = EBIT/TA, X4 = equity/TL, X5 = sales/TA\nOhlson O = -1.32 - 0.407 ln(TA/100) + 6.03 TL/TA - 1.43 WC/TA + 0.0757 CL/CA - 1.72 X - 2.37 NI/TA\n           - 1.83 FFO/TL + 0.285 Y - 0.521 (NI_t - NI_t-1)/(|NI_t| + |NI_t-1|);   P = e^O / (1 + e^O)\nZmijewski = -4.336 - 4.513 NI/TA + 5.679 TL/TA + 0.004 CA/CL\nSpringate = 1.03 WC/TA + 3.07 EBIT/TA + 0.66 PBT/CL + 0.4 sales/TA      stress below 0.862\nFulmer H  = 5.528 X1 + 0.212 X2 + 0.73 X3 + 1.27 X4 - 0.12 X5 + 2.335 X6 + 0.575 X7 + 1.083 X8 + 0.894 X9 - 6.075\nKZ index  = -1.0019 CF/K + 0.2826 Q + 3.1392 Debt/Capital - 39.3678 Div/K - 1.3148 Cash/K") +
        `<p>The Altman version is chosen by industry: Z' for manufacturing industries (capital goods, automobiles, chemicals, metals, FMCG, healthcare, construction materials, textiles, consumer durables, oil and gas) and Z'' for the rest. The Ohlson size term uses total assets in Rs crore divided by a price index of 100. Ohlson signals: probability above 50% red, 20-50% amber. Zmijewski: above zero red, between -1 and zero amber. Fulmer is not defined when debt is zero or net worth is negative.</p>`) +
      sec("Earnings quality", fm("Sloan ratio = (NI - CFO) / average TA         0-5% low, 5-10% moderate, 10-20% high, > 20% very high\nBalance sheet accruals = change in NOA / average NOA\nCash flow accruals = [NI - (CFO + CFI)] / average NOA\nBeneish M = -4.84 + 0.92 DSRI + 0.528 GMI + 0.404 AQI + 0.892 SGI + 0.115 DEPI - 0.172 SGAI + 4.679 TATA - 0.327 LVGI\n            M > -2.22: likely manipulator\nMontier C-score: one point each for widening NI-CFO gap, rising debtor days, rising inventory days,\n            rising other current assets to revenue, falling depreciation to gross block, asset growth above 10%\nPiotroski F-score: NI > 0, ROA > 0, CFO > 0, CFO > NI, lower long-term debt, higher current ratio,\n            no new shares, higher gross margin, higher asset turnover") +
        `<p><b>Accrual earnings management.</b> The modified Jones model is estimated by OLS on a cross-section of 2,700 Indian listed firms for FY2024 (Prowess data, Rs million, 1st and 99th percentiles trimmed):</p>` +
        fm(`TA/A(t-1) = ${M.AEM_COEF.a0} + ${M.AEM_COEF.a1} (1/A(t-1)) + ${M.AEM_COEF.b1} [(dREV - dREC)/A(t-1)] ${M.AEM_COEF.b2} (PPE/A(t-1))      R-squared ${M.AEM_COEF.r2}\nDiscretionary accruals = actual TA/A(t-1) - fitted value. Green up to 5%, red above 10%.`) +
        `<p><b>Real earnings management.</b> The three Roychowdhury models (abnormal CFO, abnormal production cost, abnormal discretionary expense) use coefficients estimated by OLS on 2,150 Indian listed firms for FY2024. Aggregate REM = -Ab_CFO + Ab_PROD - Ab_DISX. Discretionary expense needs selling cost, which many companies do not report separately; the aggregate then uses the two available components. Borrower figures are converted from Rs crore to Rs million before the models are applied. Coefficients estimated on one year are applied to every year, which is an approximation.</p>` +
        `<p><b>Classification shifting.</b> Operating revenue is modelled as OR = a0 + b1 lagged OR + b2 MTB + b3 AR, all scaled by lagged total assets, on the latest-year cross-section of the coverage universe (observations outside the 1st and 99th percentiles trimmed). The residual is unexpected operating revenue (UE_OR). Across the universe, UE_OR is regressed on non-operating revenue; a significant negative coefficient would mean non-operating income is being reported as revenue. A borrower is marked amber when its UE_OR is in the top decile and its non-operating income fell in the same year. The measure is shown for information and is not scored. Expense and cash flow shifting are not tested.</p>` +
        `<p><b>Purchase-to-inventory ratio.</b> Purchases (material cost + increase in inventory) divided by the increase in inventory, compared with the borrower's own history and the industry median. Shown for information; it has no fixed threshold.</p>` +
        `<p><b>Benford's law.</b> First digits of every reported amount (annual and quarterly statements and their breakdowns) are compared with log10(1 + 1/d). The Kolmogorov-Smirnov statistic is the largest gap between the cumulative observed and expected distributions; a value above 1.36 / &radic;N indicates departure from Benford's law. Subtotals repeat some digits, so the test indicates where to look and is not evidence of manipulation.</p>` +
        `<p><b>Other measures.</b> DuPont (three and five step), ROCE, ROIC, ROIIC, P/E, PEG, PEGY and P/OCF. The cash flow life cycle stage follows the signs of CFO, CFI and CFF. The Durbin-Watson statistic is computed on the residuals of a linear trend fitted to operating cash flow.</p>`) +
      sec("Borrower Quality Rating", `<p>The BQR follows the practice of bank credit teams of combining a quantitative assessment with the analyst's qualitative judgement. The quantitative score is 100 less the risk score described above and carries 60%. The qualitative scorecard carries 40% and has nine factors scored Strong (100), Satisfactory (75), Acceptable (50), Weak (25) or Poor (0); its score is the average of the factors assessed.</p>` +
        fm("BQR combined score = 0.6 x (100 - risk score) + 0.4 x qualitative score\nBQR 1-2 Prime (82+), 3-4 Strong (66-82), 5-6 Satisfactory (50-66), 7 Watch (42-50), 8 Weak (34-42), 9 Very weak (26-34), 10 Default risk (< 26)\nLending zones: 1-6 normal lending, 7 tighter structure, 8 secured lending only, 9-10 no fresh lending\nOverride: up to two notches either way, with a recorded reason") +
        `<p>Six factors are suggested from the data: promoter commitment (stake level and change), related-party exposure (loans and advances to revenue), fraud triangle pressure (number of red flags on the forensic checklist; the distress models are left out because they already carry 25% of the quantitative score), industry outlook (median risk score of the industry), business position (revenue rank within the industry) and financial flexibility (net debt to EBITDA). Management quality, board governance and auditor standing are not available in the statements and are left to the analyst. In the portfolio table the BQR therefore uses the six data-derived factors; on the borrower page the analyst can complete or override them.</p>`) +
      sec("Loan structuring and covenants", fm("Maximum new loan = min( policy debt/EBITDA x EBITDA - debt,  policy D/E x net worth - debt,\n                       DSCR limit,  collateral / required cover - debt )\nDSCR limit = (CFADS / required DSCR - interest - existing principal) / (rate + 1 / tenor)   (security cover only for secured loans)\nPolicy debt/EBITDA = limit for the BQR band + extra allowance for the loan type\nPro-forma: debt + loan; interest + loan x rate; principal + loan / tenor\nCovenant headroom = (threshold - actual) / threshold for maximums; (actual - threshold) / threshold for minimums\nExpected loss = PD (Ohlson probability) x LGD (by loan type) x EAD (proposed loan)") +
        `<p>Leverage limits are set by the lending institution, so the defaults (by BQR band: 1-2 up to 4.0x debt/EBITDA and 2.0x D/E; 3-4 3.5x and 1.75x; 5-6 3.0x and 1.5x; 7 2.5x and 1.25x; 8 1.75x and 1.0x, secured or senior secured only; 9-10 no fresh lending) are illustrative and editable. The bands are graded so that a weaker borrower can still be financed on a secured basis with less debt, because a lender that turns away every borrower with a weak signal cannot build a loan book. Senior secured loans are allowed 0.5x more leverage with 1.5x asset cover and an assumed LGD of 25%; secured loans 0.25x, 1.25x and 35%; unsecured loans no extra allowance and 45%. Collateral is taken as net fixed assets plus CWIP, and existing borrowings are assumed to share it. Non-financial covenants (prior consent for further borrowing, negative pledge, minimum promoter holding, dividend restriction, restriction on advances to group companies, end-use certification, auditor notification and reporting frequency) are marked as recommended when the borrower's red flags or qualitative factors point to the risk they guard against.</p>`) +
      sec("Red flags", `<p>Core checks: profit up while CFO falls; receivables growing faster than sales; inventory build-up; borrowings growing faster than sales; frequent exceptional items or other income above 25% of PBT; negative CFO. Case checks: revenue growth above 100% (verify subsidiaries and customers), loan-to-equity conversion (share capital up and borrowings down by more than 20% in the same year), loans and advances above 25% of revenue, last-quarter share of annual sales above 32%. Behavioural checks: growth in short-term debt or inventory more than two standard deviations above the company's own history (behavioural velocity), a shift of more than 20 percentage points towards short-term borrowing over two years (a proxy for falling collateral propensity), and profit without cash (liquidity-to-profitability mismatch). Governance: promoter stake down by more than 10 points (red) or 3 points (amber), negative net worth.</p>`) +
      sec("Limitations", `<ul class="list-tight"><li>Screener groups some line items, so current assets and liabilities are approximations; figures may differ from the annual report.</li><li>The thresholds are rules of thumb for screening and are not calibrated on Indian default data.</li><li>The five distress models share leverage and profitability ratios: their variance inflation factors on this universe reach 9.8 (Ohlson), 7.7 (Zmijewski) and 5.9 (Altman). They are therefore averaged within one pillar and are not counted as independent evidence. The five pillar scores have VIFs between 1.5 and 3.7.</li><li>When a company changes its financial year, the transition period (for example 15 or 18 months) is annualised before ratios are computed, and growth rates across that year are approximate.</li>
        <li>The models were estimated on US data (except the AEM and REM coefficients), and their cut-offs may not transfer exactly to Indian firms.</li><li>Conglomerates with lending subsidiaries (for example engineering groups that consolidate a finance arm) show higher leverage and lower DSCR than their operating business.</li>
        <li>Related-party transactions, contingent liabilities, pledged shares, auditor remarks and credit ratings are not in the data and must be checked in the annual report.</li></ul>`) +
      sec("Sources", `<p><b>Data:</b> screener.in company pages (financial statements, quarterly results, shareholding); NSE, Nifty 500 index constituents (nseindia.com); CMIE Prowess dx for the AEM and REM estimation sample.</p>
        <ul class="list-tight small">
        <li>Altman, E. I. (1968). Financial ratios, discriminant analysis and the prediction of corporate bankruptcy. <i>Journal of Finance, 23</i>(4), 589-609.</li>
        <li>Altman, E. I. (2005). An emerging market credit scoring system for corporate bonds. <i>Emerging Markets Review, 6</i>(4), 311-323.</li>
        <li>Beneish, M. D. (1999). The detection of earnings manipulation. <i>Financial Analysts Journal, 55</i>(5), 24-36.</li>
        <li>Benford, F. (1938). The law of anomalous numbers. <i>Proceedings of the American Philosophical Society, 78</i>(4), 551-572.</li>
        <li>Dechow, P. M., Sloan, R. G., &amp; Sweeney, A. P. (1995). Detecting earnings management. <i>The Accounting Review, 70</i>(2), 193-225.</li>
        <li>Dickinson, V. (2011). Cash flow patterns as a proxy for firm life cycle. <i>The Accounting Review, 86</i>(6), 1969-1994.</li>
        <li>Fulmer, J. G., Moon, J. E., Gavin, T. A., &amp; Erwin, M. J. (1984). A bankruptcy classification model for small firms. <i>Journal of Commercial Bank Lending, 66</i>(11), 25-37.</li>
        <li>Kaplan, S. N., &amp; Zingales, L. (1997). Do investment-cash flow sensitivities provide useful measures of financing constraints? <i>Quarterly Journal of Economics, 112</i>(1), 169-215.</li>
        <li>Montier, J. (2008). Cooking the books, or, more sailing under the black flag. <i>Mind Matters</i>, Société Générale.</li>
        <li>Ohlson, J. A. (1980). Financial ratios and the probabilistic prediction of bankruptcy. <i>Journal of Accounting Research, 18</i>(1), 109-131.</li>
        <li>Piotroski, J. D. (2000). Value investing: The use of historical financial statement information to separate winners from losers. <i>Journal of Accounting Research, 38</i>, 1-41.</li>
        <li>Roychowdhury, S. (2006). Earnings management through real activities manipulation. <i>Journal of Accounting and Economics, 42</i>(3), 335-370.</li>
        <li>Sloan, R. G. (1996). Do stock prices fully reflect information in accruals and cash flows about future earnings? <i>The Accounting Review, 71</i>(3), 289-315.</li>
        <li>Springate, G. L. V. (1978). <i>Predicting the possibility of failure in a Canadian firm</i> [Unpublished MBA research project]. Simon Fraser University.</li>
        <li>Zmijewski, M. E. (1984). Methodological issues related to the estimation of financial distress prediction models. <i>Journal of Accounting Research, 22</i>, 59-82.</li></ul>`);
  }

  /* ================= wiring ================= */
  function init() {
    $$(".nav-item").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    $$(".nav-item[data-needs]").forEach((b) => b.classList.add("disabled"));
    $("#coSearch").addEventListener("change", (e) => { const m = e.target.value.match(/\(([^)]+)\)\s*$/); const tk = m ? m[1] : e.target.value.trim().toUpperCase(); if (tk) selectCompany(tk); });
    $("#fySel").addEventListener("change", (e) => { S.t = +e.target.value; renderBorrower(); });
    ["#fInd", "#fGrade", "#fZone"].forEach((s) => $(s).addEventListener("change", () => { S.page = 0; drawTable(); }));
    $("#fText").addEventListener("input", () => { S.page = 0; drawTable(); });
    $("#pgPrev").addEventListener("click", () => { S.page = Math.max(0, S.page - 1); drawTable(); });
    $("#pgNext").addEventListener("click", () => { S.page++; drawTable(); });
    $("#exportCsv").addEventListener("click", exportCsv);
    $("#dlTemplate").addEventListener("click", templateCsv);
    $("#impGo").addEventListener("click", doImport);
    const g = $("#guide");
    let hide = false; try { hide = localStorage.getItem("crm_guide_hide") === "1"; } catch (e) {}
    if (!hide && !location.hash) g.classList.add("open");
    $("#guideBtn").addEventListener("click", () => g.classList.add("open"));
    $("#guideClose").addEventListener("click", () => { g.classList.remove("open"); try { localStorage.setItem("crm_guide_hide", $("#guideHide").checked ? "1" : "0"); } catch (e) {} go("portfolio"); });
    g.addEventListener("click", (e) => { if (e.target === g) g.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") g.classList.remove("open"); });
    window.addEventListener("hashchange", () => { if (S.U) route(); });
    load();
  }
  init();
})();
