(function () {
  'use strict';
  const E = window.BRTC, IO = window.BRTCIO;
  const KEY = 'brtc-calculator-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmt = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '');
  const sgn = (n) => (n > 0 ? '+' : '') + fmt(n);
  const pct = (f) => Number((f * 100).toPrecision(10)); // 0.195 -> 19.5 without float noise
  const frac = (p) => Number((p / 100).toPrecision(12));

  // ---------------------------------------------------------------- state
  let state;
  let isDemo = false;
  function normalise(s) {
    const c = s.config || {};
    c.rates = { ...clone(E.DEFAULT_RATES), ...(c.rates || {}) };
    c.rates.workTypes = c.rates.workTypes || [];
    c.rates.other = c.rates.other || { buetDeduction: 0.195, nonTeachingShare: 0.06 };
    c.faculty = (c.faculty || []).map((f) => ({ inCommon: true, inTeam: true, commonFrom: 1, aliases: '', wf: 1, ...f }));
    c.staff = (c.staff || []).map((x) => ({ commonFrom: 1, aliases: '', wf: 0.25, ...x }));
    c.title = c.title || '';
    return { config: c, projects: (s.projects || []).map((p) => ({ status: {}, count: {}, ...p })), demo: !!s.demo };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalise(JSON.parse(raw));
    } catch (e) { /* private window or blocked storage: start from the demo */ }
    return null;
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify({ ...state, demo: isDemo })); } catch (e) { /* storage unavailable */ }
    }, 250);
  }
  function useDemo() { state = normalise(clone(window.BRTC_DEMO)); isDemo = true; }
  function markReal() { if (isDemo) { isDemo = false; $('#demo-banner').hidden = true; } }

  function nextId(prefix) {
    const used = new Set([...state.config.faculty, ...state.config.staff].map((x) => x.id));
    let i = 1;
    while (used.has(prefix + i)) i++;
    return prefix + i;
  }

  // ---------------------------------------------------------------- tabs
  let currentTab = 'projects';
  function setTab(t) {
    currentTab = t;
    $('#demo-banner').hidden = !isDemo;
    $$('nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('section.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
    if (t === 'projects') renderProjects();
    if (t === 'people') renderPeople();
    if (t === 'results') renderResults();
    if (t === 'data') renderData();
    window.scrollTo({ top: 0 });
  }
  $$('nav button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------------------------------------------------------------- live bar + row flags
  let calcTimer;
  function scheduleCalc() { clearTimeout(calcTimer); calcTimer = setTimeout(updateBar, 120); save(); }
  function updateBar() {
    const res = E.calculate(state.config, state.projects);
    const s = res.summary;
    const warnRows = new Set(res.warnings.map((w) => w.row));
    $$('#ptable tbody tr').forEach((tr) => tr.classList.toggle('warn', warnRows.has(Number(tr.dataset.row))));
    $('#bar').innerHTML =
      `<span>Projects <b>${state.projects.length}</b></span>` +
      `<span>Paid by clients <b>${fmt(s.totalPaidByClient)}</b></span>` +
      `<span>After deductions <b>${fmt(s.totalAfterDeductions)}</b></span>` +
      `<span>Distributed <b>${fmt(s.distributed)}</b></span>` +
      `<span>Rounding difference <b>${sgn(s.roundingCheck)}</b></span>` +
      (res.warnings.length ? `<span class="bad">Warnings <b>${res.warnings.length}</b></span>` : '');
    return res;
  }

  // ---------------------------------------------------------------- 1. projects
  function blankProject() {
    const t = state.config.rates.workTypes[0];
    return { date: new Date().toISOString().slice(0, 10), client: '', details: '', workType: t ? t.name : '', bmeRef: '', brtcRef: '', amount: '', vat: '', expense: '', status: {}, count: {} };
  }
  function renderProjects() {
    const { faculty, staff } = state.config;
    const root = $('#tab-projects');
    let h = `<div class="card"><h2>Projects</h2>
      <p class="muted small">One row per BRTC payment. Money columns are in taka. For each person, <b>Count</b> is their share of work in the team pool (0 if not on the team) and <b>Status</b> is only used to spot who is Head that month.</p>
      <div class="toolbar"><button class="primary" id="add-row">+ Add project</button>
      <span class="muted small">Tip: paste rows copied from a spreadsheet in <b>Import / export</b>.</span></div>
      <div class="wrap"><table class="grid" id="ptable"><thead><tr class="grp"><th rowspan="2">#</th><th colspan="9">Project</th>`;
    faculty.forEach((f) => { h += `<th colspan="2">${esc(f.name)}</th>`; });
    if (staff.length) h += `<th colspan="${staff.length}">Non-teaching team count</th>`;
    h += `<th rowspan="2"></th></tr><tr>`;
    ['Date', 'Client', 'Work details', 'Work type', 'BME ref', 'BRTC ref', 'Amount paid', 'VAT', 'Expenses'].forEach((t) => { h += `<th>${t}</th>`; });
    faculty.forEach(() => { h += '<th>Status</th><th>Count</th>'; });
    staff.forEach((s) => { h += `<th>${esc(s.name)}</th>`; });
    h += '</tr></thead><tbody>';
    state.projects.forEach((p, i) => { h += rowHtml(p, i); });
    h += '</tbody></table></div>';
    if (!state.projects.length) h += '<p class="muted">No projects yet. Add one, or import from a spreadsheet.</p>';
    h += '</div>';
    root.innerHTML = h;
    $('#dl-types').innerHTML = state.config.rates.workTypes.map((w) => `<option value="${esc(w.name)}">`).join('');
    updateBar();
  }
  function rowHtml(p, i) {
    const { faculty, staff } = state.config;
    const t = (f, cls, extra = '') => `<td><input class="${cls}" data-f="${f}" value="${esc(p[f])}" ${extra}></td>`;
    let h = `<tr data-row="${i + 1}"><td class="n">${i + 1}</td>`;
    h += t('date', 'w-date') + t('client', 'w-text') + t('details', 'w-text') + t('workType', 'w-text', 'list="dl-types"');
    h += t('bmeRef', 'w-text') + t('brtcRef', 'w-text');
    h += ['amount', 'vat', 'expense'].map((f) => `<td><input class="w-num" inputmode="decimal" data-f="${f}" value="${esc(p[f])}"></td>`).join('');
    faculty.forEach((f) => {
      h += `<td><input class="w-text" style="min-width:4.5rem" list="dl-status" data-t="s" data-id="${f.id}" value="${esc((p.status || {})[f.id] || '')}"></td>`;
      h += `<td><input class="w-num" inputmode="decimal" data-t="c" data-id="${f.id}" value="${esc((p.count || {})[f.id] ?? '')}"></td>`;
    });
    staff.forEach((s) => { h += `<td><input class="w-num" inputmode="decimal" data-t="c" data-id="${s.id}" value="${esc((p.count || {})[s.id] ?? '')}"></td>`; });
    h += `<td style="white-space:nowrap"><button class="icon" title="Duplicate row" data-act="dup">⧉</button> <button class="icon danger" title="Delete row" data-act="del">✕</button></td></tr>`;
    return h;
  }
  $('#tab-projects').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT') return;
    const tr = el.closest('tr[data-row]');
    if (!tr) return;
    const p = state.projects[Number(tr.dataset.row) - 1];
    markReal();
    if (el.dataset.t === 's') (p.status = p.status || {})[el.dataset.id] = el.value;
    else if (el.dataset.t === 'c') (p.count = p.count || {})[el.dataset.id] = el.value;
    else p[el.dataset.f] = el.value;
    scheduleCalc();
  });
  $('#tab-projects').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'add-row') { markReal(); state.projects.push(blankProject()); renderProjects(); save(); const rows = $$('#ptable tbody tr'); rows[rows.length - 1]?.scrollIntoView({ block: 'center' }); return; }
    const tr = b.closest('tr[data-row]');
    if (!tr) return;
    const i = Number(tr.dataset.row) - 1;
    if (b.dataset.act === 'dup') { state.projects.splice(i + 1, 0, clone(state.projects[i])); renderProjects(); save(); }
    if (b.dataset.act === 'del' && confirm(`Delete project ${i + 1}${state.projects[i].brtcRef ? ' (' + state.projects[i].brtcRef + ')' : ''}?`)) { state.projects.splice(i, 1); renderProjects(); save(); }
  });

  // ---------------------------------------------------------------- 2. people and rates
  function renderPeople() {
    const c = state.config, r = c.rates;
    const num = (path, label, v, extra = '') => `<label>${label}<input type="number" step="any" data-path="${path}" ${extra} value="${v}"></label>`;
    let h = `<div class="card"><h2>Rates</h2>
      <p class="muted small">Percentages are entered as percent (30 means 30%).</p>
      <div class="form-grid">
        <label>Title (shown on exports)<input data-path="title" value="${esc(c.title)}"></label>
        ${num('rates.headAccount', 'Head / dept account share of distributable amount (%)', pct(r.headAccount), 'data-pct="1"')}
        ${num('rates.commonPoolShare', 'Faculty common pool share of what remains (%)', pct(r.commonPoolShare), 'data-pct="1"')}
        ${num('rates.nonTeachingCommonShare', 'Non-teaching: share going to the common pool (%)', pct(r.nonTeachingCommonShare), 'data-pct="1"')}
        ${num('rates.headWF', 'Weight factor of the Head in the common pool', r.headWF)}
        <label>Status text that means Head<input data-path="rates.headStatus" value="${esc(r.headStatus)}"></label>
        ${num('rates.brtcTax', 'BRTC tax used for the approximate deposit (%)', pct(r.brtcTax), 'data-pct="1"')}
      </div>
      <h3>Rates by work type</h3>
      <p class="muted small">The work type typed in a project row is matched here (not case sensitive). Anything not listed uses the "all other types" row.</p>
      <div class="wrap" style="max-height:none"><table class="num"><thead><tr><th class="l">Work type</th><th>BUET deduction (%)</th><th>Non-teaching share (%)</th><th></th></tr></thead><tbody>`;
    r.workTypes.forEach((w, i) => {
      h += `<tr><td class="l"><input data-wt="${i}" data-f="name" value="${esc(w.name)}"></td>
        <td><input type="number" step="any" data-wt="${i}" data-f="buetDeduction" value="${pct(w.buetDeduction)}"></td>
        <td><input type="number" step="any" data-wt="${i}" data-f="nonTeachingShare" value="${pct(w.nonTeachingShare)}"></td>
        <td><button class="icon danger" data-act="wt-del" data-i="${i}">✕</button></td></tr>`;
    });
    h += `<tr><td class="l"><i>all other types</i></td>
        <td><input type="number" step="any" data-path="rates.other.buetDeduction" data-pct="1" value="${pct(r.other.buetDeduction)}"></td>
        <td><input type="number" step="any" data-path="rates.other.nonTeachingShare" data-pct="1" value="${pct(r.other.nonTeachingShare)}"></td><td></td></tr>
      </tbody></table></div>
      <p><button id="wt-add">+ Add work type</button></p></div>`;

    h += `<div class="card"><h2>Faculty</h2>
      <p class="muted small"><b>WF</b> is the weighting factor (e.g. Professor 1, Associate 0.9, Assistant 0.8, Lecturer 0.7). <b>Common pool</b>: takes part in the common pool. <b>Team</b>: can be given a team count. <b>Pool from project #</b>: joins the common pool from that project onward (1 = from the start).
      <b>Aliases</b> are other spellings used in spreadsheet headers (comma separated), so the importer can find the right columns.</p>
      <div class="wrap" style="max-height:none"><table class="num"><thead><tr><th class="l">Name</th><th>WF</th><th>Common pool</th><th>Team</th><th>Pool from project #</th><th class="l">Aliases</th><th></th></tr></thead><tbody>`;
    c.faculty.forEach((f, i) => {
      h += `<tr><td class="l"><input data-list="faculty" data-i="${i}" data-f="name" value="${esc(f.name)}"></td>
        <td><input type="number" step="any" style="width:5rem" data-list="faculty" data-i="${i}" data-f="wf" value="${f.wf}"></td>
        <td style="text-align:center"><input type="checkbox" data-list="faculty" data-i="${i}" data-f="inCommon" ${f.inCommon ? 'checked' : ''}></td>
        <td style="text-align:center"><input type="checkbox" data-list="faculty" data-i="${i}" data-f="inTeam" ${f.inTeam ? 'checked' : ''}></td>
        <td><input type="number" min="1" style="width:5rem" data-list="faculty" data-i="${i}" data-f="commonFrom" value="${f.commonFrom || 1}"></td>
        <td class="l"><input data-list="faculty" data-i="${i}" data-f="aliases" value="${esc(f.aliases)}"></td>
        <td style="white-space:nowrap">${moveBtns('faculty', i, c.faculty.length)}</td></tr>`;
    });
    h += `</tbody></table></div><p><button id="fac-add">+ Add faculty</button></p></div>`;

    h += `<div class="card"><h2>Non-teaching staff</h2>
      <p class="muted small">Staff share the non-teaching amount in proportion to <b>WF</b>. Their team share also multiplies by the count entered in each project.</p>
      <div class="wrap" style="max-height:none"><table class="num"><thead><tr><th class="l">Name</th><th>WF</th><th>Pool from project #</th><th class="l">Aliases</th><th></th></tr></thead><tbody>`;
    c.staff.forEach((s, i) => {
      h += `<tr><td class="l"><input data-list="staff" data-i="${i}" data-f="name" value="${esc(s.name)}"></td>
        <td><input type="number" step="any" style="width:5rem" data-list="staff" data-i="${i}" data-f="wf" value="${s.wf}"></td>
        <td><input type="number" min="1" style="width:5rem" data-list="staff" data-i="${i}" data-f="commonFrom" value="${s.commonFrom || 1}"></td>
        <td class="l"><input data-list="staff" data-i="${i}" data-f="aliases" value="${esc(s.aliases)}"></td>
        <td style="white-space:nowrap">${moveBtns('staff', i, c.staff.length)}</td></tr>`;
    });
    h += `</tbody></table></div><p><button id="staff-add">+ Add staff</button></p></div>`;
    $('#tab-people').innerHTML = h;
  }
  const moveBtns = (list, i, n) =>
    `<button class="icon" data-act="up" data-list="${list}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button> ` +
    `<button class="icon" data-act="down" data-list="${list}" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} title="Move down">↓</button> ` +
    `<button class="icon danger" data-act="rm" data-list="${list}" data-i="${i}" title="Remove">✕</button>`;

  function setPath(obj, path, val) {
    const keys = path.split('.');
    keys.slice(0, -1).forEach((k) => { obj = obj[k]; });
    obj[keys[keys.length - 1]] = val;
  }
  $('#tab-people').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT') return;
    markReal();
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.path) {
      const isNumber = el.type === 'number';
      const n = parseFloat(val);
      let v = isNumber ? (isFinite(n) ? n : 0) : val;
      if (el.dataset.pct) v = frac(v);
      setPath(state.config, el.dataset.path, v);
    } else if (el.dataset.wt !== undefined) {
      const w = state.config.rates.workTypes[Number(el.dataset.wt)];
      w[el.dataset.f] = el.dataset.f === 'name' ? val : frac(parseFloat(val) || 0);
    } else if (el.dataset.list) {
      const item = state.config[el.dataset.list][Number(el.dataset.i)];
      const f = el.dataset.f;
      item[f] = ['wf', 'commonFrom'].includes(f) ? (parseFloat(val) || (f === 'commonFrom' ? 1 : 0)) : val;
    }
    scheduleCalc();
  });
  $('#tab-people').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const c = state.config;
    markReal();
    if (b.id === 'wt-add') c.rates.workTypes.push({ name: 'New type', buetDeduction: c.rates.other.buetDeduction, nonTeachingShare: c.rates.other.nonTeachingShare });
    else if (b.id === 'fac-add') c.faculty.push({ id: nextId('f'), name: 'New faculty', wf: 0.8, inCommon: true, inTeam: true, commonFrom: 1, aliases: '' });
    else if (b.id === 'staff-add') c.staff.push({ id: nextId('s'), name: 'New staff', wf: 0.25, commonFrom: 1, aliases: '' });
    else if (b.dataset.act === 'wt-del') c.rates.workTypes.splice(Number(b.dataset.i), 1);
    else if (b.dataset.act) {
      const list = c[b.dataset.list], i = Number(b.dataset.i);
      if (b.dataset.act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      else if (b.dataset.act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      else if (b.dataset.act === 'rm') { if (!confirm(`Remove ${list[i].name}? Their counts stay in the project rows but are ignored.`)) return; list.splice(i, 1); }
    } else return;
    renderPeople(); updateBar(); save();
  });

  // ---------------------------------------------------------------- 3. results
  const td = (v, cls = '') => `<td class="${cls}${typeof v === 'number' && v < 0 ? ' neg' : ''}">${typeof v === 'number' ? fmt(v) : esc(v)}</td>`;
  function renderResults() {
    const res = updateBar();
    const s = res.summary, c = state.config, r = res.rates;
    let h = '';
    if (res.warnings.length) {
      h += `<div class="bad-box"><b>${res.warnings.length} data warning${res.warnings.length > 1 ? 's' : ''}</b><ul class="tight">${res.warnings.slice(0, 30).map((w) => `<li>Row ${w.row}: ${esc(w.msg)}</li>`).join('')}</ul>${res.warnings.length > 30 ? '<p>…and more.</p>' : ''}</div>`;
    }
    const stat = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    h += `<div class="toolbar no-print"><button class="primary" id="print">Print / save as PDF</button><button id="xlsx-res">Download Excel</button></div>`;
    if (c.title) h += `<h2>${esc(c.title)}</h2>`;
    h += `<div class="cards">
      ${stat('Total paid by clients', fmt(s.totalPaidByClient))}
      ${stat('Total expenses', fmt(s.totalExpenses))}
      ${stat('After BUET deduction and expenses', fmt(s.totalAfterDeductions))}
      ${stat('Head / dept account', fmt(s.headAccount))}
      ${stat('Head account with expenses', fmt(s.headAccountWithExpenses))}
      ${stat('Distributed (people + head account)', fmt(s.distributed))}
      ${stat('Rounding difference', sgn(s.roundingCheck))}
      ${stat(`Approx. deposit to head account (after ${pct(r.brtcTax)}% tax)`, fmt(s.headDeposit))}
    </div>
    <p class="muted small">The rounding difference is the workbook's "Check" cell: every share is rounded to whole taka separately, so the parts can differ from the total by a few taka. It is not an error; decide how to settle it.</p>`;

    // per person
    const grp = (kind, title) => {
      const list = res.people.filter((p) => p.kind === kind);
      if (!list.length) return '';
      const sum = (k) => list.reduce((a, p) => a + p[k], 0);
      return `<tr class="group"><td colspan="5">${title}</td></tr>` +
        list.map((p) => `<tr><td class="l">${esc(p.name)}</td>${td(p.common)}${td(p.team)}${td(p.total)}${td(p.deposit)}</tr>`).join('') +
        `<tr><td class="l"><i>Subtotal</i></td>${td(sum('common'))}${td(sum('team'))}${td(sum('total'))}${td(sum('deposit'))}</tr>`;
    };
    h += `<div class="card"><h2>Amount per person</h2><div class="wrap" style="max-height:none"><table class="num">
      <thead><tr><th class="l">Name</th><th>Common pool</th><th>Team</th><th>Total</th><th>Approx. deposit (after ${pct(r.brtcTax)}% tax)</th></tr></thead><tbody>
      ${grp('faculty', 'Faculty')}${grp('staff', 'Non-teaching staff')}
      <tr class="group"><td colspan="5">Head / dept account</td></tr>
      <tr><td class="l">Head account (${pct(r.headAccount)}% of each distributable amount)</td>${td('')}${td('')}${td(s.headAccount)}${td(s.headAccount * (1 - r.brtcTax))}</tr>
      </tbody><tfoot><tr><td class="l">Distributed in total</td>${td('')}${td('')}${td(s.distributed)}${td('')}</tr></tfoot></table></div></div>`;

    // per project basic calculation
    const T = res.totals;
    h += `<div class="card"><h2>Per project: how each payment is split</h2><div class="wrap"><table class="num"><thead><tr>
      <th>#</th><th class="l">BRTC ref</th><th class="l">BME ref</th><th class="l">Client</th><th class="l">Type</th>
      <th>Amount paid</th><th>VAT</th><th>Expenses</th><th>After VAT</th><th>BUET deduction</th><th>Distributable</th><th>Head acct</th><th>Non-teaching</th><th>Remaining</th><th>Faculty common</th><th>Faculty team</th></tr></thead><tbody>`;
    res.rows.forEach((x) => {
      const b = x.basic;
      h += `<tr><td>${x.n}</td><td class="l">${esc(x.brtcRef)}</td><td class="l">${esc(x.bmeRef)}</td><td class="l">${esc(x.client)}</td><td class="l">${esc(x.workType)}</td>
        ${td(x.amount)}${td(x.vat)}${td(x.expense)}${td(b.D)}${td(b.E)}${td(b.F)}${td(b.G)}${td(b.H)}${td(b.I)}${td(b.J)}${td(b.K)}</tr>`;
    });
    h += `</tbody><tfoot><tr><td colspan="5" class="l">Total</td>${td(T.amount)}${td(T.vat)}${td(T.expense)}${td(T.D)}${td(T.E)}${td(T.F)}${td(T.G)}${td(T.H)}${td(T.I)}${td(T.J)}${td(T.K)}</tr></tfoot></table></div></div>`;

    // matrices
    const fC = c.faculty.filter((f) => f.inCommon), fT = c.faculty.filter((f) => f.inTeam);
    const matrix = (title, list, pick, resid) => {
      if (!list.length) return '';
      let m = `<details><summary>${title}</summary><div class="wrap"><table class="num"><thead><tr><th>#</th><th class="l">BRTC ref</th>${list.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th>Rounding check</th></tr></thead><tbody>`;
      res.rows.forEach((x) => { m += `<tr><td>${x.n}</td><td class="l">${esc(x.brtcRef)}</td>${list.map((p) => td(pick(x)[p.id])).join('')}${td(resid(x))}</tr>`; });
      m += `</tbody><tfoot><tr><td colspan="2" class="l">Total</td>${list.map((p) => td(res.rows.reduce((a, x) => a + pick(x)[p.id], 0))).join('')}${td(res.rows.reduce((a, x) => a + resid(x), 0))}</tr></tfoot></table></div></details>`;
      return m;
    };
    h += `<div class="card"><h2>Per project and person</h2>
      ${matrix('Faculty common pool', fC, (x) => x.facultyCommon, (x) => x.residual.facultyCommon)}
      ${matrix('Faculty team', fT, (x) => x.facultyTeam, (x) => x.residual.facultyTeam)}
      ${matrix('Non-teaching common pool', c.staff, (x) => x.staffCommon, (x) => x.residual.staffCommon)}
      ${matrix('Non-teaching team', c.staff, (x) => x.staffTeam, (x) => x.residual.staffTeam)}
    </div>`;

    // explanation with the live rates
    const wt = r.workTypes.map((w) => `${w.name}: ${pct(w.buetDeduction)}% deduction, ${pct(w.nonTeachingShare)}% non-teaching`).join('; ');
    h += `<div class="card"><h2>How the numbers are worked out</h2>
      <div class="formula">After VAT (D)        = Amount paid - VAT
BUET deduction (E)   = rate x D        [${esc(wt)}; all other: ${pct(r.other.buetDeduction)}% / ${pct(r.other.nonTeachingShare)}%]
Distributable (F)    = ROUND(Amount - VAT - Expenses - E)
Head account (G)     = ROUND(F x ${pct(r.headAccount)}%)
Non-teaching (H)     = ROUND(F x non-teaching share)
Remaining (I)        = F - G - H
Faculty common (J)   = ${pct(r.commonPoolShare)}% x I        (not rounded)
Faculty team (K)     = I - J

Faculty common share = ROUND( WF / sum(WF of pool members) x J )     Head that month: WF = ${r.headWF}
Faculty team share   = ROUND( count x WF / sum(count x WF) x K )
Non-teaching common  = ROUND( H x ${pct(r.nonTeachingCommonShare)}% x WF / sum(WF of pool members) )
Non-teaching team    = ROUND( H x ${pct(1 - r.nonTeachingCommonShare)}% x count x WF / sum(count x WF) )
Approx. deposit      = total x (1 - ${pct(r.brtcTax)}%)</div>
      <p class="muted small">ROUND is Excel's: halves go away from zero. A pool with nobody in it, or with all counts zero, pays nothing and raises a warning so the money is not lost silently.</p></div>`;
    $('#tab-results').innerHTML = h;
  }
  $('#tab-results').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'print') window.print();
    if (b.id === 'xlsx-res') exportXlsx();
  });

  // ---------------------------------------------------------------- 4. import / export
  let pending = null; // parsed import waiting for confirmation
  function renderData() {
    $('#tab-data').innerHTML = `
      <div class="card"><h2>Import projects</h2>
        <p class="muted small">Works with the Google Form response sheet or any sheet with the same kind of headers: <i>Date, Client Name, Work Details, Work Type, BME Ref, BRTC Ref, Amount Paid, VAT, Expenses</i>, then "<i>&lt;person&gt; Status</i>" and "<i>&lt;person&gt; Self Count</i>" columns. People are found by the names on the <b>People &amp; rates</b> tab (use <b>Aliases</b> for other spellings). Set up the people first.</p>
        <div class="toolbar"><label>Excel / CSV file: <input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.tsv,.txt"></label>
        <label id="sheet-pick" hidden>Sheet: <select id="imp-sheet"></select></label></div>
        <details><summary>Or paste rows copied from a spreadsheet (include the header row)</summary>
          <textarea id="imp-paste" placeholder="Paste here"></textarea><p><button id="imp-paste-go">Preview pasted rows</button></p></details>
        <div id="imp-preview"></div>
      </div>
      <div class="card"><h2>Export</h2><div class="toolbar">
        <button class="primary" id="x-xlsx">Excel workbook (inputs, calculations, summary)</button>
        <button id="x-csv">Summary CSV</button>
        <button id="x-tpl">Blank input template (Excel)</button></div>
        <p class="muted small">The Excel export holds values, not formulas: it is a snapshot of this calculation.</p></div>
      <div class="card"><h2>Save and restore</h2><div class="toolbar">
        <button id="x-json">Save everything as a JSON file</button>
        <label>Load a saved JSON: <input type="file" id="imp-json" accept=".json,application/json"></label></div>
        <p class="muted small">Your data is saved automatically in this browser only. Save a JSON copy to move it to another computer or to keep a record of each period.</p></div>
      <div class="card"><h2>Start over</h2><div class="toolbar">
        <button id="x-clear" class="danger">Clear all projects (keep people and rates)</button>
        <button id="x-demo" class="danger">Reset to the demo data</button></div></div>`;
  }
  const tab = $('#tab-data');
  tab.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'imp-file' && el.files[0]) readFile(el.files[0]);
    if (el.id === 'imp-sheet') previewRows(sheetRows(el.value));
    if (el.id === 'imp-json' && el.files[0]) {
      const fr = new FileReader();
      fr.onload = () => {
        try { state = normalise(JSON.parse(fr.result)); isDemo = false; save(); updateBar(); alert('Loaded.'); setTab('projects'); } catch (e) { alert('That file is not a saved BRTC calculator file.'); }
      };
      fr.readAsText(el.files[0]);
    }
  });
  tab.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'imp-paste-go') { const rows = IO.parseDelimited($('#imp-paste').value); previewRows(rows); }
    else if (b.id === 'imp-replace' || b.id === 'imp-append') applyImport(b.id === 'imp-append');
    else if (b.id === 'x-xlsx') exportXlsx();
    else if (b.id === 'x-csv') exportCsv();
    else if (b.id === 'x-tpl') exportTemplate();
    else if (b.id === 'x-json') download(`brtc-${stamp()}.json`, JSON.stringify({ ...state, demo: false }, null, 1), 'application/json');
    else if (b.id === 'x-clear' && confirm('Delete every project row? People and rates are kept.')) { markReal(); state.projects = []; save(); updateBar(); alert('Cleared.'); }
    else if (b.id === 'x-demo' && confirm('Replace everything with the invented demo data?')) { useDemo(); $('#demo-banner').hidden = false; save(); updateBar(); alert('Demo data restored.'); }
  });

  let workbook = null;
  function sheetRows(name) { return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' }); }
  function readFile(file) {
    const fr = new FileReader();
    const isText = /\.(csv|tsv|txt)$/i.test(file.name);
    fr.onload = () => {
      try {
        if (isText) { previewRows(IO.parseDelimited(String(fr.result))); return; }
        workbook = XLSX.read(fr.result, { type: 'array', cellDates: true });
        const names = workbook.SheetNames;
        const guess = names.find((n) => /form responses/i.test(n)) || names.find((n) => IO.findHeaderRow(sheetRows(n)) >= 0) || names[0];
        $('#sheet-pick').hidden = names.length < 2;
        $('#imp-sheet').innerHTML = names.map((n) => `<option ${n === guess ? 'selected' : ''}>${esc(n)}</option>`).join('');
        previewRows(sheetRows(guess));
      } catch (e) { $('#imp-preview').innerHTML = `<div class="bad-box">Could not read that file: ${esc(e.message)}</div>`; }
    };
    if (isText) fr.readAsText(file); else fr.readAsArrayBuffer(file);
  }
  function previewRows(rows) {
    const out = IO.parseProjects(rows, state.config);
    pending = out;
    const box = $('#imp-preview');
    if (out.errors.length) { box.innerHTML = `<div class="bad-box">${out.errors.map(esc).join('<br>')}</div>`; return; }
    const m = out.mapping;
    const fieldNames = Object.keys(m.fieldCol).join(', ');
    let h = `<div class="good-box">Found <b>${out.projects.length}</b> projects. Project columns found: ${esc(fieldNames)}. Person columns matched: <b>${m.personCols.length}</b>.</div>`;
    h += `<details><summary>Which column went to which person</summary><div class="wrap" style="max-height:30vh"><table class="num"><thead><tr><th class="l">Header</th><th class="l">Person</th><th class="l">Field</th></tr></thead><tbody>${m.personCols.map((p) => `<tr><td class="l">${esc(p.header)}</td><td class="l">${esc(p.name)}</td><td class="l">${p.field}</td></tr>`).join('')}</tbody></table></div></details>`;
    if (m.unmatched.length) h += `<div class="note"><b>${m.unmatched.length} column(s) not used:</b><ul class="tight">${m.unmatched.slice(0, 12).map((u) => `<li>${esc(u.header)}: ${esc(u.reason)}</li>`).join('')}</ul></div>`;
    (out.notes || []).forEach((n) => { h += `<div class="note">${esc(n)}</div>`; });
    const first = out.projects[0], last = out.projects[out.projects.length - 1];
    if (first) h += `<p class="muted small">First row: ${esc(first.brtcRef || first.client)} (${fmt(E.num(first.amount))}); last row: ${esc(last.brtcRef || last.client)} (${fmt(E.num(last.amount))}). Dates are copied as they appear in the sheet.</p>`;
    h += `<div class="toolbar"><button class="primary" id="imp-replace" ${out.projects.length ? '' : 'disabled'}>Replace current projects with these ${out.projects.length}</button><button id="imp-append" ${out.projects.length ? '' : 'disabled'}>Add them to the current projects</button></div>`;
    box.innerHTML = h;
  }
  function applyImport(append) {
    if (!pending || !pending.projects.length) return;
    markReal();
    state.projects = append ? state.projects.concat(pending.projects) : pending.projects;
    pending = null; save(); updateBar();
    $('#imp-preview').innerHTML = '<div class="good-box">Imported. Open <b>Results</b> to see the split, and compare the totals with your workbook.</div>';
  }

  // downloads
  const stamp = () => new Date().toISOString().slice(0, 10);
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportXlsx() {
    const res = E.calculate(state.config, state.projects);
    const sheets = IO.exportSheets(state.config, state.projects, res);
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = (rows[0] || []).map((_, i) => ({ wch: Math.min(40, Math.max(10, ...rows.slice(0, 40).map((r) => String(r[i] == null ? '' : r[i]).length))) }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    }
    XLSX.writeFile(wb, `brtc-calculation-${stamp()}.xlsx`);
  }
  function exportCsv() {
    const res = E.calculate(state.config, state.projects);
    const q = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const lines = [['Name', 'Group', 'Common pool', 'Team', 'Total', 'Approx deposit'].join(',')];
    res.people.forEach((p) => lines.push([q(p.name), p.kind, p.common, p.team, p.total, p.deposit].join(',')));
    lines.push(['Head account', 'head', '', '', res.summary.headAccount, res.summary.headAccount * (1 - res.rates.brtcTax)].join(','));
    download(`brtc-summary-${stamp()}.csv`, lines.join('\n'), 'text/csv');
  }
  function exportTemplate() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IO.templateHeader(state.config)]), 'Form Responses 1');
    XLSX.writeFile(wb, 'brtc-input-template.xlsx');
  }

  // ---------------------------------------------------------------- start
  const saved = load();
  if (saved) { state = saved; isDemo = saved.demo; } else useDemo();
  $('#demo-banner').hidden = !isDemo;
  setTab('projects');
})();
