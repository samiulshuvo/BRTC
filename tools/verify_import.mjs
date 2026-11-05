// Read the real workbook's "Form Responses 1" sheet with SheetJS, run it through js/io.js and
// check the parsed projects equal the ones extract_workbook.py read cell by cell.
// usage: node tools/verify_import.mjs <workbook.xlsx> <extracted.json>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.full.min.js');
const IO = require('../js/io.js');

const [, , xlsxPath, jsonPath] = process.argv;
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Form Responses 1'], { header: 1, raw: true, defval: '' });
const out = IO.parseProjects(rows, data.config);

const bad = [];
if (out.errors.length) bad.push('errors: ' + out.errors.join('; '));
if (out.mapping.unmatched.length) bad.push('unmatched headers: ' + JSON.stringify(out.mapping.unmatched));
if (out.projects.length !== data.projects.length) bad.push(`project count ${out.projects.length} vs ${data.projects.length}`);
let compared = 0;
out.projects.forEach((p, i) => {
  const want = data.projects[i];
  for (const k of ['brtcRef', 'bmeRef', 'workType', 'client', 'amount', 'vat', 'expense']) {
    compared++;
    if (String(p[k]) !== String(want[k])) bad.push(`project ${i + 1} ${k}: ${p[k]} vs ${want[k]}`);
  }
  for (const [id, st] of Object.entries(want.status)) { compared++; if ((p.status[id] || '') !== st) bad.push(`project ${i + 1} status ${id}: ${p.status[id]} vs ${st}`); }
  for (const [id, c] of Object.entries(want.count)) { compared++; if ((p.count[id] || 0) !== Number(c)) bad.push(`project ${i + 1} count ${id}: ${p.count[id]} vs ${c}`); }
});
console.log(`mapped ${out.mapping.personCols.length} person columns, ${out.projects.length} projects, ${compared} fields compared`);
out.notes.forEach((n) => console.log('note:', n));
if (bad.length) { console.log(bad.length + ' PROBLEMS'); bad.slice(0, 30).forEach((b) => console.log('  ' + b)); process.exit(1); }
console.log('IMPORT MATCHES');
