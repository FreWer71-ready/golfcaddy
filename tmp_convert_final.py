import pandas as pd,unicodedata,re,json,os,sys

def norm(s):
    if s is None: return ''
    s=str(s)
    s=unicodedata.normalize('NFKD', s)
    s=s.encode('ascii','ignore').decode('ascii')
    return re.sub(r'\s+','',s).lower()

excel_path = r"C:\Users\sefrwer001\.copilot\workspaces\2beeb79b-f33f-447d-9fd5-e1d3078b9119\attachments\ee34e2a9-2d4c-4ff0-afb3-47bbf1477071-golfstatistik_ronder_slutlig.xlsx"
xls = pd.ExcelFile(excel_path, engine='openpyxl')
# find exact halldata sheet
target = None
for s in xls.sheet_names:
    if norm(s) == 'haldata' or 'haldata' in norm(s) or 'hal' in norm(s) and 'data' in norm(s):
        target = s; break
if target is None:
    print('No halldata-like sheet, sheets:', xls.sheet_names, file=sys.stderr); sys.exit(2)
print('using sheet', target)
# load raw
raw = pd.read_excel(excel_path, sheet_name=target, header=None, engine='openpyxl')
# find header row by presence of 'hål' and 'brutto'
header_row = None
for i in range(min(15,len(raw))):
    norms=[norm(x) for x in raw.iloc[i].astype(str).tolist()]
    if any('hal' in n for n in norms) and any('brut' in n or 'bruto' in n or 'brutto' in n or 'br'==n[:2] for n in norms):
        header_row = i; break
if header_row is None:
    # try row where first cell equals 'Rond Nr' or similar
    for i in range(min(15,len(raw))):
        row0 = raw.iloc[i,0]
        if isinstance(row0,str) and 'rond' in norm(row0): header_row = i; break
if header_row is None: header_row=1
print('header_row', header_row)
df = pd.read_excel(excel_path, sheet_name=target, header=header_row, engine='openpyxl')
print('columns detected:', list(df.columns)[:10])
# find hole and brutto columns
cols = list(df.columns)
norm_map = {norm(c):c for c in cols}
hole_col=None; score_col=None
for k,c in norm_map.items():
    if 'hal' in k and ('nr' in k or 'nummer' in k or k=='hal'):
        hole_col=c
    if 'brut' in k or 'brutto' in k or 'bruto' in k:
        score_col=c
if hole_col is None:
    for k,c in norm_map.items():
        if 'hal' in k or k=='h': hole_col=c; break
if score_col is None:
    for k,c in norm_map.items():
        if 'brut' in k or 'br'==k[:2] or 'score' in k or 'brutto' in k: score_col=c; break
print('hole_col,score_col =', hole_col, score_col)
if hole_col is None or score_col is None:
    print('Could not identify columns, columns:', cols, file=sys.stderr); sys.exit(3)
# try to detect a club/course column
club_col=None
for k,c in norm_map.items():
    if any(x in k for x in ('bana','klubb','klub','anlagg','anlag','plats','course','club','golf')):
        club_col=c; break
if club_col:
    print('Detected club/course column:', club_col)
else:
    print('No club/course column detected; will not filter by club')

# Build maps: per-club and combined
clubs_map = {}
combined = {}
if club_col:
    for _,r in df[[hole_col,score_col,club_col]].iterrows():
        h=r[hole_col]; s=r[score_col]; club=r[club_col]
        try:
            h=int(float(h)); s=int(float(s))
        except Exception:
            continue
        if not (1<=h<=18):
            continue
        club_key = norm(club) or 'okand'
        clubs_map.setdefault(club_key, {}).setdefault(str(h), []).append(s)
        combined.setdefault(str(h), []).append(s)
else:
    for _,r in df[[hole_col,score_col]].iterrows():
        h=r[hole_col]; s=r[score_col]
        try:
            h=int(float(h)); s=int(float(s))
        except Exception:
            continue
        if not (1<=h<=18):
            continue
        combined.setdefault(str(h), []).append(s)

# sort lists
for clubk in clubs_map:
    for k in list(clubs_map[clubk].keys()):
        clubs_map[clubk][k] = sorted(clubs_map[clubk][k])
for k in list(combined.keys()):
    combined[k] = sorted(combined[k])

# prepare output structure with readable club names
output = {'all': combined}
# try to keep original club display names (first occurrence)
club_display = {}
if club_col:
    for _,r in df[[club_col]].iterrows():
        c = r[club_col]
        if c is None: continue
        k = norm(c)
        if k not in club_display:
            club_display[k] = str(c)
for k,v in clubs_map.items():
    output[k] = v

print('clubs detected:', list(clubs_map.keys())[:10])
print('counts per hole sample (combined):', {k:len(v) for k,v in list(combined.items())[:6]})

# write both files
os.makedirs('assets/data', exist_ok=True)
with open('assets/data/hole_scores.json','w',encoding='utf-8') as f:
    json.dump(combined,f,ensure_ascii=False,indent=2)
with open('assets/data/hole_scores_by_club.json','w',encoding='utf-8') as f:
    json.dump(output,f,ensure_ascii=False,indent=2)
print('WROTE assets/data/hole_scores.json total_rows', sum(len(v) for v in combined.values()))
print('WROTE assets/data/hole_scores_by_club.json clubs', len(list(output.keys())))
