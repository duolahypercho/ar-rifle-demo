"""gate_a4.py <review dir> <clip> [...]: the athletic gate (VEHICLE_NOTES.md "Third request") on a clip's <clip>-a4.json and
the speeds60 line the build wrote: hands / feet 8 m/s, head / pelvis 5, velocity change per 60 Hz sample 6 except within 2
frames after events.ground; ground contacts within 1.5 cm while planted; no body part more than 3 cm into the ground
while rolling (the clip's `roll` windows; reported for the whole clip too); joins (relative to the pelvis: 10 mm / 2 deg
for a join meant exact, reported for the 0.2 s blends); wrists |flex| <= 70, |dev| <= 50; the hand's twist <= 40 deg a
frame; elbows and knees >= 5 deg. Vehicle-frame clips (car-bail, heli-jump): hard pairs <= 2.0 cm, the start's join to
the seated reference 1 mm / 0.5 deg."""
import json
import re
import sys

EXACT = {'bail-roll': ('car-bail end',), 'land-roll': (), 'land-hard': (), 'fall': ()}


def gate(d, clip):
    a = json.load(open(f'{d}/{clip}-a4.json'))
    fails = []
    sp = None
    for f in ('speeds60-partial.txt', 'speeds60.txt'):
        try:
            for line in open(f'{d}/{f}'):
                if line.startswith(clip + ' SPEED'):
                    sp = line.strip()
        except OSError:
            pass
        if sp:
            break
    if sp is None:
        fails.append('speeds60: no line')
    elif 'FAIL' in sp:
        fails.append(sp.split(': ', 1)[1][:300])
    for c in a['contactCm']:
        if c[5] > 1.5:
            fails.append(f'contact {c[0]} {c[1]}-{c[2]} {c[5]} cm')
    if a['rollUnderMaxCm'] > 3.0:
        fails.append(f"ground {a['rollUnderMaxCm']} cm at {a['rollUnderAt']}")
    for side, fl, dv in re.findall(r'(Left|Right) flex ([+-]\d+) \(f\d+\) dev ([+-]\d+)', a['wristWorst']):
        if abs(int(fl)) > 70 or abs(int(dv)) > 50:
            fails.append(f'wrist {side} flex {fl} dev {dv}')
    if a['twistStepDeg'] > 40:
        fails.append(f"twist {a['twistStepDeg']} at {a['twistAt']}")
    if a['elbowMinDeg'] < 5:
        fails.append(f"elbow {a['elbowMinDeg']} at {a.get('elbowAt')}")
    if a['kneeMinDeg'] < 5:
        fails.append(f"knee {a['kneeMinDeg']} at {a.get('kneeAt')}")
    for k, v in a.items():
        if k.startswith('joinMm ') and k[7:] in EXACT.get(clip, ()):
            if v > 10 or a['joinDeg ' + k[7:]] > 2:
                fails.append(f'{k} {v} / {a["joinDeg " + k[7:]]}')
    n = a.get('numbers', {})
    if 'hardMaxCm' in n and float(n['hardMaxCm']) > 2.0:
        fails.append(f"hard {n['hardMaxCm']} cm")
    if 'joinErr' in n:
        m = re.match(r'([\d.]+) mm .*?/ ([\d.]+) deg', n['joinErr'])
        if m and (float(m.group(1)) > 1.0 or float(m.group(2)) > 0.5):
            fails.append(f"start join {n['joinErr']}")
    joins = '; '.join(f'{k[5:]} {a[k]}' for k in a if k.startswith('join ') and not k.startswith('joinMm') and not k.startswith('joinDeg'))
    print(f"{clip}: {a['duration']:.3f} s, events {a['events']}; ground in {a['groundUnderMaxCm']} cm (rolling {a['rollUnderMaxCm']}); "
          f"wrists {a['wristWorst']}; twist {a['twistStepDeg']}; elbow {a['elbowMinDeg']}, knee {a['kneeMinDeg']}; contacts max "
          f"{max([c[5] for c in a['contactCm']] or [0])}; joins {joins or '-'}; {sp.split(': ', 1)[0] if sp else ''}")
    print('GATE PASS' if not fails else 'FAIL ' + ' | '.join(fails))
    return not fails


if __name__ == '__main__':
    ok = all([gate(sys.argv[1], c) for c in sys.argv[2:]])
