"""gate.py <clip> [refframes]: the coordinator's ship gate on a clip's line in clips(-partial).txt and its frames file."""
import sys, re, ast, collections, os
R = os.environ.get('GATE_DIR', __import__('os').path.expanduser('~/Desktop/Code/test/ar_rifle_demo/blender/review/vehicles/tripo/'))
SEATED = bool(os.environ.get('SEATED'))  # (a seated clip: no reference pairs tolerated, the seat (soft) is its allowed contact, no join)
clip = sys.argv[1]
TOL = 0.1  # cm: the depth measure's own jitter on the unchanged reference pose (car-drive frame 0: 4.53 .. 4.62 on the same pose)
line = None
for f in ('clips-partial.txt', 'clips.txt'):
    for l in open(R + f):
        if l.startswith(clip + ':'):
            line = l; break
    if line: break
def get(k):
    m = re.search(k + r' ([^,]*(?:, [^a-zA-Z][^,]*)*)', line); return m.group(1) if m else ''
SOFT = ('seat_driver', 'pilot_seat')
FING = re.compile(r'^(thumb|index|middle|ring|pinky)_0\d_(l|r)')
ref = {}  # the seated reference's own pairs at rest
reff = {'car': 'car-seated', 'heli': 'heli-collective-down'}['car' if clip.startswith('car') else 'heli']
try:
    if SEATED: raise RuntimeError('seated clip: no reference')
    l0 = open(R + reff + '-frames.txt').read().splitlines()[1]
    m = re.match(r'\s*(\d+) hard (.*?) seat (.*?) head', l0)
    for t in (m.group(2), m.group(3)):
        if t.strip() != '-': ref.update(ast.literal_eval(t))
except Exception as e:
    print('no reference frames', e)
fails = collections.defaultdict(list)
rows = open(R + clip + '-frames.txt').read().splitlines()[1:]
n = len(rows)
for row in rows:
    m = re.match(r'\s*(\d+) hard (.*?) seat (.*?) head (.*?) contacts (.*?)( arms (.*))?$', row)
    i = int(m.group(1))
    hard = ast.literal_eval(m.group(2)) if m.group(2).strip() != '-' else {}
    seat = ast.literal_eval(m.group(3)) if m.group(3).strip() != '-' else {}
    allp = {}
    # (all hard pairs; seat file lists only > 1 cm)
    for k, v in hard.items():
        if v > 2.0 and not (k in ref and v <= ref[k] + TOL):
            fails['hard>2.0'].append((i, k, v))
    for k, v in seat.items():
        if not SEATED and v > 4.5 and not (k in ref and v <= ref[k] + TOL):
            fails['soft>4.5'].append((i, k, v))
    for tok in m.group(4).split():
        pass
    hd = re.findall(r'(\S+) (-?[\d.]+)', m.group(4))
    for w, d in hd:
        if float(d) < 0 and w not in ('door_glass_L', 'cockpit_door_R_glass') and not w.startswith('seat'):
            fails['head inside'].append((i, w, float(d)))
    for c in m.group(5).split(', '):
        if c == '-': continue
        nm, d = c.rsplit(' ', 1)
        if float(d) > 1.5: fails['contact>1.5'].append((i, nm, float(d)))
    if m.group(7):
        a = re.findall(r'([LR]) elbow (-?\d+) flex ([+-]\d+) dev ([+-]\d+)', m.group(7))
        for s, el, fl, dv in a:
            if abs(int(fl)) > 70 or abs(int(dv)) > 50: fails['wrist'].append((i, s, int(fl), int(dv)))
            if int(el) < 5: fails['elbow<5'].append((i, s, int(el)))
        kn = re.search(r'knees (\d+) / (\d+)', m.group(7))
        if kn and min(int(kn.group(1)), int(kn.group(2))) < 5: fails['knee<5'].append((i, kn.group(0)))
snap = dict((k, float(v)) for k, v in re.findall(r'(\w+) ([\d.]+)', get('snap30')))
for k, v in snap.items():
    if (k == 'head' and v > 2.0) or (k != 'head' and v > 4.5): fails['snap'].append((k, v))
tw = float(get('twistStepDeg').split()[0])
if tw > 40: fails['twist>40'].append(get('twistStepDeg'))
j = get('joinErr'); mm = float(j.split()[0]); dg = float(j.split('/')[1].split()[0])
if not SEATED and (mm > 1.0 or dg > 0.5): fails['join'].append(j)
# (pass A3 round 2) the game's 60 Hz measure on the exported pack (build_vehicle_motion writes speeds60(-partial).txt):
# peak speed hands / feet 4.5, head 2.0, pelvis 1.8 m/s; velocity change between 60 Hz samples hands / feet 4.5 m/s
sp_line = None
if 'enter' in clip or 'exit' in clip:
    for f in ('speeds60-partial.txt', 'speeds60.txt'):
        try:
            for l in open(R + f):
                if l.startswith(clip + ' SPEED'):
                    sp_line = l.strip()
        except OSError:
            pass
        if sp_line:
            break
    if sp_line is None:
        fails['speed60 missing'].append('no speeds60 line (export the clip)')
    elif 'FAIL' in sp_line:
        fails['speed60'].append(sp_line.split(': ', 1)[1])
print(f'{clip}: frames {n}; snap30 {get("snap30")}; twist {get("twistStepDeg")}; join {j}; balance {get("balanceOutCm")}')
if not fails: print('GATE PASS')
for k, v in fails.items():
    fr = sorted({x[0] for x in v if isinstance(x[0], int)})
    worst = v[:3] if not fr else sorted(v, key=lambda x: -abs(x[-1]) if isinstance(x[-1], (int, float)) else 0)[:4]
    print(f'FAIL {k}: {len(v)} items, frames {fr[:40]}{"..." if len(fr) > 40 else ""} worst {worst}')
