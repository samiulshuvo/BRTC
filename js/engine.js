/*
 * BRTC distribution engine.
 * Pure functions, no DOM. Works in the browser (window.BRTC) and in Node (module.exports).
 *
 * The arithmetic (order of operations and where ROUND is applied) mirrors the
 * departmental BRTC workbook so results match it to the taka.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BRTC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Excel ROUND(x, 0): half away from zero, evaluated on the 15 significant digits Excel keeps. */
  function excelRound(x) {
    if (!isFinite(x)) return 0;
    const ax = Math.abs(Number(x.toPrecision(15)));
    return (x < 0 ? -1 : 1) * Math.floor(ax + 0.5);
  }

  const num = (v) => {
    if (v === '' || v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  };
  const ieq = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();

  const DEFAULT_RATES = {
    workTypes: [{ name: 'Test', buetDeduction: 0.3, nonTeachingShare: 0.12 }],
    other: { buetDeduction: 0.195, nonTeachingShare: 0.06 },
    headAccount: 0.05,
    commonPoolShare: 0.5,
    nonTeachingCommonShare: 0.5,
    headWF: 2.25,
    headStatus: 'Head',
    brtcTax: 0.15,
  };

  function rateFor(rates, workType) {
    const hit = (rates.workTypes || []).find((w) => ieq(w.name, workType));
    return hit ? { ...hit, matched: true } : { ...rates.other, name: workType, matched: false };
  }

  /** Step 1: money left for distribution (sheet "Basic Calculation"). */
  function basic(rates, p) {
    const r = rateFor(rates, p.workType);
    const amount = num(p.amount), vat = num(p.vat), expense = num(p.expense);
    const D = amount - vat;
    const E = r.buetDeduction * D;
    const F = excelRound(amount - vat - expense - E);
    const G = excelRound(F * rates.headAccount);
    const H = excelRound(F * r.nonTeachingShare);
    const I = F - G - H;
    const J = rates.commonPoolShare * I;
    const K = I - J;
    return { D, E, F, G, H, I, J, K, typeMatched: r.matched };
  }

  /** Split `pool` in proportion to `weights` (array of numbers, null = not a member of the pool). */
  function shares(pool, weights) {
    let total = 0;
    for (const w of weights) if (w !== null) total += w;
    const out = weights.map((w) => {
      if (w === null) return 0;
      return total > 0 ? excelRound((w / total) * pool) : 0;
    });
    return { out, total };
  }

  const byId = (list, vals) => Object.fromEntries(list.map((x, i) => [x.id, vals[i]]));

  function calculate(config, projects) {
    const rates = { ...DEFAULT_RATES, ...(config.rates || {}) };
    const faculty = config.faculty || [];
    const staff = config.staff || [];
    const warnings = [];
    const seenRef = {};
    const isHead = (st) => !!st && ieq(st, rates.headStatus);

    const rows = projects.map((p, idx) => {
      const n = idx + 1;
      const b = basic(rates, p);
      const label = p.brtcRef || `#${n}`;
      if (!b.typeMatched) warnings.push({ row: n, msg: `${label}: work type "${p.workType || ''}" is not in the rate table, default rate used.` });
      if (p.brtcRef) {
        if (seenRef[p.brtcRef]) warnings.push({ row: n, msg: `${label}: BRTC ref repeated (also row ${seenRef[p.brtcRef]}).` });
        seenRef[p.brtcRef] = n;
      }
      if (b.F < 0) warnings.push({ row: n, msg: `${label}: amount after deductions is negative (${b.F}).` });
      if (num(p.vat) > num(p.amount)) warnings.push({ row: n, msg: `${label}: VAT is larger than the amount paid.` });

      // Faculty common pool: weight = Head factor if Head in this project, else the person's own WF.
      const fcW = faculty.map((f) => {
        if (!f.inCommon || n < (f.commonFrom || 1)) return null;
        return isHead((p.status || {})[f.id]) ? num(rates.headWF) : num(f.wf);
      });
      const headCount = faculty.filter((f) => isHead((p.status || {})[f.id])).length;
      if (headCount > 1) warnings.push({ row: n, msg: `${label}: more than one faculty marked ${rates.headStatus}.` });
      const fc = shares(b.J, fcW);
      if (fc.total === 0 && b.J !== 0) warnings.push({ row: n, msg: `${label}: nobody is in the faculty common pool, ${b.J} unallocated.` });

      // Faculty team: Final Factor = self count x WF.
      const ftF = faculty.map((f) => (f.inTeam ? num((p.count || {})[f.id]) * num(f.wf) : null));
      const ft = shares(b.K, ftF);
      if (ft.total === 0 && b.K !== 0) warnings.push({ row: n, msg: `${label}: no faculty team member has a count, team amount ${b.K} unallocated.` });

      // Non-teaching: the non-teaching amount is split between a common pool and a team pool.
      const ntCommonPool = b.H * rates.nonTeachingCommonShare;
      const ntTeamPool = b.H * (1 - rates.nonTeachingCommonShare);
      const scW = staff.map((s) => (n < (s.commonFrom || 1) ? null : num(s.wf)));
      const sc = shares(ntCommonPool, scW);
      const stF = staff.map((s) => num((p.count || {})[s.id]) * num(s.wf));
      const st = shares(ntTeamPool, stF);
      if (st.total === 0 && b.H !== 0) warnings.push({ row: n, msg: `${label}: no non-teaching team member has a count, ${ntTeamPool} unallocated.` });

      const sumOf = (a) => a.reduce((x, y) => x + y, 0);
      return {
        n, brtcRef: p.brtcRef, bmeRef: p.bmeRef, client: p.client, workType: p.workType, date: p.date, details: p.details,
        amount: num(p.amount), vat: num(p.vat), expense: num(p.expense),
        basic: b,
        facultyCommon: byId(faculty, fc.out), facultyTeam: byId(faculty, ft.out),
        facultyCommonWeight: byId(faculty, fcW), facultyTeamFF: byId(faculty, ftF),
        staffCommon: byId(staff, sc.out), staffTeam: byId(staff, st.out),
        staffTeamFF: byId(staff, stF),
        // what was handed out minus what the pool held (rounding drift, shown as the workbook's "Check")
        residual: {
          facultyCommon: sumOf(fc.out) - b.J,
          facultyTeam: sumOf(ft.out) - b.K,
          staffCommon: sumOf(sc.out) - ntCommonPool,
          staffTeam: sumOf(st.out) - ntTeamPool,
        },
      };
    });

    const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0);
    const people = [
      ...faculty.map((f) => {
        const common = sum((r) => r.facultyCommon[f.id]);
        const team = sum((r) => r.facultyTeam[f.id]);
        return { id: f.id, name: f.name, kind: 'faculty', common, team, total: common + team };
      }),
      ...staff.map((s) => {
        const common = sum((r) => r.staffCommon[s.id]);
        const team = sum((r) => r.staffTeam[s.id]);
        return { id: s.id, name: s.name, kind: 'staff', common, team, total: common + team };
      }),
    ].map((p) => ({ ...p, deposit: p.total * (1 - rates.brtcTax) }));

    const totals = {
      amount: sum((r) => r.amount), vat: sum((r) => r.vat), expense: sum((r) => r.expense),
      D: sum((r) => r.basic.D), E: sum((r) => r.basic.E), F: sum((r) => r.basic.F), G: sum((r) => r.basic.G),
      H: sum((r) => r.basic.H), I: sum((r) => r.basic.I), J: sum((r) => r.basic.J), K: sum((r) => r.basic.K),
    };
    const distributed = people.reduce((a, p) => a + p.total, 0) + totals.G;
    const summary = {
      totalPaidByClient: totals.amount,
      totalExpenses: totals.expense,
      totalAfterDeductions: totals.F,
      headAccount: totals.G,
      headAccountWithExpenses: totals.expense + totals.G,
      distributed,
      roundingCheck: totals.F - distributed, // the workbook's Check cell: total after deductions minus everything handed out
      headDeposit: totals.F * (1 - rates.brtcTax),
    };
    return { rows, people, totals, summary, warnings, rates };
  }

  return { calculate, basic, shares, excelRound, num, DEFAULT_RATES, rateFor };
});
