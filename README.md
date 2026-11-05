# BRTC Calculator

A small web page that works out how BRTC test and consultancy income is shared inside a department:
what the BUET deduction takes, what goes to the head account, the non-teaching staff, the faculty common pool and the project teams, and what each person ends up with.

It is a plain static site (HTML, CSS, JavaScript). There is no server and nothing is uploaded: the numbers you enter stay in your browser (and in files you choose to export).

## Use it

Open `index.html`, or the GitHub Pages address of this repository.

1. **People & rates**: set the weighting factors (WF) of each person (pick a position or type your own), the rates for each work type, and the head account share. The page opens with invented demo data.
2. **Projects**: one row per BRTC payment (amount, VAT, expenses). Press **Team** on a row to say who worked on it and who was Head. A **Spreadsheet** layout shows every column at once. Or use **Import / export** to load the Google Form response sheet (`.xlsx`/`.csv`) by dropping the file in, or paste rows from a spreadsheet.
3. **Results**: amount per person (with each person's share of the total), the split of every payment, and the per-person-per-project tables. Warnings link straight to the row to fix. Print it, or download Excel or CSV.

Your work is saved automatically in the browser. Use **Save everything as a JSON file** to keep a copy of each period or to move to another computer.

## The calculation

For every project (amounts in taka, `ROUND` is Excel's, halves away from zero):

```
After VAT (D)        = Amount paid - VAT
BUET deduction (E)   = rate x D                       Test 30%, other work 19.5% (editable)
Distributable (F)    = ROUND(Amount - VAT - Expenses - E)
Head account (G)     = ROUND(F x 5%)
Non-teaching (H)     = ROUND(F x 12% for Test, 6% otherwise)
Remaining (I)        = F - G - H
Faculty common (J)   = 50% x I                        (not rounded)
Faculty team (K)     = I - J

Faculty common share = ROUND( WF / sum(WF of pool members) x J )      the Head that month counts 2.25
Faculty team share   = ROUND( count x WF / sum(count x WF) x K )
Non-teaching common  = ROUND( H x 50% x WF / sum(WF of pool members) )
Non-teaching team    = ROUND( H x 50% x count x WF / sum(count x WF) )
Approx. deposit      = total x (1 - 15%)
```

Each share is rounded separately, so the parts can differ from the total by a few taka. The page shows that difference as the **rounding difference** (the workbook's "Check" cell). It does not hide it.

If a pool has nobody in it, or every count is zero, it pays nothing and the page raises a warning so the money is not lost silently.

### Things to know about the rules it copies

* The "Professor & Head" factor in the workbook's table is 2.5, but the formulas use **2.25**. This page uses 2.25 (editable) because that is what produced the workbook's numbers.
* A person's **status** only matters when it equals the Head text (`Head`). Other codes (`PC`, `APC`, `PC+PT`...) are kept for your records.
* In the source workbook one staff member joins the common pool from the 6th project, and one faculty member and one lecturer are outside the faculty common pool. These are the **Pool from project #** and **Common pool** settings.

## Accuracy checks

`tools/verify.mjs` recomputes a complete workbook with `js/engine.js` and compares **every** number the workbook calculated (per project, per person, per pool, and the summary): 1,178 values for the Nov'25 to Feb'26 BME workbook, all identical. `tools/verify_import.mjs` checks that importing the form sheet gives the same inputs, and a mutation test (a deliberately wrong rate) is caught by it.

```
python tools/extract_workbook.py "<workbook.xlsx>" out.json     # needs openpyxl
node tools/verify.mjs out.json
node tools/verify_import.mjs "<workbook.xlsx>" out.json
node --test "tests/*.test.js"                                   # hand-checked unit tests
```

`extract_workbook.py` is written for the v2 layout of the BME workbook. For another department's workbook, adapt the cell references at the top of that script.

## Privacy

The repository contains only invented demo data. Real workbooks, names and amounts are never committed; load them in the page and keep any saved JSON private.

## Third-party

`vendor/xlsx.full.min.js` is [SheetJS](https://sheetjs.com) community edition 0.18.5 (Apache-2.0, see `vendor/LICENSE-xlsx.txt`), used to read and write `.xlsx` files in the browser.
