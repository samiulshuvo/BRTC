// Run with: node --test tests/
// Hand-checked numbers (no real data). The full workbook parity check is tools/verify.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, excelRound, basic, DEFAULT_RATES } = require('../js/engine.js');
const IO = require('../js/io.js');

test('excelRound matches Excel ROUND(x,0)', () => {
  assert.equal(excelRound(2.5), 3);
  assert.equal(excelRound(0.5), 1);
  assert.equal(excelRound(-2.5), -3);
  assert.equal(excelRound(8260.9), 8261);
  assert.equal(excelRound(413.05), 413);
  assert.equal(excelRound(1.005 * 1000 - 1004.5 + 0.5), 1); // float noise around .5 resolves like Excel
});

test('basic calculation for a Test project (30000 paid, 3913 VAT, 10000 expenses)', () => {
  const b = basic(DEFAULT_RATES, { workType: 'Test', amount: 30000, vat: 3913, expense: 10000 });
  assert.equal(b.D, 26087);
  assert.ok(Math.abs(b.E - 7826.1) < 1e-9);
  assert.equal(b.F, 8261);
  assert.equal(b.G, 413);
  assert.equal(b.H, 991);
  assert.equal(b.I, 6857);
  assert.equal(b.J, 3428.5);
  assert.equal(b.K, 3428.5);
});

test('work type match ignores case; unknown types use the "other" rate', () => {
  const t = basic(DEFAULT_RATES, { workType: 'test', amount: 1000, vat: 0, expense: 0 });
  const o = basic(DEFAULT_RATES, { workType: 'Training', amount: 1000, vat: 0, expense: 0 });
  assert.equal(t.F, 700);   // 30% deduction
  assert.equal(o.F, 805);   // 19.5% deduction
  assert.equal(t.typeMatched, true);
  assert.equal(o.typeMatched, false);
});

const cfg = {
  faculty: [
    { id: 'a', name: 'A', wf: 1, inCommon: true, inTeam: true },
    { id: 'b', name: 'B', wf: 1, inCommon: true, inTeam: true },
    { id: 'c', name: 'C', wf: 0.5, inCommon: false, inTeam: true },
  ],
  staff: [
    { id: 's1', name: 'S1', wf: 0.5 },
    { id: 's2', name: 'S2', wf: 0.5, commonFrom: 2 },
  ],
};

test('Head weighting in the common pool, team split by count x WF', () => {
  const p = { workType: 'Test', amount: 10000, vat: 0, expense: 0, status: { a: 'head' }, count: { a: 0, b: 1, c: 1, s1: 1, s2: 0 } };
  const r = calculate(cfg, [p]).rows[0];
  const { J, K } = r.basic;
  // A is Head (2.25), B is 1: A gets 2.25/3.25 of J
  assert.equal(r.facultyCommon.a, excelRound((2.25 / 3.25) * J));
  assert.equal(r.facultyCommon.b, excelRound((1 / 3.25) * J));
  assert.equal(r.facultyCommon.c, 0); // not in the common pool
  // team: B 1x1, C 1x0.5 -> 2/3 and 1/3 of K
  assert.equal(r.facultyTeam.b, excelRound((1 / 1.5) * K));
  assert.equal(r.facultyTeam.c, excelRound((0.5 / 1.5) * K));
  assert.equal(r.facultyTeam.a, 0);
});

test('a staff member who joins the common pool later is left out of earlier projects', () => {
  const base = { workType: 'Test', amount: 10000, vat: 0, expense: 0, status: {}, count: { s1: 1 } };
  const res = calculate(cfg, [base, base]);
  assert.equal(res.rows[0].staffCommon.s2, 0);      // project 1: s2 not yet in the pool, s1 takes the whole pool
  assert.equal(res.rows[0].staffCommon.s1, excelRound(res.rows[0].basic.H * 0.5));
  assert.ok(res.rows[1].staffCommon.s2 > 0);         // project 2: s2 in the pool
});

test('empty pools pay nothing and raise warnings instead of dividing by zero', () => {
  const p = { workType: 'Test', amount: 10000, vat: 0, expense: 0, status: {}, count: {} };
  const res = calculate(cfg, [p]);
  assert.equal(res.rows[0].facultyTeam.a + res.rows[0].facultyTeam.b + res.rows[0].facultyTeam.c, 0);
  assert.ok(res.warnings.some((w) => /no faculty team member/.test(w.msg)));
  assert.ok(res.warnings.some((w) => /no non-teaching team member/.test(w.msg)));
});

test('summary check equals total after deductions minus what was distributed', () => {
  const p = { workType: 'Test', amount: 30000, vat: 3913, expense: 10000, status: {}, count: { a: 1, b: 1, s1: 1 } };
  const res = calculate(cfg, [p, p]);
  const sum = res.people.reduce((a, x) => a + x.total, 0) + res.totals.G;
  assert.equal(res.summary.distributed, sum);
  assert.equal(res.summary.roundingCheck, res.totals.F - sum);
  assert.equal(res.summary.headAccountWithExpenses, res.totals.expense + res.totals.G);
});

test('header matching: longest name wins, ties are reported, aliases work', () => {
  const people = [
    { id: '1', name: 'Mr Md Abdul Bashar', aliases: '' },
    { id: '2', name: 'Nr. Abdul Karim', aliases: '' },
    { id: '3', name: 'Mr Md Nur Alam', aliases: 'Rafiq' },
  ];
  assert.equal(IO.matchPerson('Mr Abdul Karim Count (if works in team only)', people).person.id, '2');
  assert.equal(IO.matchPerson('Mr Bashar Self Count', people).person.id, '1');
  assert.equal(IO.matchPerson('Mr Rafiq Count', people).person.id, '3');
  assert.ok(IO.matchPerson('Abdul Count', people).ambiguous);
  assert.deepEqual(IO.matchPerson('Someone else Count', people), {});
});

test('parseProjects reads a pasted sheet and skips a totals line', () => {
  const rows = IO.parseDelimited(
    'Date\tClient Name\tBRTC Ref. No.\tAmount Paid by the Client\tVAT deducted by BRTC\tExpenses\tAlpha Self Count\tAlpha Status\n' +
    '2025-11-02\tAcme\tR-1\t30,000\t3913\t10000\t1\tHead\n' +
    '\t\t\t30000\t\t10000\t\t\n');
  const out = IO.parseProjects(rows, { faculty: [{ id: 'a', name: 'Alpha', inTeam: true }], staff: [] });
  assert.equal(out.projects.length, 1);
  assert.equal(out.projects[0].amount, 30000);
  assert.equal(out.projects[0].count.a, 1);
  assert.equal(out.projects[0].status.a, 'Head');
});

test('parseDelimited handles quoted cells', () => {
  assert.deepEqual(IO.parseDelimited('a,"b,c",d\n1,2,3'), [['a', 'b,c', 'd'], ['1', '2', '3']]);
});
