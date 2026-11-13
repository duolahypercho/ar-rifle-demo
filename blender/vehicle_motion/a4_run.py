"""(pass A4) Runs blender/build_vehicle_motion.py in a private headless Blender with the build's globals given as JSON,
so several builds can run at once and none touches the project's GUI Blender:

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/vehicle_motion/a4_run.py -- \
      '{"BODY_NAME": "tripo", "CLIPS": ["car-drive", "car-enter"], "ONLY": ["car-enter"], "EXPORT": true,
        "OUT_GLB": "<scratch>/x.glb", "REVIEW_DIR": "<scratch>/review", "NO_SHEETS": true}'

Extra keys: "ENV" {name: value} set in os.environ before the build (A3_WARPS / A4_WARPS: a warps file), "NS" {key: value}
put into bpy.app.driver_namespace (the fitting hooks the clip modules read).
"""
import json
import os
import pathlib
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
cfg = json.loads(argv[0]) if argv else {}
for k, v in cfg.pop('ENV', {}).items():
    os.environ[k] = str(v)
for k, v in cfg.pop('NS', {}).items():
    bpy.app.driver_namespace[k] = v
path = pathlib.Path(__file__).resolve().parent.parent / 'build_vehicle_motion.py'
g = dict(cfg)
g['__file__'] = str(path)
g['__name__'] = '__a4__'
exec(compile(path.read_text(), str(path), 'exec'), g)
