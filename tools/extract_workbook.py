"""
Read the departmental BRTC workbook (v2 layout) and write a JSON file with
  - config   : roster, weighting factors, rates (what the calculator needs)
  - projects : one entry per row of 'Form Responses 1'
  - expected : every number the workbook itself calculated (cached values)

tools/verify.mjs feeds config + projects to js/engine.js and compares every
cell with `expected`. Nothing here is committed with real data: run it locally
against your own copy of the workbook.

usage: python tools/extract_workbook.py "<workbook.xlsx>" <out.json>
"""
import json
import re
import sys
from datetime import datetime

import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
wf = openpyxl.load_workbook(src)  # formulas, to confirm the layout assumptions
form, summary = wb['Form Responses 1'], wb['Summary']
basic, fcp, ft = wb['Basic Calculation'], wb['Faculty Common Pool'], wb['Faculty Team']
ntc, ntt = wb['Non_teaching Common'], wb['Non_teaching Team']


def v(ws, ref):
    return ws[ref].value


def col(letter):
    return openpyxl.utils.column_index_from_string(letter)


# ---- layout assumptions that the engine relies on (fail loudly if the workbook changed)
assert 'IF($C2="Test",0.3,0.195)' in wf['Basic Calculation']['E2'].value.replace(' ', '')
assert 'IF($C2="Test",0.12,0.06)' in wf['Basic Calculation']['H2'].value.replace(' ', '')
assert wf['Basic Calculation']['G2'].value.replace(' ', '') == '=ROUND(($F2*0.05),0)'
assert wf['Basic Calculation']['J2'].value.replace(' ', '') == '=0.5*$I2'
assert '$F$14' in wf['Non_teaching Common']['C18'].value and '$F$13' in wf['Non_teaching Common']['C23'].value
assert '$F$12' in wf['Non_teaching Common']['M23'].value and '$H$12' in wf['Non_teaching Common']['M22'].value
assert wf['Faculty Common Pool']['C9'].value.replace(' ', '').startswith("=IF(('FormResponses1'!$L2)=\"Head\",2.25")

def alias_from_header(h):
    """'Lec-1 (Name) Self Count (if ...)' -> 'Name';  'Mr Name Count (if ...)' -> 'Name'"""
    h = str(h or '')
    m = re.search(r'\((?!if\b)([^)]*)\)', h)
    if m:
        return m.group(1).strip()
    h = re.sub(r'\(.*?\)', '', h)
    h = re.sub(r'\b(Mr|Ms|Mrs|Dr\.?|Count|Self|Status)\b', '', h, flags=re.I)
    return ' '.join(h.split())


# ---- roster (names come from the Summary sheet)
# Summary rows of the seven faculty lines, in the workbook's order (f1..f7)
fac_rows = {'f1': 9, 'f2': 10, 'f3': 11, 'f4': 12, 'f5': 13, 'f6': 14, 'f7': 16}
fac_wf = {'f1': v(ft, 'E3'), 'f2': v(ft, 'E4'), 'f3': v(ft, 'E5'), 'f4': v(ft, 'E6'),
          'f5': v(ft, 'E7'), 'f6': v(ft, 'E8'), 'f7': v(fcp, 'E7')}
# (status column, count column) in 'Form Responses 1'
fac_cols = {'f1': ('L', 'M'), 'f2': ('N', 'O'), 'f3': ('P', 'Q'), 'f4': (None, 'R'),
            'f5': (None, 'S'), 'f6': (None, 'T'), 'f7': (None, None)}
faculty = []
for key, srow in fac_rows.items():
    faculty.append({
        'id': key, 'name': v(summary, f'C{srow}'), 'wf': fac_wf[key],
        'aliases': alias_from_header(v(form, f'{fac_cols[key][1]}1')) if fac_cols[key][1] else '',
        # f4 is not a column of the common pool sheet; f7 has 0 in every common-pool cell and no team column
        'inCommon': key not in ('f4', 'f7'),
        'inTeam': key != 'f7',
    })

staff_cols = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE']
staff = []
# the form headers use short names ("Mr <Name> Count"); the common sheet lists another short spelling: keep both as aliases
for i, c in enumerate(staff_cols):
    aliases = [v(ntc, f'E{2 + i}'), alias_from_header(v(form, f'{c}1'))]
    staff.append({'id': f's{i + 1}', 'name': v(summary, f'C{17 + i}'), 'aliases': ', '.join(dict.fromkeys(a for a in aliases if a)),
                  'wf': v(ntc, f'F{2 + i}'), 'commonFrom': 1})
# the last staff member enters the common pool from the 6th project (row 23 of the sheet = project 6)
staff[10]['commonFrom'] = 6
for i in range(11):
    assert v(ntt, f'F{3 + i}') == v(ntc, f'F{2 + i}'), 'team and common WF differ'

# ---- projects
projects = []
for r in range(2, 85):
    ref = v(form, f'H{r}')
    if ref in (None, ''):
        continue
    d = v(form, f'C{r}')
    p = {
        'date': d.strftime('%Y-%m-%d') if isinstance(d, datetime) else str(d or ''),
        'client': v(form, f'D{r}'), 'details': v(form, f'E{r}'), 'workType': v(form, f'F{r}'),
        'bmeRef': str(v(form, f'G{r}') or ''), 'brtcRef': str(ref),
        'amount': v(form, f'I{r}'), 'vat': v(form, f'J{r}'), 'expense': v(form, f'K{r}'),
        'status': {}, 'count': {}, '_sheet_row': r,
    }
    for key, (stc, cc) in fac_cols.items():
        if stc:
            p['status'][key] = v(form, f'{stc}{r}') or ''
        if cc:
            p['count'][key] = v(form, f'{cc}{r}') or 0
    for i, c in enumerate(staff_cols):
        p['count'][f's{i + 1}'] = v(form, f'{c}{r}') or 0
    projects.append(p)

# the workbook has Basic Calculation formulas only for these rows; they must line up with the form rows
assert [p['_sheet_row'] for p in projects] == list(range(2, 2 + len(projects)))
n = len(projects)

# ---- expected values
exp = {'basic': [], 'facultyCommon': [], 'facultyTeam': [], 'staffCommon': [], 'staffTeam': [], 'summary': {}}
fcp_cols = {'f1': 'D', 'f2': 'F', 'f3': 'H', 'f5': 'J', 'f6': 'L', 'f7': 'N'}
ft_cols = {'f1': 'D', 'f2': 'F', 'f3': 'H', 'f4': 'J', 'f5': 'L', 'f6': 'N'}
ntc_cols = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
ntt_cols = ['D', 'F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X']
for i in range(n):
    exp['basic'].append({k: v(basic, f'{k}{2 + i}') for k in 'DEFGHIJK'})
    exp['facultyCommon'].append({k: v(fcp, f'{c}{9 + i}') for k, c in fcp_cols.items()})
    exp['facultyTeam'].append({k: v(ft, f'{c}{10 + i}') for k, c in ft_cols.items()})
    exp['staffCommon'].append({f's{j + 1}': v(ntc, f'{c}{18 + i}') for j, c in enumerate(ntc_cols)})
    exp['staffTeam'].append({f's{j + 1}': v(ntt, f'{c}{19 + i}') for j, c in enumerate(ntt_cols)})
sm = exp['summary']
sm['totalPaidByClient'] = v(summary, 'D2')
sm['totalExpenses'] = v(summary, 'D3')
sm['totalAfterDeductions'] = v(summary, 'D4')
sm['headAccountWithExpenses'] = v(summary, 'D6')
sm['headAccount'] = v(summary, 'D7')
sm['distributed'] = v(summary, 'D28')
sm['roundingCheck'] = v(summary, 'D29')
sm['headDeposit'] = v(summary, 'J4')
sm['people'] = {}
people_rows = dict(fac_rows)
for k, r in people_rows.items():
    sm['people'][k] = v(summary, f'D{r}')
for i in range(11):
    sm['people'][f's{i + 1}'] = v(summary, f'D{17 + i}')
# individual approximate deposits (right-hand block of Summary): F5.. = D9.., J = 0.85 x
dep = {'f1': 5, 'f2': 6, 'f3': 7, 'f4': 8, 'f5': 9, 'f6': 10, 'f7': 12}
sm['deposit'] = {k: v(summary, f'J{r}') for k, r in dep.items()}
for i in range(11):
    sm['deposit'][f's{i + 1}'] = v(summary, f'J{13 + i}')

for p in projects:
    p.pop('_sheet_row')
json.dump({'config': {'faculty': faculty, 'staff': staff, 'rates': {}}, 'projects': projects, 'expected': exp},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
print('projects', n, 'faculty', len(faculty), 'staff', len(staff), '->', out)
