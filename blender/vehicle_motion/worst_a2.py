"""worst.py <frames.txt>: the worst value of each gated measure over a clip's frames (pairs with the frame)."""
import sys, re, ast
rows = open(sys.argv[1]).read().splitlines()[1:]
W = {}
def up(k, v, i, extra=''):
    if k not in W or v > W[k][0]: W[k] = (v, i, extra)
for row in rows:
    m = re.match(r'\s*(\d+) hard (.*?) seat (.*?) head (.*?) contacts (.*?)( arms (.*))?$', row)
    i = int(m.group(1))
    hard = ast.literal_eval(m.group(2)) if m.group(2).strip() != '-' else {}
    seat = ast.literal_eval(m.group(3)) if m.group(3).strip() != '-' else {}
    for k, v in hard.items(): up('hard cm', v, i, k)
    for k, v in seat.items(): up('soft cm', v, i, k)
    for w, d in re.findall(r'(\S+) (-?[\d.]+)', m.group(4)):
        if w not in ('door_glass_L', 'cockpit_door_R_glass') and not w.startswith('seat'): up('head -clear cm', -float(d), i, w)
    for c in m.group(5).split(', '):
        if c == '-': continue
        nm, d = c.rsplit(' ', 1); up('contact cm', float(d), i, nm)
    if m.group(7):
        for s, el, fl, dv in re.findall(r'([LR]) elbow (-?\d+) flex ([+-]\d+) dev ([+-]\d+)', m.group(7)):
            up('|flex|', abs(int(fl)), i, s); up('|dev|', abs(int(dv)), i, s); up('-elbow', -int(el), i, s)
        kn = re.search(r'knees (\d+) / (\d+)', m.group(7))
        up('-knee', -min(int(kn.group(1)), int(kn.group(2))), i)
for k, v in W.items(): print(f'{k}: {v[0]} at {v[1]} {v[2]}')
