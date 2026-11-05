// Compare js/engine.js with every number the original workbook calculated.
// usage: node tools/verify.mjs <extracted.json>   (made by tools/extract_workbook.py)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { calculate } = require('../js/engine.js');

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const res = calculate(data.config, data.projects);
const exp = data.expected;

let checked = 0;
const bad = [];
const eq = (label, got, want, tol = 1e-6) => {
  checked++;
  if (typeof want !== 'number' || Math.abs(got - want) > tol) bad.push(`${label}: engine ${got} vs workbook ${want}`);
};

res.rows.forEach((r, i) => {
  for (const k of 'DEFGHIJK') eq(`row${i + 1} basic.${k}`, r.basic[k], exp.basic[i][k]);
  for (const [id, want] of Object.entries(exp.facultyCommon[i])) eq(`row${i + 1} facultyCommon.${id}`, r.facultyCommon[id], want);
  for (const [id, want] of Object.entries(exp.facultyTeam[i])) eq(`row${i + 1} facultyTeam.${id}`, r.facultyTeam[id], want);
  for (const [id, want] of Object.entries(exp.staffCommon[i])) eq(`row${i + 1} staffCommon.${id}`, r.staffCommon[id], want);
  for (const [id, want] of Object.entries(exp.staffTeam[i])) eq(`row${i + 1} staffTeam.${id}`, r.staffTeam[id], want);
});

const sm = exp.summary;
for (const k of ['totalPaidByClient', 'totalExpenses', 'totalAfterDeductions', 'headAccountWithExpenses', 'headAccount', 'distributed', 'roundingCheck', 'headDeposit']) {
  eq(`summary.${k}`, res.summary[k], sm[k]);
}
const people = Object.fromEntries(res.people.map((p) => [p.id, p]));
for (const [id, want] of Object.entries(sm.people)) eq(`person ${id} total`, people[id].total, want);
for (const [id, want] of Object.entries(sm.deposit)) eq(`person ${id} deposit`, people[id].deposit, want);

console.log(`${res.rows.length} projects, ${checked} numbers compared with the workbook`);
if (bad.length) {
  console.log(`${bad.length} MISMATCHES`);
  bad.slice(0, 40).forEach((b) => console.log('  ' + b));
  process.exit(1);
}
console.log('ALL MATCH');
console.log('warnings from engine:', res.warnings.length ? res.warnings.map((w) => w.msg) : 'none');
