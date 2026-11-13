"""Pass R2: the Blender review numbers of the UE5 pack against the old pack's, clip by clip.

  python3 blender/ue5_rig/compare_clips.py [new clips.txt] [old clips.txt]

Defaults: blender/review/ue5/clips.txt against blender/review/clips.txt. Body-part names in gunHits
(old joint names) are mapped to the UE5 bones that took them over. Prints every field that differs.
"""
import ast
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OLD_TO_NEW = {k: v['rotation'] for k, v in json.loads((ROOT / 'blender/ue5_rig/ue5_mapping.json').read_text())['old'].items()}
KEY = re.compile(r'(?:^|, )([A-Za-z0-9]+) ')


def parse(line):
    name, rest = line.split(': ', 1)
    keys = list(KEY.finditer(rest))
    out = {}
    for k, nxt in zip(keys, keys[1:] + [None]):
        out[k.group(1)] = rest[k.end(): nxt.start() if nxt else len(rest)].strip()
    return name, out


def hits(value, mapped):
    if value in ('0', '{}'):
        return {}
    d = ast.literal_eval(value)
    if not mapped:
        return d
    out = {}
    for key, n in d.items():
        parts = key.split('/')
        parts = [OLD_TO_NEW.get(p, p) for p in parts]
        out['/'.join(parts)] = out.get('/'.join(parts), 0) + n
    return out


def main():
    new_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'blender/review/ue5/clips.txt'
    old_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'blender/review/clips.txt'
    old = dict(parse(l) for l in old_path.read_text().splitlines() if ': ' in l)
    new = dict(parse(l) for l in new_path.read_text().splitlines() if ': ' in l)
    same = 0
    for name in new:
        if name not in old:
            print(f'{name}: not in the old review')
            continue
        o, n = old[name], new[name]
        diffs = []
        for k in sorted(set(o) | set(n)):
            a, b = o.get(k), n.get(k)
            if k == 'gunHits':
                ha, hb = hits(a or '0', True), hits(b or '0', False)
                if ha != hb:
                    diffs.append(f'gunHits {ha or 0} -> {hb or 0}')
            elif a != b:
                diffs.append(f'{k} {a} -> {b}')
        if diffs:
            print(f'{name}: ' + '; '.join(diffs))
        else:
            same += 1
    print(f'{same} of {len(new)} lines identical (names mapped); {len(set(old) - set(new))} old lines not in the new review')


if __name__ == '__main__':
    main()
