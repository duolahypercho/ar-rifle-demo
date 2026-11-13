"""Pass R4: rebuild everything under unreal/ that is out of date, then check it.

  python3 blender/export_unreal/make.py            # changed outputs only, then checks + proof if anything changed
  python3 blender/export_unreal/make.py --force    # everything
  python3 blender/export_unreal/make.py --no-proof # skip the Blender round-trip proof (the FBX header check still runs)
  python3 blender/export_unreal/make.py --proof    # run the proof even if nothing changed

Each output's inputs (GLB / JSON bytes; per clip only that clip's channel bytes) and the export
scripts are hashed into unreal/manifest.json; an output is rebuilt only when its hash changes.
Blender runs headless and private (--factory-startup), several at a time.

Pass U1 added the vehicle clip packs (animations/<tripo|earthonline>-vehicle/), the two vehicles
(vehicles/), their own clips and the vehicle side of every pack clip (vehicles/animations/), the per-clip
data for Unreal (animations/<pack>-vehicle/data/, vehicle_data.py) and their checks. Paths: config.py
(everything relative to the project; R4_OUT / R4_SCRATCH / R4_BLENDER override); no FBX holds an absolute
path (bl_common.relative_media_paths; check_fbx.check_paths counts them).
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
import gltfio as G

HERE = config.HERE
MANIFEST = os.path.join(config.OUT, 'manifest.json')
BUILD_SCRIPTS = ['build_unreal.py', 'bl_common.py', 'skeleton.py', 'gltfio.py', 'config.py', 'vehicle.py']
JOBS = int(os.environ.get('R4_JOBS', '4'))


def sha(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode())
    return h.hexdigest()[:16]


def fsha(path):
    return sha(open(path, 'rb').read()) if path and os.path.exists(path) else 'none'


def clip_hashes(pack_path):
    g = G.GLB(pack_path)
    out = {}
    for a in g.json['animations']:
        h = hashlib.sha256()
        for s in a['samplers']:
            for acc in (s['input'], s['output']):
                ac = g.json['accessors'][acc]
                bv = g.json['bufferViews'][ac['bufferView']]
                o = bv.get('byteOffset', 0)
                h.update(g.bin[o:o + bv['byteLength']])
        h.update(json.dumps([(c['target'], c['sampler']) for c in a['channels']], sort_keys=True).encode())
        out[a['name']] = h.hexdigest()[:16]
    return out


def blender(script, *args):
    cmd = [config.BLENDER, '-b', '--factory-startup', '--python-exit-code', '1', '--python',
           os.path.join(HERE, script), '--', *args]
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    tag = ' '.join(args[:2]) + (f' (+{len(args) - 2} clips)' if len(args) > 2 else '')
    if r.returncode != 0:
        print(r.stdout[-4000:], r.stderr[-4000:])
        raise SystemExit(f'Blender failed: {script} {tag}')
    print(f'  {script} {tag}: {time.time() - t:.0f} s', flush=True)
    return r.stdout


def stale(folder, keep, prefix=''):
    """Remove FBX in `folder` that are no longer outputs (clips that left a pack)."""
    if os.path.isdir(folder):
        for fn in os.listdir(folder):
            if fn.endswith('.fbx') and fn[:-4] not in keep:
                os.remove(os.path.join(folder, fn))
                print('  removed stale', config.rel(os.path.join(folder, fn)))


def vehicle_jobs(man, want, scripts, frames):
    """Pass U1: the vehicle clip packs on both skeletons, the two vehicles, their own clips and the vehicle side of
    every pack clip. Hashes as for the rifle clips: per clip its channel bytes; the vehicle side of a pack hangs
    on the vehicle GLB and the pack's notes (door, fit) and keys."""
    import vehicle as V
    jobs = []
    out = config.OUT

    def need(k, h):
        want[k] = h
        return man.get(k) != h or not os.path.exists(os.path.join(out, k))
    for pk, pcfg in config.VEHICLE_PACKS.items():
        skel = pcfg['skeleton']
        cfg = config.PACKS[skel]
        body = fsha(config.body_glb(cfg['body']))
        rifle = clip_hashes(cfg['pack'])
        dep = sha(rifle[config.EXTRA_BONES['Gun'][0]], rifle[config.EXTRA_BONES['GunIn'][0]])   # Gun / GunIn rests
        ch = clip_hashes(pcfg['pack'])
        d = os.path.join(out, 'animations', pk)
        stale(d, ch)
        os.makedirs(d, exist_ok=True)
        shutil.copyfile(pcfg['notes'], os.path.join(d, 'notes.json'))
        todo = [clip for clip, hc in ch.items() if need(f'animations/{pk}/{clip}.fbx', sha(scripts, body, frames[skel], dep, hc))]
        n = max(1, min(JOBS, (len(todo) + 5) // 6))
        for i in range(n):
            if todo[i::n]:
                jobs.append(('build_unreal.py', 'vanims', pk, *todo[i::n]))
    for name, vcfg in config.VEHICLES.items():
        glb = fsha(vcfg['glb'])
        if need(f'vehicles/{name}.fbx', sha(scripts, glb)):
            jobs.append(('build_unreal.py', 'vehicle', name))
        own = V.Vehicle(name).own_clips()
        if any([need(f'vehicles/animations/own/{name}_{c}.fbx', sha(scripts, glb)) for c in own]):
            jobs.append(('build_unreal.py', 'vehanims', name, 'own'))
        for pk, pcfg in config.VEHICLE_PACKS.items():
            notes = json.load(open(pcfg['notes']))
            clips = [c for c, v in notes['clips'].items() if v['vehicle'] == vcfg['kind']] + ['fit']
            h = sha(scripts, glb, fsha(pcfg['notes']), fsha(pcfg['pack']))
            if any([need(f'vehicles/animations/{pk}/{name}_{c}.fbx', h) for c in clips]):
                jobs.append(('build_unreal.py', 'vehanims', name, pk))
    for pk in config.VEHICLE_PACKS:   # each group folder holds both vehicles' files
        notes = json.load(open(config.VEHICLE_PACKS[pk]['notes']))
        keep = [f'{v}_{c}' for v, vc in config.VEHICLES.items()
                for c in [c for c, x in notes['clips'].items() if x['vehicle'] == vc['kind']] + ['fit']]
        stale(os.path.join(out, 'vehicles', 'animations', pk), keep)
    stale(os.path.join(out, 'vehicles', 'animations', 'own'),
          [f'{v}_{c}' for v in config.VEHICLES for c in V.Vehicle(v).own_clips()])
    return jobs


def main():
    force = '--force' in sys.argv
    t0 = time.time()
    man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) and not force else {}
    scripts = sha(*[open(os.path.join(HERE, s), 'rb').read() for s in BUILD_SCRIPTS])
    want = {}
    jobs = []
    packs = {k: fsha(v['pack']) for k, v in config.PACKS.items()}
    frames = {k: fsha(v['frames']) for k, v in config.PACKS.items()}
    for name, key in config.BODIES.items():
        h = sha(scripts, fsha(config.body_glb(name)), fsha(config.body_glb(config.PACKS[key]['body'])),
                packs[key], frames[key])
        want[f'bodies/{name}.fbx'] = h
        if man.get(f'bodies/{name}.fbx') != h or not os.path.exists(os.path.join(config.OUT, 'bodies', f'{name}.fbx')):
            jobs.append(('build_unreal.py', 'body', name))
    for key, cfg in config.PACKS.items():
        body = fsha(config.body_glb(cfg['body']))
        h = sha(scripts, body, packs[key], frames[key], fsha(config.APOSE))
        want[f'retarget/{key}_apose.fbx'] = h
        if man.get(f'retarget/{key}_apose.fbx') != h or not os.path.exists(os.path.join(config.OUT, 'retarget', f'{key}_apose.fbx')):
            jobs.append(('build_unreal.py', 'apose', key))
        ch = clip_hashes(cfg['pack'])
        # Gun / GunIn rests come from two clips: every clip depends on them
        dep = sha(ch[config.EXTRA_BONES['Gun'][0]], ch[config.EXTRA_BONES['GunIn'][0]])
        todo = []
        for clip, hc in ch.items():
            h = sha(scripts, body, frames[key], dep, hc)
            k = f'animations/{key}/{clip}.fbx'
            want[k] = h
            if man.get(k) != h or not os.path.exists(os.path.join(config.OUT, k)):
                todo.append(clip)
        # stale clips (no longer in the pack)
        d = os.path.join(config.OUT, 'animations', key)
        if os.path.isdir(d):
            for fn in os.listdir(d):
                if fn.endswith('.fbx') and fn[:-4] not in ch:
                    os.remove(os.path.join(d, fn))
                    print('  removed stale', key, fn)
        os.makedirs(d, exist_ok=True)
        shutil.copyfile(cfg['notes'], os.path.join(d, 'notes.json'))
        # split the clips over the workers
        n = max(1, min(JOBS, (len(todo) + 19) // 20))
        for i in range(n):
            part = todo[i::n]
            if part:
                jobs.append(('build_unreal.py', 'anims', key, *part))
    for g, cfg in config.GUNS.items():
        h = sha(scripts, fsha(cfg['glb']))
        want[f'weapons/{g}.fbx'] = h
        if man.get(f'weapons/{g}.fbx') != h or not os.path.exists(os.path.join(config.OUT, 'weapons', f'{g}.fbx')):
            jobs.append(('build_unreal.py', 'gun', g))
    jobs += vehicle_jobs(man, want, scripts, frames)
    if '--adopt' in sys.argv:   # record the existing outputs as up to date (after a manual build)
        print(f'R4 make: adopting {len(jobs)} jobs\' outputs without building', flush=True)
        jobs = []
    print(f'R4 make: {len(jobs)} Blender jobs', flush=True)
    if jobs:
        with ThreadPoolExecutor(JOBS) as ex:
            list(ex.map(lambda j: blender(*j), jobs))
    os.makedirs(config.OUT, exist_ok=True)
    with open(MANIFEST, 'w') as f:
        json.dump(want, f, indent=1, sort_keys=True)
    print('U1 make: vehicle clip data (curves, events, contacts, fit)', flush=True)
    import vehicle_data
    vehicle_data.main()
    print('R4 make: FBX header check', flush=True)
    import check_fbx
    chk = check_fbx.main()
    proof = ('--proof' in sys.argv or bool(jobs)) and '--no-proof' not in sys.argv
    if proof:
        print('R4 make: round-trip proof', flush=True)
        pj = [('proof_unreal.py', 'anims', key, *[c for c in config.PROOF_CLIPS]) for key in config.PACKS]
        pj += [('proof_unreal.py', 'body', name) for name in config.BODIES]
        # pass U1: every vehicle clip (every bone, every frame), the vehicles, the vehicle-side clips, the alignment
        pj += [('proof_unreal.py', 'vanims', pk) for pk in config.VEHICLE_PACKS]
        pj += [('proof_unreal.py', 'vehicle', name) for name in config.VEHICLES]
        pj += [('proof_unreal.py', 'vehanims', name, g) for name in config.VEHICLES for g in ['own', *config.VEHICLE_PACKS]]
        pj += [('proof_unreal.py', 'align', pk) for pk in config.VEHICLE_PACKS]
        with ThreadPoolExecutor(JOBS) as ex:
            list(ex.map(lambda j: blender(*j), pj))
    import report
    report.main()
    print(f'R4 make: done in {time.time() - t0:.0f} s; summary unreal/review/proof_summary.txt')


if __name__ == '__main__':
    main()
