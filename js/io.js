/*
 * Import / export helpers. DOM-free so they can be tested in Node.
 * Spreadsheet parsing (SheetJS) is done by the caller; these functions work on
 * plain 2D arrays of cell values.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BRTCIO = factory(root.BRTC);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase();
  const TITLES = new Set(['dr', 'mr', 'ms', 'mrs', 'md', 'prof', 'professor', 'lec', 'lecturer', 'count', 'self', 'status']);

  function tokensOf(person) {
    const names = [person.name, ...String(person.aliases || '').split(/[,;]/)];
    const out = new Set();
    for (const n of names) {
      for (const w of norm(n).replace(/[().\-_/]/g, ' ').split(' ')) {
        if (w.length >= 3 && !TITLES.has(w) && !/^\d+$/.test(w)) out.add(w);
      }
    }
    return [...out];
  }

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Which person does this header talk about? Most matched name letters win; a tie is "ambiguous". */
  function matchPerson(header, people) {
    const h = norm(header).replace(/[().\-_/]/g, ' ');
    let best = 0, hits = [];
    for (const p of people) {
      let score = 0;
      for (const t of tokensOf(p)) if (new RegExp('(^|\\s)' + esc(t) + '(\\s|$)').test(h)) score += t.length;
      if (score > best) { best = score; hits = [p]; }
      else if (score === best && score > 0) hits.push(p);
    }
    if (hits.length === 1) return { person: hits[0] };
    if (hits.length > 1) return { ambiguous: hits.map((p) => p.name) };
    return {};
  }

  const FIELD_RULES = [
    ['date', /^date\b/], ['client', /^client/], ['details', /work details|^details/], ['workType', /^work type/],
    ['bmeRef', /bme ref/], ['brtcRef', /brtc ref/], ['amount', /amount paid|^amount/], ['vat', /^vat/], ['expense', /^expense/],
  ];

  const fmtDate = (v) => {
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() + 12 * 3600e3); // absorb SheetJS time-zone jitter
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    return clean(v);
  };

  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = (rows[i] || []).map(norm);
      if (r.some((c) => /brtc ref/.test(c)) || (r.some((c) => /amount paid|^amount/.test(c)) && r.some((c) => /^vat/.test(c)))) return i;
    }
    return -1;
  }

  /**
   * rows: 2D array. config: {faculty, staff}.
   * Returns { projects, mapping, errors }.
   */
  function parseProjects(rows, config) {
    const hi = findHeaderRow(rows);
    if (hi < 0) return { projects: [], mapping: null, errors: ['No header row found. A "BRTC Ref" or "Amount Paid" column is needed.'] };
    const header = rows[hi];
    const fieldCol = {}, personCols = [], unmatched = [], notes = [];
    const everyone = [
      ...(config.faculty || []).map((p) => ({ ...p, kind: 'faculty' })),
      ...(config.staff || []).map((p) => ({ ...p, kind: 'staff' })),
    ];
    const seen = new Set();
    header.forEach((h, c) => {
      const text = norm(h);
      if (!text) return;
      const hit = FIELD_RULES.find(([, re]) => re.test(text));
      if (hit && !(hit[0] in fieldCol)) { fieldCol[hit[0]] = c; return; }
      const field = /status/.test(text) ? 'status' : /count|self/.test(text) ? 'count' : null;
      if (!field) { unmatched.push({ col: c, header: clean(h), reason: 'not a known column' }); return; }
      const m = matchPerson(h, everyone);
      if (m.ambiguous) { unmatched.push({ col: c, header: clean(h), reason: 'matches several people: ' + m.ambiguous.join(', ') }); return; }
      if (!m.person) { unmatched.push({ col: c, header: clean(h), reason: 'no person with this name (add the name as an alias in People & rates)' }); return; }
      const key = m.person.id + '/' + field;
      if (seen.has(key)) { unmatched.push({ col: c, header: clean(h), reason: `second ${field} column for ${m.person.name}, ignored` }); return; }
      seen.add(key);
      personCols.push({ col: c, header: clean(h), id: m.person.id, name: m.person.name, kind: m.person.kind, field });
    });
    const errors = [];
    for (const need of ['amount']) if (!(need in fieldCol)) errors.push(`Missing column: ${need}`);

    const projects = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = (f) => (f in fieldCol ? row[fieldCol[f]] : '');
      const ref = clean(get('brtcRef'));
      const amt = get('amount');
      // a project needs an identity; a line with only amounts is a sheet total, not a project
      if (!ref && !clean(get('client')) && !clean(get('details'))) continue;
      const p = {
        date: fmtDate(get('date')), client: clean(get('client')), details: clean(get('details')), workType: clean(get('workType')),
        bmeRef: clean(get('bmeRef')), brtcRef: ref,
        amount: E.num(amt), vat: E.num(get('vat')), expense: E.num(get('expense')),
        status: {}, count: {},
      };
      for (const pc of personCols) {
        const cell = row[pc.col];
        if (pc.field === 'status') p.status[pc.id] = clean(cell);
        else p.count[pc.id] = E.num(cell);
      }
      projects.push(p);
    }
    const peopleWithoutCount = everyone.filter((p) => !personCols.some((c) => c.id === p.id && c.field === 'count') && (p.kind === 'staff' || p.inTeam));
    if (peopleWithoutCount.length) notes.push('No count column found for: ' + peopleWithoutCount.map((p) => p.name).join(', ') + ' (their team count is taken as 0).');
    return { projects, mapping: { fieldCol, personCols, unmatched, headerRow: hi }, errors, notes };
  }

  /** Minimal TSV/CSV text to 2D array (handles quoted cells with tabs/newlines). */
  function parseDelimited(text) {
    const delim = text.indexOf('\t') >= 0 ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /** Header row for a blank input template that matches the current roster. */
  function templateHeader(config) {
    const h = ['Date', 'Client Name', 'Work Details', 'Work Type', 'BME Ref. No.', 'BRTC Ref. No.', 'Amount Paid by the Client', 'VAT deducted by BRTC', 'Expenses (Material, Transport, other)'];
    for (const f of config.faculty || []) { h.push(`${f.name} Status`); h.push(`${f.name} Self Count`); }
    for (const s of config.staff || []) h.push(`${s.name} Self Count`);
    return h;
  }

  /** Sheets (as 2D arrays) for the Excel export. */
  function exportSheets(config, projects, res) {
    const fac = config.faculty || [], stf = config.staff || [];
    const facC = fac.filter((f) => f.inCommon), facT = fac.filter((f) => f.inTeam);
    const ref = (r) => [r.brtcRef, r.bmeRef];
    const sheets = {};

    const s = res.summary;
    sheets['Summary'] = [
      ['BRTC distribution summary', config.title || ''],
      [],
      ['Total amount paid by the client', s.totalPaidByClient],
      ['Total expenses', s.totalExpenses],
      ['Total after BUET deduction and expense', s.totalAfterDeductions],
      ['Head account (dept account)', s.headAccount],
      ['Head account with expenses', s.headAccountWithExpenses],
      ['Distributed (people + head account)', s.distributed],
      ['Check (total after deductions minus distributed)', s.roundingCheck],
      [`Approximate deposit to head account (after ${res.rates.brtcTax * 100}% tax)`, s.headDeposit],
      [],
      ['Name', 'Group', 'Common pool', 'Team', 'Total', `Approx. deposit (after ${res.rates.brtcTax * 100}% tax)`],
      ...res.people.map((p) => [p.name, p.kind === 'faculty' ? 'Faculty' : 'Non-teaching', p.common, p.team, p.total, p.deposit]),
    ];

    sheets['Projects (input)'] = [
      templateHeader(config),
      ...projects.map((p) => [
        p.date, p.client, p.details, p.workType, p.bmeRef, p.brtcRef, p.amount, p.vat, p.expense,
        ...fac.flatMap((f) => [(p.status || {})[f.id] || '', (p.count || {})[f.id] || 0]),
        ...stf.map((x) => (p.count || {})[x.id] || 0),
      ]),
    ];

    sheets['Basic Calculation'] = [
      ['BRTC Ref', 'BME Ref', 'Work Type', 'Amount paid', 'VAT', 'Expenses', 'Tk after VAT', 'BUET deduction', 'Tk after BUET deduction and expense',
        'Head account', 'Non-teaching amount', 'Remaining', 'Faculty common pool', 'Faculty team'],
      ...res.rows.map((r) => [...ref(r), r.workType, r.amount, r.vat, r.expense, r.basic.D, r.basic.E, r.basic.F, r.basic.G, r.basic.H, r.basic.I, r.basic.J, r.basic.K]),
      ['Total', '', '', res.totals.amount, res.totals.vat, res.totals.expense, res.totals.D, res.totals.E, res.totals.F, res.totals.G, res.totals.H, res.totals.I, res.totals.J, res.totals.K],
    ];

    const matrix = (title, list, pick, check) => {
      const out = [[...['BRTC Ref', 'BME Ref'], ...list.map((p) => p.name), 'Rounding check']];
      res.rows.forEach((r) => out.push([...ref(r), ...list.map((p) => pick(r)[p.id]), check(r)]));
      out.push(['Total', '', ...list.map((p) => res.rows.reduce((a, r) => a + pick(r)[p.id], 0)), res.rows.reduce((a, r) => a + check(r), 0)]);
      return out;
    };
    sheets['Faculty Common Pool'] = matrix('', facC, (r) => r.facultyCommon, (r) => r.residual.facultyCommon);
    sheets['Faculty Team'] = matrix('', facT, (r) => r.facultyTeam, (r) => r.residual.facultyTeam);
    sheets['Non-teaching Common'] = matrix('', stf, (r) => r.staffCommon, (r) => r.residual.staffCommon);
    sheets['Non-teaching Team'] = matrix('', stf, (r) => r.staffTeam, (r) => r.residual.staffTeam);
    if (res.warnings.length) sheets['Warnings'] = [['Row', 'Message'], ...res.warnings.map((w) => [w.row, w.msg])];
    return sheets;
  }

  return { parseProjects, parseDelimited, templateHeader, exportSheets, matchPerson, tokensOf, findHeaderRow };
});
