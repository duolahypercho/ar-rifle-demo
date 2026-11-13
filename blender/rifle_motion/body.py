"""The per-body table: every measurement of the body the clips are fitted to (palm, legs, feet,
stance, holds, the slung guns, the aim's shoulder pocket and eye, the belt kit...), read from
rifle_motion/bodies/<name>.json. build_rifle_motion.py selects the table with BODY / FRAMES
(`TABLE`) BEFORE it reloads the other modules, which read it at import time:

    from . import body
    PALM_LOCAL = Vector(body.T['palm'])

A body without its own table cannot be built: write one (UE5_SKELETON.md, "Adding a body").
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT = 'civilian-m-01-player-ue5'
T = {}


def select(name=DEFAULT):
    """Loads bodies/<name>.json into T (in place, so modules imported earlier see it too)."""
    data = json.loads((HERE / 'bodies' / f'{name}.json').read_text())
    T.clear()
    T.update(data)
    return T


select(DEFAULT)
