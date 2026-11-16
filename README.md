# Credit Risk Monitor

A credit analyst's dashboard for the non-financial companies of the Nifty 500. For each borrower it assesses liquidity, solvency and debt capacity, runs five distress models, tests earnings quality and applies rule-based red flags drawn from Indian fraud and default cases. The results are combined into an internal credit watch grade (CW1 Strong to CW5 Critical) and a Borrower Quality Rating (BQR 1 to 10) that blends the numbers (60%) with a qualitative scorecard (40%).

## Using the dashboard

Open the site and follow the guide that appears on first visit. In short:

1. **Portfolio monitor** ranks every borrower by grade. Filter by industry, grade or Altman zone and click a row.
2. **Credit summary** gives the grade, the five pillar scores, an analyst note and questions for management.
3. **Liquidity**, **Solvency and debt capacity**, **Distress models**, **Earnings quality** and **Red flags** hold the detailed workings for the selected financial year.
4. **Peer benchmarking** places the borrower within its industry (Peer Group Anomaly Index).
5. **Import statements** analyses any other company from a CSV exported from Prowess, Bloomberg or an annual report.
6. **Methodology and sources** documents every formula, threshold and data definition.

## Data

| Source | Used for |
|---|---|
| screener.in company pages | Annual statements (up to 12 years), quarterly results, shareholding, line-item breakdowns |
| NSE Nifty 500 constituent list | Coverage universe and industry classification |
| CMIE Prowess dx (FY2024 cross-section) | Estimation of the modified Jones (AEM) and Roychowdhury (REM) coefficients |

Banks, NBFCs and insurers (the "Financial Services" industry) are excluded because the distress and manipulation models are not defined for financial companies.

The data refreshes every Sunday through the GitHub Actions workflow in `.github/workflows/refresh-data.yml`. It can also be run on demand from the Actions tab ("Run workflow").

## Files

| File | Purpose |
|---|---|
| `index.html`, `assets/style.css`, `assets/app.js` | The website |
| `assets/models.js` | All calculations. The same file runs in the browser and in the build step, so the portfolio table and borrower pages always agree |
| `fetch_screener.py` | Downloads statements for every company into `data/companies/` |
| `build_summary.js` | Scores every company and writes `data/universe.json` |
| `tests/dashboard_checks.js` | 14 checks: source data, ratios and models recomputed independently, grade and BQR arithmetic, BQR balance and differentiation, loan sizing, covenants, text |
| `tests/validate_course_examples.js`, `tests/crosscheck_python.py` | Worked examples reproduced, and an independent Python recomputation |

## Running locally

```bash
pip install beautifulsoup4
python3 fetch_screener.py          # full refresh, about two hours; resumable
node build_summary.js
python3 -m http.server 8765        # then open http://localhost:8765
```

`python3 fetch_screener.py TCS INFY` refreshes named companies only.

`node tests/dashboard_checks.js` runs the validation suite after a rebuild.

## Limitations

Screener groups some balance sheet items, so current assets and current liabilities are approximations. The thresholds are screening rules of thumb and are not calibrated on Indian default data. Related-party transactions, contingent liabilities, pledged shares, auditor remarks and agency ratings are not in the data and must be checked in the annual report. The grade is an internal screening score, not a credit rating.
