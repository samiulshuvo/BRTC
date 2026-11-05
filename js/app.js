(function () {
  'use strict';
  const E = window.BRTC, IO = window.BRTCIO;
  const KEY = 'brtc-calculator-v1', PREF_KEY = 'brtc-calculator-prefs';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmt = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '');
  const sgn = (n) => (n > 0 ? '+' : '') + fmt(n);
  const pct = (f) => Number((f * 100).toPrecision(10)); // 0.195 -> 19.5 without float noise
  const frac = (p) => Number((p / 100).toPrecision(12));
  const ieq = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();

  // ---------------------------------------------------------------- preferences (view, theme, intro)
  let prefs = { view: 'compact', hideIntro: false, theme: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch (e) { /* storage unavailable */ }
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };
  function applyTheme() { if (prefs.theme) document.documentElement.dataset.theme = prefs.theme; else delete document.documentElement.dataset.theme; }
  applyTheme();

  // ---------------------------------------------------------------- toasts
  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

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
    try { const raw = localStorage.getItem(KEY); if (raw) return normalise(JSON.parse(raw)); } catch (e) { /* start from the demo */ }
    return null;
  }
  let saveTimer = null;
  function writeNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify({ ...state, demo: isDemo })); $('#saved').textContent = 'Saved on this device'; }
    catch (e) { $('#saved').textContent = 'Not saved (browser storage is blocked): use Save as JSON'; }
  }
  function save() {
    $('#saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 300);
  }
  // an edit made just before closing or reloading must not be lost to the debounce
  window.addEventListener('pagehide', () => { if (saveTimer) writeNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) writeNow(); });
  function useDemo() { state = normalise(clone(window.BRTC_DEMO)); isDemo = true; }
  function markReal() { if (isDemo) { isDemo = false; $('#demo-banner').hidden = true; } }
  function nextId(prefix) {
    const used = new Set([...state.config.faculty, ...state.config.staff].map((x) => x.id));
    let i = 1; while (used.has(prefix + i)) i++;
    return prefix + i;
  }

  // ---------------------------------------------------------------- tabs
  function setTab(t) {
    $('#demo-banner').hidden = !isDemo;
    $$('.steps button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('section.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
    if (t === 'projects') renderProjects();
    if (t === 'people') renderPeople();
    if (t === 'results') renderResults();
    if (t === 'data') renderData();
    window.scrollTo({ top: 0 });
  }
  $$('.steps button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-goto]');
    if (g) { ev.preventDefault(); setTab(g.dataset.goto); }
  });

  // ---------------------------------------------------------------- live chips
  let calcTimer;
  function scheduleCalc() { clearTimeout(calcTimer); calcTimer = setTimeout(updateBar, 120); save(); }
  function updateBar() {
    const res = E.calculate(state.config, state.projects);
    const s = res.summary;
    const warnRows = new Set(res.warnings.map((w) => w.row));
    $$('#ptable tbody tr').forEach((tr) => tr.classList.toggle('warn', warnRows.has(Number(tr.dataset.row))));
    const chip = (k, v, cls = '') => `<span class="chip ${cls}">${k} <b>${v}</b></span>`;
    $('#bar').innerHTML =
      chip('Projects', state.projects.length) + chip('Paid by clients', fmt(s.totalPaidByClient)) +
      chip('After deductions', fmt(s.totalAfterDeductions)) + chip('Distributed', fmt(s.distributed)) +
      chip('Rounding difference', sgn(s.roundingCheck)) +
      (res.warnings.length ? chip('Warnings', res.warnings.length, 'warn') : '');
    return res;
  }

  // ---------------------------------------------------------------- 2. projects
  const rateOf = () => state.config.rates;
  function blankProject() {
    const t = rateOf().workTypes[0];
    return { date: new Date().toISOString().slice(0, 10), client: '', details: '', workType: t ? t.name : '', bmeRef: '', brtcRef: '', amount: '', vat: '', expense: '', status: {}, count: {} };
  }
  function teamSummary(p) {
    const { faculty, staff } = state.config;
    const head = faculty.find((f) => (p.status || {})[f.id] && ieq(p.status[f.id], rateOf().headStatus));
    const nf = faculty.filter((f) => f.inTeam && E.num((p.count || {})[f.id]) > 0).length;
    const ns = staff.filter((s) => E.num((p.count || {})[s.id]) > 0).length;
    const label = nf + ns === 0 ? 'Set team' : `${nf} faculty · ${ns} staff`;
    return { head, nf, ns, label: (head ? `Head: ${head.name} · ` : '') + label, empty: nf + ns === 0 };
  }

  function renderProjects() {
    const root = $('#tab-projects');
    let h = '';
    if (!prefs.hideIntro) {
      h += `<div class="card intro"><button class="ghost x" id="intro-x" aria-label="Hide this guide">✕</button>
        <h2>Welcome: three steps</h2>
        <ol>
          <li><b>People &amp; rates</b>: check each person's weighting factor and the rates. <a href="#" data-goto="people">Open step 1</a></li>
          <li><b>Projects</b>: add one row per BRTC payment (or <a href="#" data-goto="data">import your spreadsheet</a>), then press <b>Team</b> on a row to say who worked on it.</li>
          <li><b>Results</b>: see what each person gets and print or download it. <a href="#" data-goto="results">Open step 3</a></li>
        </ol></div>`;
    }
    h += `<div class="card"><div class="card-head"><div><h2>Projects</h2>
      <p class="muted small" style="margin:0">One row per BRTC payment, amounts in taka. <b>To distribute</b> is what is left after VAT, the BUET deduction and expenses.</p></div>
      <div class="toolbar" style="margin:0"><button class="primary" id="add-row">+ Add project</button>
      <span class="btn-group" role="group" aria-label="Table layout"><button id="v-compact" aria-pressed="${prefs.view === 'compact'}">Simple</button><button id="v-full" aria-pressed="${prefs.view === 'full'}">Spreadsheet</button></span></div></div>`;
    h += prefs.view === 'full' ? fullTable() : compactTable();
    if (!state.projects.length) h += '<p class="muted" style="margin-top:.8rem">No projects yet. Add one, or import a spreadsheet.</p>';
    h += `<p class="muted small" style="margin-bottom:0">${prefs.view === 'full' ? 'Spreadsheet layout shows every column, including each person\'s status and count.' : 'Press <b>Team</b> on a row to set who worked on it, the Head, and each person\'s count. Press Enter to move down a column.'}</p></div>`;
    root.innerHTML = h;
    $('#dl-types').innerHTML = rateOf().workTypes.map((w) => `<option value="${esc(w.name)}">`).join('');
    updateBar();
  }
  const cell = (p, f, cls, extra = '') => `<td><input class="${cls}" data-f="${f}" value="${esc(p[f])}" ${extra}></td>`;
  const numCell = (p, f) => `<td><input class="w-num" inputmode="decimal" data-f="${f}" value="${esc(p[f])}"></td>`;
  const rowActions = '<td style="white-space:nowrap"><button class="icon ghost" title="Duplicate this row" aria-label="Duplicate row" data-act="dup">⧉</button><button class="icon ghost danger" title="Delete this row" aria-label="Delete row" data-act="del">✕</button></td>';

  function compactTable() {
    let h = `<div class="wrap"><table class="grid" id="ptable"><thead><tr><th>#</th><th>Date</th><th>Client</th><th>Work type</th><th>BRTC ref</th><th>BME ref</th><th>Amount paid</th><th>VAT</th><th>Expenses</th><th title="After VAT, BUET deduction and expenses">To distribute</th><th>Team</th><th></th></tr></thead><tbody>`;
    state.projects.forEach((p, i) => { h += compactRow(p, i); });
    return h + '</tbody></table></div>';
  }
  function compactRow(p, i) {
    const b = E.basic(rateOf(), p), ts = teamSummary(p);
    return `<tr data-row="${i + 1}"><td class="n">${i + 1}</td>` +
      cell(p, 'date', 'w-date') + cell(p, 'client', 'w-text') + cell(p, 'workType', 'w-text', 'list="dl-types"') +
      cell(p, 'brtcRef', 'w-text') + cell(p, 'bmeRef', 'w-text') + numCell(p, 'amount') + numCell(p, 'vat') + numCell(p, 'expense') +
      `<td class="dist">${fmt(b.F)}</td><td><button class="team-btn ${ts.empty ? 'empty' : ''}" data-act="edit" title="Who worked on this project">${esc(ts.label)}</button></td>${rowActions}</tr>`;
  }
  function fullTable() {
    const { faculty, staff } = state.config;
    let h = `<div class="wrap"><table class="grid" id="ptable"><thead><tr class="grp"><th rowspan="2">#</th><th colspan="9">Project</th>`;
    faculty.forEach((f) => { h += `<th colspan="2">${esc(f.name)}</th>`; });
    if (staff.length) h += `<th colspan="${staff.length}">Non-teaching team count</th>`;
    h += '<th rowspan="2"></th></tr><tr>';
    ['Date', 'Client', 'Work details', 'Work type', 'BME ref', 'BRTC ref', 'Amount paid', 'VAT', 'Expenses'].forEach((t) => { h += `<th>${t}</th>`; });
    faculty.forEach(() => { h += '<th>Status</th><th>Count</th>'; });
    staff.forEach((s) => { h += `<th>${esc(s.name)}</th>`; });
    h += '</tr></thead><tbody>';
    state.projects.forEach((p, i) => {
      h += `<tr data-row="${i + 1}"><td class="n">${i + 1}</td>` + cell(p, 'date', 'w-date') + cell(p, 'client', 'w-text') + cell(p, 'details', 'w-text') +
        cell(p, 'workType', 'w-text', 'list="dl-types"') + cell(p, 'bmeRef', 'w-text') + cell(p, 'brtcRef', 'w-text') + numCell(p, 'amount') + numCell(p, 'vat') + numCell(p, 'expense');
      faculty.forEach((f) => {
        h += `<td><input class="w-text" style="min-width:4.5rem" list="dl-status" data-t="s" data-id="${f.id}" value="${esc((p.status || {})[f.id] || '')}"></td>`;
        h += `<td><input class="w-num" inputmode="decimal" data-t="c" data-id="${f.id}" value="${esc((p.count || {})[f.id] ?? '')}"></td>`;
      });
      staff.forEach((s) => { h += `<td><input class="w-num" inputmode="decimal" data-t="c" data-id="${s.id}" value="${esc((p.count || {})[s.id] ?? '')}"></td>`; });
      h += rowActions + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function applyInput(p, el) {
    if (el.dataset.t === 's') (p.status = p.status || {})[el.dataset.id] = el.value;
    else if (el.dataset.t === 'c') (p.count = p.count || {})[el.dataset.id] = el.value;
    else if (el.dataset.f) p[el.dataset.f] = el.value;
  }
  function refreshRow(i) {
    const tr = $(`#ptable tbody tr[data-row="${i + 1}"]`);
    if (!tr || prefs.view !== 'compact') return;
    const p = state.projects[i], ts = teamSummary(p);
    $('.dist', tr).textContent = fmt(E.basic(rateOf(), p).F);
    const b = $('.team-btn', tr);
    b.textContent = ts.label; b.classList.toggle('empty', ts.empty);
  }

  const tabP = $('#tab-projects');
  tabP.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT') return;
    const tr = el.closest('tr[data-row]');
    if (!tr) return;
    const i = Number(tr.dataset.row) - 1;
    markReal(); applyInput(state.projects[i], el); refreshRow(i); scheduleCalc();
  });
  tabP.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
    const tr = ev.target.closest('tr[data-row]');
    const next = tr && tr.nextElementSibling;
    if (!next) return;
    const sel = ev.target.dataset.f ? `input[data-f="${ev.target.dataset.f}"]` : `input[data-t="${ev.target.dataset.t}"][data-id="${ev.target.dataset.id}"]`;
    const target = $(sel, next);
    if (target) { ev.preventDefault(); target.focus(); target.select(); }
  });
  tabP.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'intro-x') { prefs.hideIntro = true; savePrefs(); renderProjects(); return; }
    if (b.id === 'v-compact' || b.id === 'v-full') { prefs.view = b.id === 'v-full' ? 'full' : 'compact'; savePrefs(); renderProjects(); return; }
    if (b.id === 'add-row') {
      markReal(); state.projects.push(blankProject()); renderProjects(); save();
      const rows = $$('#ptable tbody tr'); const last = rows[rows.length - 1];
      if (last) { last.scrollIntoView({ block: 'center' }); const f = $('input[data-f="client"]', last); if (f) f.focus(); }
      return;
    }
    const tr = b.closest('tr[data-row]');
    if (!tr) return;
    const i = Number(tr.dataset.row) - 1;
    if (b.dataset.act === 'edit') openProject(i);
    if (b.dataset.act === 'dup') { markReal(); state.projects.splice(i + 1, 0, clone(state.projects[i])); renderProjects(); save(); toast('Row duplicated.'); }
    if (b.dataset.act === 'del' && confirm(`Delete project ${i + 1}${state.projects[i].brtcRef ? ' (' + state.projects[i].brtcRef + ')' : ''}?`)) { markReal(); state.projects.splice(i, 1); renderProjects(); save(); toast('Row deleted.'); }
  });

  // ---- project dialog (details and team)
  const pdlg = $('#pdlg');
  let dlgIndex = -1;
  function openProject(i) {
    dlgIndex = i;
    const p = state.projects[i], { faculty, staff } = state.config;
    const f = (key, label, cls = '', extra = '') => `<label class="field">${label}<input class="${cls}" data-f="${key}" value="${esc(p[key])}" ${extra}></label>`;
    let h = `<form method="dialog" class="dlg"><header><h2 id="dlg-title"></h2><button value="close" class="ghost" aria-label="Close">✕</button></header><div class="dlg-body">
      <fieldset><legend>Project</legend><div class="form-grid">
        ${f('date', 'Date')}${f('client', 'Client')}${f('details', 'Work details')}${f('workType', 'Work type', '', 'list="dl-types"')}${f('brtcRef', 'BRTC ref. no.')}${f('bmeRef', 'BME ref. no.')}
      </div></fieldset>
      <fieldset><legend>Money (taka)</legend><div class="form-grid">
        ${f('amount', 'Amount paid by the client', '', 'inputmode="decimal"')}${f('vat', 'VAT deducted by BRTC', '', 'inputmode="decimal"')}${f('expense', 'Expenses (material, transport, other)', '', 'inputmode="decimal"')}
      </div><div class="preview" id="dlg-prev"></div></fieldset>
      <fieldset><legend>Faculty</legend>
        <p class="hint" style="margin:.2rem 0 .5rem">Mark the Head of the department for this project in <b>Status</b>. <b>Team count</b> is the person's share of work in the team pool (0 if not on the team).</p>
        <div class="wrap free"><table class="num"><thead><tr><th class="l">Name</th><th class="l">Status</th><th>Team count</th></tr></thead><tbody>`;
    faculty.forEach((x) => {
      h += `<tr><td class="l">${esc(x.name)}</td><td class="l"><input list="dl-status" data-t="s" data-id="${x.id}" value="${esc((p.status || {})[x.id] || '')}" style="width:8rem"></td>
        <td>${x.inTeam ? `<input inputmode="decimal" data-t="c" data-id="${x.id}" value="${esc((p.count || {})[x.id] ?? '')}" style="width:5.5rem;text-align:right">` : '<span class="muted small">not in teams</span>'}</td></tr>`;
    });
    h += `</tbody></table></div></fieldset>`;
    if (staff.length) {
      h += `<fieldset><legend>Non-teaching staff team count</legend><div class="count-grid">`;
      staff.forEach((x) => { h += `<label class="field">${esc(x.name)}<input inputmode="decimal" data-t="c" data-id="${x.id}" value="${esc((p.count || {})[x.id] ?? '')}"></label>`; });
      h += '</div></fieldset>';
    }
    h += `</div><footer><button type="button" id="dlg-prev-btn" ${i === 0 ? 'disabled' : ''}>← Previous</button><button type="button" id="dlg-next-btn" ${i === state.projects.length - 1 ? 'disabled' : ''}>Next →</button><span class="spacer"></span><button class="primary" value="done">Done</button></footer></form>`;
    pdlg.innerHTML = h;
    updateDlg();
    if (!pdlg.open) pdlg.showModal();
  }
  function updateDlg() {
    const p = state.projects[dlgIndex];
    $('#dlg-title').textContent = `Project ${dlgIndex + 1}${p.brtcRef ? ' · ' + p.brtcRef : ''}${p.client ? ' · ' + p.client : ''}`;
    const b = E.basic(rateOf(), p);
    const box = (k, v) => `<div>${k}<b>${fmt(v)}</b></div>`;
    const warns = E.calculate(state.config, state.projects).warnings.filter((w) => w.row === dlgIndex + 1);
    $('#dlg-prev').innerHTML = box('To distribute', b.F) + box('Head account', b.G) + box('Non-teaching', b.H) + box('Remaining', b.I) + box('Faculty common pool', b.J) + box('Faculty team pool', b.K) +
      (warns.length ? `<div style="grid-column:1/-1;background:var(--warn-bg);color:var(--warn)">${warns.map((w) => esc(w.msg)).join('<br>')}</div>` : '');
  }
  pdlg.addEventListener('input', (ev) => {
    if (ev.target.tagName !== 'INPUT') return;
    markReal(); applyInput(state.projects[dlgIndex], ev.target); updateDlg(); refreshRow(dlgIndex); scheduleCalc();
  });
  pdlg.addEventListener('click', (ev) => {
    if (ev.target === pdlg) { pdlg.close(); return; } // click on the backdrop
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'dlg-prev-btn' && dlgIndex > 0) openProject(dlgIndex - 1);
    if (b.id === 'dlg-next-btn' && dlgIndex < state.projects.length - 1) openProject(dlgIndex + 1);
  });
  pdlg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.preventDefault(); }); // Enter must not submit (close) the form
  pdlg.addEventListener('close', () => { if (!$('#tab-projects').hidden) renderProjects(); });

  // ---------------------------------------------------------------- 1. people and rates
  const POSITIONS = [['Professor', 1], ['Associate professor', 0.9], ['Assistant professor', 0.8], ['Lecturer', 0.7]];
  const posOf = (f) => f.position || (POSITIONS.find(([, w]) => w === Number(f.wf)) || ['Custom'])[0];
  const moveBtns = (list, i, n) =>
    `<button class="icon ghost" data-act="up" data-list="${list}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">↑</button>` +
    `<button class="icon ghost" data-act="down" data-list="${list}" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">↓</button>` +
    `<button class="icon ghost danger" data-act="rm" data-list="${list}" data-i="${i}" title="Remove" aria-label="Remove">✕</button>`;

  function renderPeople() {
    const c = state.config, r = c.rates;
    const num = (path, label, v, hint = '', extra = '') => `<label class="field">${label}<input type="number" step="any" data-path="${path}" ${extra} value="${v}">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    let h = `<div class="card"><div class="card-head"><div><h2>Rates</h2><p class="muted small" style="margin:0">Percentages are typed as percent: 30 means 30%.</p></div></div>
      <div class="form-grid">
        <label class="field">Title (shown on printouts and exports)<input data-path="title" value="${esc(c.title)}" placeholder="e.g. Department of X, Nov 2025 to Feb 2026"></label>
        ${num('rates.headAccount', 'Head / department account (%)', pct(r.headAccount), 'Share of each distributable amount', 'data-pct="1"')}
        ${num('rates.commonPoolShare', 'Faculty common pool (%)', pct(r.commonPoolShare), 'Share of what remains; the rest is the team pool', 'data-pct="1"')}
        ${num('rates.nonTeachingCommonShare', 'Non-teaching common pool (%)', pct(r.nonTeachingCommonShare), 'Rest goes to the non-teaching team pool', 'data-pct="1"')}
        ${num('rates.headWF', 'Weight factor of the Head', r.headWF, 'Used in the faculty common pool in months a person is Head')}
        <label class="field">Status text that means Head<input data-path="rates.headStatus" value="${esc(r.headStatus)}"><span class="hint">Matched in the Status column of a project, ignoring capitals</span></label>
        ${num('rates.brtcTax', 'BRTC tax (%)', pct(r.brtcTax), 'Only for the approximate deposit shown in Results', 'data-pct="1"')}
      </div>
      <h3>Rates by work type</h3>
      <p class="muted small">The work type typed in a project is matched here (capitals ignored). Anything not listed uses the <i>all other types</i> row.</p>
      <div class="wrap free"><table class="num"><thead><tr><th class="l">Work type</th><th>BUET deduction (%)</th><th>Non-teaching share (%)</th><th></th></tr></thead><tbody>`;
    r.workTypes.forEach((w, i) => {
      h += `<tr><td class="l"><input data-wt="${i}" data-f="name" value="${esc(w.name)}" aria-label="Work type name"></td>
        <td><input type="number" step="any" style="width:7rem" data-wt="${i}" data-f="buetDeduction" value="${pct(w.buetDeduction)}" aria-label="BUET deduction percent"></td>
        <td><input type="number" step="any" style="width:7rem" data-wt="${i}" data-f="nonTeachingShare" value="${pct(w.nonTeachingShare)}" aria-label="Non-teaching share percent"></td>
        <td><button class="icon ghost danger" data-act="wt-del" data-i="${i}" aria-label="Remove work type">✕</button></td></tr>`;
    });
    h += `<tr><td class="l"><i>all other types</i></td>
        <td><input type="number" step="any" style="width:7rem" data-path="rates.other.buetDeduction" data-pct="1" value="${pct(r.other.buetDeduction)}" aria-label="Other types BUET deduction percent"></td>
        <td><input type="number" step="any" style="width:7rem" data-path="rates.other.nonTeachingShare" data-pct="1" value="${pct(r.other.nonTeachingShare)}" aria-label="Other types non-teaching percent"></td><td></td></tr>
      </tbody></table></div><p style="margin-bottom:0"><button id="wt-add">+ Add work type</button></p></div>`;

    h += `<div class="card"><div class="card-head"><div><h2>Faculty</h2>
      <p class="muted small" style="margin:0">Choose a position to fill the weighting factor (WF), or type your own. <b>Common pool</b>: takes part in the common pool. <b>Team</b>: can be given a team count.</p></div></div>
      <div class="wrap free"><table class="num"><thead><tr><th class="l">Name</th><th class="l">Position</th><th title="Weighting factor">WF</th><th>Common pool</th><th>Team</th><th title="Joins the common pool from this project number onward (1 = from the start)">Pool from project #</th><th class="l" title="Other spellings used in spreadsheet headers, separated by commas">Aliases</th><th></th></tr></thead><tbody>`;
    c.faculty.forEach((f, i) => {
      h += `<tr><td class="l"><input data-list="faculty" data-i="${i}" data-f="name" value="${esc(f.name)}" aria-label="Name"></td>
        <td class="l"><select data-list="faculty" data-i="${i}" data-f="position" aria-label="Position">${POSITIONS.map(([n]) => `<option ${posOf(f) === n ? 'selected' : ''}>${n}</option>`).join('')}<option ${posOf(f) === 'Custom' ? 'selected' : ''}>Custom</option></select></td>
        <td><input type="number" step="any" style="width:5rem" data-list="faculty" data-i="${i}" data-f="wf" value="${f.wf}" aria-label="Weighting factor"></td>
        <td style="text-align:center"><input type="checkbox" data-list="faculty" data-i="${i}" data-f="inCommon" ${f.inCommon ? 'checked' : ''} aria-label="In common pool"></td>
        <td style="text-align:center"><input type="checkbox" data-list="faculty" data-i="${i}" data-f="inTeam" ${f.inTeam ? 'checked' : ''} aria-label="Can be on teams"></td>
        <td><input type="number" min="1" style="width:5rem" data-list="faculty" data-i="${i}" data-f="commonFrom" value="${f.commonFrom || 1}" aria-label="Pool from project number"></td>
        <td class="l"><input data-list="faculty" data-i="${i}" data-f="aliases" value="${esc(f.aliases)}" aria-label="Aliases"></td>
        <td style="white-space:nowrap">${moveBtns('faculty', i, c.faculty.length)}</td></tr>`;
    });
    h += `</tbody></table></div><p style="margin-bottom:0"><button id="fac-add">+ Add faculty</button></p></div>`;

    h += `<div class="card"><div class="card-head"><div><h2>Non-teaching staff</h2>
      <p class="muted small" style="margin:0">Staff share the non-teaching amount in proportion to their <b>WF</b>. In the team pool their share also follows the count set on each project.</p></div></div>
      <div class="wrap free"><table class="num"><thead><tr><th class="l">Name</th><th>WF</th><th title="Joins the common pool from this project number onward (1 = from the start)">Pool from project #</th><th class="l" title="Other spellings used in spreadsheet headers, separated by commas">Aliases</th><th></th></tr></thead><tbody>`;
    c.staff.forEach((s, i) => {
      h += `<tr><td class="l"><input data-list="staff" data-i="${i}" data-f="name" value="${esc(s.name)}" aria-label="Name"></td>
        <td><input type="number" step="any" style="width:5rem" data-list="staff" data-i="${i}" data-f="wf" value="${s.wf}" aria-label="Weighting factor"></td>
        <td><input type="number" min="1" style="width:5rem" data-list="staff" data-i="${i}" data-f="commonFrom" value="${s.commonFrom || 1}" aria-label="Pool from project number"></td>
        <td class="l"><input data-list="staff" data-i="${i}" data-f="aliases" value="${esc(s.aliases)}" aria-label="Aliases"></td>
        <td style="white-space:nowrap">${moveBtns('staff', i, c.staff.length)}</td></tr>`;
    });
    h += `</tbody></table></div><p style="margin-bottom:0"><button id="staff-add">+ Add staff</button></p></div>
      <div class="toolbar"><button class="primary" data-goto="projects">Next: Projects →</button></div>`;
    $('#tab-people').innerHTML = h;
  }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    keys.slice(0, -1).forEach((k) => { obj = obj[k]; });
    obj[keys[keys.length - 1]] = val;
  }
  const tabPeople = $('#tab-people');
  const onPeopleInput = (ev) => {
    const el = ev.target;
    if (!['INPUT', 'SELECT'].includes(el.tagName)) return;
    markReal();
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.path) {
      const n = parseFloat(val);
      let v = el.type === 'number' ? (isFinite(n) ? n : 0) : val;
      if (el.dataset.pct) v = frac(v);
      setPath(state.config, el.dataset.path, v);
    } else if (el.dataset.wt !== undefined) {
      const w = state.config.rates.workTypes[Number(el.dataset.wt)];
      w[el.dataset.f] = el.dataset.f === 'name' ? val : frac(parseFloat(val) || 0);
    } else if (el.dataset.list) {
      const item = state.config[el.dataset.list][Number(el.dataset.i)];
      const f = el.dataset.f;
      if (f === 'position') {
        item.position = val;
        const preset = POSITIONS.find(([n]) => n === val);
        if (preset) { item.wf = preset[1]; const wfInput = $('input[data-f="wf"]', el.closest('tr')); if (wfInput) wfInput.value = preset[1]; }
      } else if (['wf', 'commonFrom'].includes(f)) {
        item[f] = parseFloat(val) || (f === 'commonFrom' ? 1 : 0);
        if (f === 'wf' && el.dataset.list === 'faculty') {
          item.position = (POSITIONS.find(([, w]) => w === item[f]) || ['Custom'])[0];
          const sel = $('select[data-f="position"]', el.closest('tr')); if (sel) sel.value = item.position;
        }
      } else item[f] = val;
    }
    scheduleCalc();
  };
  tabPeople.addEventListener('input', onPeopleInput);
  tabPeople.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT') onPeopleInput(ev); });
  tabPeople.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.dataset.goto) return;
    const c = state.config;
    markReal();
    if (b.id === 'wt-add') c.rates.workTypes.push({ name: 'New type', buetDeduction: c.rates.other.buetDeduction, nonTeachingShare: c.rates.other.nonTeachingShare });
    else if (b.id === 'fac-add') c.faculty.push({ id: nextId('f'), name: 'New faculty', wf: 0.8, position: 'Assistant professor', inCommon: true, inTeam: true, commonFrom: 1, aliases: '' });
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
    const stat = (k, v, sub = '', cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    let h = `<div class="print-head"><h1>BRTC distribution${c.title ? ': ' + esc(c.title) : ''}</h1><p>Printed ${new Date().toLocaleDateString('en-GB')}</p></div>`;
    h += `<div class="card-head no-print"><div><h2 style="font-size:1.2rem">${c.title ? esc(c.title) : 'Results'}</h2><p class="muted small" style="margin:0">${res.rows.length} project${res.rows.length === 1 ? '' : 's'}</p></div>
      <div class="toolbar" style="margin:0"><button class="primary" id="print">Print / save as PDF</button><button id="xlsx-res">Download Excel</button><button id="csv-res">Download CSV</button></div></div>`;
    if (!state.projects.length) h += `<div class="note">No projects yet. Add them in <a href="#" data-goto="projects">Projects</a> or <a href="#" data-goto="data">import a spreadsheet</a>.</div>`;
    if (res.warnings.length) {
      h += `<div class="warn-box no-print"><b>${res.warnings.length} thing${res.warnings.length > 1 ? 's' : ''} to check</b><ul class="tight">${res.warnings.slice(0, 20).map((w) => `<li>${esc(w.msg)} <button class="ghost small" data-row="${w.row}">Go to row ${w.row}</button></li>`).join('')}</ul>${res.warnings.length > 20 ? '<p>…and more.</p>' : ''}</div>`;
    }
    h += `<div class="cards hero">
      ${stat('Total paid by clients', fmt(s.totalPaidByClient), `Expenses ${fmt(s.totalExpenses)}`)}
      ${stat('After BUET deduction and expenses', fmt(s.totalAfterDeductions), 'What is shared out', 'accent')}
      ${stat('Distributed', fmt(s.distributed), `People ${fmt(s.distributed - s.headAccount)} · Head account ${fmt(s.headAccount)}`)}
    </div>
    <div class="cards">
      ${stat('Head / dept account', fmt(s.headAccount), `${pct(r.headAccount)}% of each distributable amount`)}
      ${stat('Head account with expenses', fmt(s.headAccountWithExpenses))}
      ${stat('Rounding difference', sgn(s.roundingCheck), 'Total after deductions minus distributed')}
      ${stat('Approx. deposit to head account', fmt(s.headDeposit), `After ${pct(r.brtcTax)}% BRTC tax`)}
    </div>
    <p class="muted small">The rounding difference is the workbook's "Check" cell. Every share is rounded to whole taka on its own, so the parts can differ from the total by a few taka. It is shown, not hidden: decide how to settle it.</p>`;

    // per person with share bars
    const max = Math.max(1, ...res.people.map((p) => p.total));
    const grp = (kind, title) => {
      const list = res.people.filter((p) => p.kind === kind);
      if (!list.length) return '';
      const sum = (k) => list.reduce((a, p) => a + p[k], 0);
      return `<tr class="group"><td colspan="6">${title}</td></tr>` +
        list.map((p) => `<tr><td class="l">${esc(p.name)}</td>${td(p.common)}${td(p.team)}<td><b>${fmt(p.total)}</b></td>
          <td class="l"><div class="share"><div class="bar"><i style="width:${(p.total / max) * 100}%"></i></div><span>${s.distributed ? (p.total / s.distributed * 100).toFixed(1) : '0.0'}%</span></div></td>${td(p.deposit)}</tr>`).join('') +
        `<tr class="sub"><td class="l">Subtotal</td>${td(sum('common'))}${td(sum('team'))}${td(sum('total'))}<td></td>${td(sum('deposit'))}</tr>`;
    };
    h += `<div class="card"><h2>Amount per person</h2><div class="wrap free"><table class="num">
      <thead><tr><th class="l">Name</th><th>Common pool</th><th>Team</th><th>Total</th><th class="l">Share of total</th><th title="Total after the BRTC tax">Approx. deposit (after ${pct(r.brtcTax)}% tax)</th></tr></thead><tbody>
      ${grp('faculty', 'Faculty')}${grp('staff', 'Non-teaching staff')}
      <tr class="group"><td colspan="6">Head / department account</td></tr>
      <tr><td class="l">Head account (${pct(r.headAccount)}% of each distributable amount)</td>${td('')}${td('')}<td><b>${fmt(s.headAccount)}</b></td><td></td>${td(s.headAccount * (1 - r.brtcTax))}</tr>
      </tbody><tfoot><tr><td class="l">Distributed in total</td><td></td><td></td>${td(s.distributed)}<td></td><td></td></tr></tfoot></table></div></div>`;

    // per project
    const T = res.totals;
    h += `<div class="card"><h2>Per project: how each payment is split</h2><div class="wrap"><table class="num"><thead><tr>
      <th>#</th><th class="l">BRTC ref</th><th class="l">BME ref</th><th class="l">Client</th><th class="l">Type</th>
      <th>Amount paid</th><th>VAT</th><th>Expenses</th><th>After VAT</th><th>BUET deduction</th><th>To distribute</th><th>Head acct</th><th>Non-teaching</th><th>Remaining</th><th>Faculty common</th><th>Faculty team</th></tr></thead><tbody>`;
    res.rows.forEach((x) => {
      const b = x.basic;
      h += `<tr><td>${x.n}</td><td class="l">${esc(x.brtcRef)}</td><td class="l">${esc(x.bmeRef)}</td><td class="l">${esc(x.client)}</td><td class="l">${esc(x.workType)}</td>
        ${td(x.amount)}${td(x.vat)}${td(x.expense)}${td(b.D)}${td(b.E)}${td(b.F)}${td(b.G)}${td(b.H)}${td(b.I)}${td(b.J)}${td(b.K)}</tr>`;
    });
    h += `</tbody><tfoot><tr><td colspan="5" class="l">Total</td>${td(T.amount)}${td(T.vat)}${td(T.expense)}${td(T.D)}${td(T.E)}${td(T.F)}${td(T.G)}${td(T.H)}${td(T.I)}${td(T.J)}${td(T.K)}</tr></tfoot></table></div></div>`;

    // per project and person
    const fC = c.faculty.filter((f) => f.inCommon), fT = c.faculty.filter((f) => f.inTeam);
    const matrix = (title, list, pick, resid) => {
      if (!list.length) return '';
      let m = `<details><summary>${title}</summary><div class="wrap"><table class="num"><thead><tr><th>#</th><th class="l">BRTC ref</th>${list.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th>Rounding check</th></tr></thead><tbody>`;
      res.rows.forEach((x) => { m += `<tr><td>${x.n}</td><td class="l">${esc(x.brtcRef)}</td>${list.map((p) => td(pick(x)[p.id])).join('')}${td(resid(x))}</tr>`; });
      return m + `</tbody><tfoot><tr><td colspan="2" class="l">Total</td>${list.map((p) => td(res.rows.reduce((a, x) => a + pick(x)[p.id], 0))).join('')}${td(res.rows.reduce((a, x) => a + resid(x), 0))}</tr></tfoot></table></div></details>`;
    };
    h += `<div class="card"><h2>Per project and person</h2><p class="muted small">Open a pool to see exactly who got what from each payment.</p>
      ${matrix('Faculty common pool', fC, (x) => x.facultyCommon, (x) => x.residual.facultyCommon)}
      ${matrix('Faculty team', fT, (x) => x.facultyTeam, (x) => x.residual.facultyTeam)}
      ${matrix('Non-teaching common pool', c.staff, (x) => x.staffCommon, (x) => x.residual.staffCommon)}
      ${matrix('Non-teaching team', c.staff, (x) => x.staffTeam, (x) => x.residual.staffTeam)}</div>`;

    const wt = r.workTypes.map((w) => `${w.name}: ${pct(w.buetDeduction)}% deduction, ${pct(w.nonTeachingShare)}% non-teaching`).join('; ');
    h += `<div class="card"><details><summary>How the numbers are worked out</summary>
      <div class="formula">After VAT (D)        = Amount paid - VAT
BUET deduction (E)   = rate x D        [${esc(wt)}; all other: ${pct(r.other.buetDeduction)}% / ${pct(r.other.nonTeachingShare)}%]
To distribute (F)    = ROUND(Amount - VAT - Expenses - E)
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
      <p class="muted small">ROUND is Excel's: halves go away from zero. A pool with nobody in it, or with all counts zero, pays nothing and raises a warning so the money is not lost silently.</p></details></div>`;
    $('#tab-results').innerHTML = h;
  }
  $('#tab-results').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'print') window.print();
    else if (b.id === 'xlsx-res') exportXlsx();
    else if (b.id === 'csv-res') exportCsv();
    else if (b.dataset.row) goRow(Number(b.dataset.row));
  });
  function goRow(n) {
    setTab('projects');
    const tr = $(`#ptable tbody tr[data-row="${n}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: 'center' });
    tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1800);
  }

  // ---------------------------------------------------------------- 4. import / export
  let pending = null;
  function renderData() {
    $('#tab-data').innerHTML = `
      <div class="card"><div class="card-head"><div><h2>Import projects</h2>
        <p class="muted small" style="margin:0">Use the Google Form response sheet, or any sheet with the same kind of headers: <i>Date, Client Name, Work Details, Work Type, BME Ref, BRTC Ref, Amount Paid, VAT, Expenses</i>, then <i>&lt;person&gt; Status</i> and <i>&lt;person&gt; Self Count</i>. People are found by the names in <a href="#" data-goto="people">People &amp; rates</a> (add an alias for another spelling), so set them up first.</p></div></div>
        <label class="drop" id="drop" for="imp-file"><b>Drop an Excel or CSV file here</b><br>or click to choose one<input type="file" id="imp-file" class="sr" accept=".xlsx,.xls,.csv,.tsv,.txt"></label>
        <div class="toolbar"><label class="field" id="sheet-pick" hidden>Sheet<select id="imp-sheet"></select></label></div>
        <details><summary>Or paste rows copied from a spreadsheet (include the header row)</summary>
          <textarea id="imp-paste" placeholder="Paste here"></textarea><p><button id="imp-paste-go">Preview pasted rows</button></p></details>
        <div id="imp-preview"></div>
      </div>
      <div class="card"><h2>Export</h2><div class="grid-3">
        <div class="tile"><h3>Excel workbook</h3><p class="muted small">Inputs, every calculation sheet and the summary, as values.</p><button class="primary" id="x-xlsx">Download .xlsx</button></div>
        <div class="tile"><h3>Summary CSV</h3><p class="muted small">One line per person, for a payment list.</p><button id="x-csv">Download .csv</button></div>
        <div class="tile"><h3>Blank input template</h3><p class="muted small">Headers matching your current people, ready to fill.</p><button id="x-tpl">Download template</button></div>
      </div></div>
      <div class="card"><h2>Backup and restore</h2><p class="muted small">Your work is saved automatically in this browser only. Keep a JSON copy of each period, or use it to move to another computer.</p>
        <div class="toolbar"><button id="x-json">Save everything as a JSON file</button>
        <label class="btn" for="imp-json">Load a saved JSON file</label><input type="file" id="imp-json" class="sr" accept=".json,application/json"></div></div>
      <div class="card"><h2>Start over</h2><div class="toolbar">
        <button id="x-clear" class="danger">Clear all projects (keep people and rates)</button>
        <button id="x-demo" class="danger">Reset to the demo data</button></div></div>`;
  }
  const tabData = $('#tab-data');
  tabData.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'imp-file' && el.files[0]) readFile(el.files[0]);
    if (el.id === 'imp-sheet') previewRows(sheetRows(el.value));
    if (el.id === 'imp-json' && el.files[0]) {
      const fr = new FileReader();
      fr.onload = () => {
        try { state = normalise(JSON.parse(fr.result)); isDemo = false; save(); updateBar(); toast('Loaded.', 'good'); setTab('projects'); }
        catch (e) { toast('That file is not a saved BRTC calculator file.', 'bad'); }
      };
      fr.readAsText(el.files[0]);
    }
  });
  ['dragenter', 'dragover'].forEach((t) => tabData.addEventListener(t, (ev) => { if (ev.target.closest('#drop')) { ev.preventDefault(); $('#drop').classList.add('over'); } }));
  ['dragleave', 'drop'].forEach((t) => tabData.addEventListener(t, (ev) => { if (ev.target.closest('#drop')) { ev.preventDefault(); $('#drop').classList.remove('over'); if (t === 'drop' && ev.dataTransfer.files[0]) readFile(ev.dataTransfer.files[0]); } }));
  tabData.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'imp-paste-go') previewRows(IO.parseDelimited($('#imp-paste').value));
    else if (b.id === 'imp-replace' || b.id === 'imp-append') applyImport(b.id === 'imp-append');
    else if (b.id === 'x-xlsx') exportXlsx();
    else if (b.id === 'x-csv') exportCsv();
    else if (b.id === 'x-tpl') exportTemplate();
    else if (b.id === 'x-json') { download(`brtc-${stamp()}.json`, JSON.stringify({ ...state, demo: false }, null, 1), 'application/json'); toast('Saved a JSON copy.', 'good'); }
    else if (b.id === 'x-clear' && confirm('Delete every project row? People and rates are kept.')) { markReal(); state.projects = []; save(); updateBar(); toast('All projects cleared.'); }
    else if (b.id === 'x-demo' && confirm('Replace everything with the invented demo data?')) { useDemo(); $('#demo-banner').hidden = false; save(); updateBar(); toast('Demo data restored.'); }
  });

  let workbook = null;
  const sheetRows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
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
    let h = `<div class="good-box">Found <b>${out.projects.length}</b> projects. Project columns found: ${esc(Object.keys(m.fieldCol).join(', '))}. Person columns matched: <b>${m.personCols.length}</b>.</div>`;
    h += `<details><summary>Which column went to which person</summary><div class="wrap free" style="max-height:30vh"><table class="num"><thead><tr><th class="l">Header</th><th class="l">Person</th><th class="l">Field</th></tr></thead><tbody>${m.personCols.map((p) => `<tr><td class="l">${esc(p.header)}</td><td class="l">${esc(p.name)}</td><td class="l">${p.field}</td></tr>`).join('')}</tbody></table></div></details>`;
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
    $('#imp-preview').innerHTML = '<div class="good-box">Imported. Open <a href="#" data-goto="results">Results</a> and compare the totals with your workbook.</div>';
    toast('Projects imported.', 'good');
  }

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
    toast('Excel file downloaded.', 'good');
  }
  function exportCsv() {
    const res = E.calculate(state.config, state.projects);
    const q = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const lines = [['Name', 'Group', 'Common pool', 'Team', 'Total', 'Approx deposit'].join(',')];
    res.people.forEach((p) => lines.push([q(p.name), p.kind, p.common, p.team, p.total, p.deposit].join(',')));
    lines.push(['Head account', 'head', '', '', res.summary.headAccount, res.summary.headAccount * (1 - res.rates.brtcTax)].join(','));
    download(`brtc-summary-${stamp()}.csv`, lines.join('\n'), 'text/csv');
    toast('CSV downloaded.', 'good');
  }
  function exportTemplate() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IO.templateHeader(state.config)]), 'Form Responses 1');
    XLSX.writeFile(wb, 'brtc-input-template.xlsx');
  }

  // ---------------------------------------------------------------- help and theme
  const helpDlg = $('#helpdlg');
  $('#help-btn').addEventListener('click', () => {
    helpDlg.innerHTML = `<div class="dlg"><header><h2>Help</h2><button class="ghost" id="help-x" aria-label="Close">✕</button></header><div class="dlg-body">
      <h3 style="margin-top:0">Quick guide</h3>
      <ol class="tight"><li><b>People &amp; rates</b>: who shares the money, their weighting factor, and the rates.</li>
      <li><b>Projects</b>: one row per BRTC payment. Press <b>Team</b> on a row to say who worked on it.</li>
      <li><b>Results</b>: amount per person, the split of each payment, print or download.</li>
      <li><b>Import / export</b>: load a spreadsheet, download Excel or CSV, back up.</li></ol>
      <h3>Words used here</h3>
      <dl class="gloss">
        <dt>WF</dt><dd>Weighting factor: a person's weight when a pool is shared (for example Professor 1, Associate 0.9, Assistant 0.8, Lecturer 0.7).</dd>
        <dt>Head</dt><dd>The department head in a project. Their weight in the faculty common pool is the Head factor instead of their normal WF.</dd>
        <dt>To distribute</dt><dd>What is left of a payment after VAT, the BUET deduction and expenses.</dd>
        <dt>Head account</dt><dd>The share of every payment that goes to the department/head account.</dd>
        <dt>Common pool</dt><dd>The half of the remaining money shared by weighting factor among everyone in the pool, whether or not they worked on the project.</dd>
        <dt>Team pool</dt><dd>The other half, shared among the people who worked on that project, by count times WF.</dd>
        <dt>Count</dt><dd>A person's share of work in a project's team pool. 0 means not on the team.</dd>
        <dt>Rounding difference</dt><dd>Every share is rounded to whole taka, so the parts can differ from the total by a few taka.</dd>
        <dt>Approx. deposit</dt><dd>Total after the BRTC tax percentage. An estimate, not BRTC's figure.</dd>
      </dl>
      <h3>Your data</h3><p class="small">Everything stays in this browser. Use <b>Import / export → Save everything as a JSON file</b> to keep a copy. Clearing the browser's site data erases the saved copy.</p>
    </div><footer><span class="spacer"></span><button class="primary" id="help-ok">Close</button></footer></div>`;
    helpDlg.showModal();
  });
  helpDlg.addEventListener('click', (ev) => { if (ev.target === helpDlg || ev.target.id === 'help-x' || ev.target.id === 'help-ok') helpDlg.close(); });
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    prefs.theme = dark ? 'light' : 'dark'; applyTheme(); savePrefs();
  });

  // ---------------------------------------------------------------- start
  const saved = load();
  if (saved) { state = saved; isDemo = saved.demo; } else useDemo();
  $('#saved').textContent = saved ? 'Saved on this device' : '';
  setTab('projects');
})();
