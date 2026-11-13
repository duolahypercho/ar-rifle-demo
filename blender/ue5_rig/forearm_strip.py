"""Pass R2 review: a close-up strip of the right forearm through a clip on the new body, with the
twist bones keyed (top row) and at rest (bottom row, the old deformation). Run in the project's
Blender after a build (the scene of blender/rifle_motion_ue5.blend):

  python3 blender/tools/bl.py run blender/ue5_rig/forearm_strip.py

Writes blender/review/ue5/forearm-<clip>.png. CLIP / FRAMES may be set before running."""
import pathlib
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from rifle_motion.skel import g2b  # noqa: E402

CLIP = globals().get('CLIP', 'swap-rifle-shotgun')
FRAMES = globals().get('FRAMES', None)
OUT = HERE.parent / 'review/ue5' / f'forearm-{CLIP}.png'


def main():
    scene = bpy.context.scene
    rig, skeleton = bpy.data.objects['rig'], bpy.data.objects['skeleton']
    rig.animation_data.action = bpy.data.actions[CLIP]
    twist = bpy.data.actions.get('twist-' + CLIP)
    if twist is None:  # (a scene built with REVIEW_TWIST = False): bake the clip and key its twist
        import importlib
        from rifle_motion import bake, skel as skel_mod
        importlib.reload(skel_mod)
        importlib.reload(bake)
        body = HERE.parents[1] / 'public/characters/civilian-m-01-player-ue5.glb'
        scn = dict(skeleton=skeleton, skel=skel_mod.Skeleton(body), rig=rig, mount=bpy.data.objects['gun_mount'],
                   mount2=bpy.data.objects['gun2_mount'])
        n0 = int(rig.animation_data.action.frame_range[1])
        baked = bake.bake(scene, scn, rig.animation_data.action, n0)
        twist = bake.key_twist(scn, CLIP, bake.gltf_frames(scn['skel'], baked))
    for obj in bpy.data.objects:  # the gun's loose parts follow their clip's actions
        if obj.animation_data and obj.type == 'MESH':
            a = bpy.data.actions.get(CLIP + '-' + obj.name.split('.')[0])
            if a:
                obj.animation_data.action = a
    n = int(rig.animation_data.action.frame_range[1])
    frames = FRAMES or sorted({round(i * (n - 1) / 9) for i in range(10)})
    cam = bpy.data.objects['review-camera']
    old = (scene.render.resolution_x, scene.render.resolution_y)
    scene.render.resolution_x, scene.render.resolution_y = 260, 260
    tiles = {}
    for row, keyed in enumerate((True, False)):
        skeleton.animation_data.action = twist if keyed else None
        if not keyed:
            for pb in skeleton.pose.bones:
                if '_twist_' in pb.name:
                    pb.rotation_quaternion = (1, 0, 0, 0)
        for f in frames:
            scene.frame_set(f)
            ev = skeleton.evaluated_get(bpy.context.evaluated_depsgraph_get())
            el = ev.matrix_world @ ev.pose.bones['lowerarm_r'].head
            wr = ev.matrix_world @ ev.pose.bones['hand_r'].head
            mid = (el + wr) / 2
            axis = (wr - el).normalized()
            side = axis.cross(Vector((0, 0, 1)))
            if side.length < 0.2:
                side = axis.cross(Vector((0, 1, 0)))
            side.normalize()
            # look across the forearm from the outside of the arm, a little from the front
            eye = mid + (side + Vector((0, -0.6, 0.2))).normalized() * 3.0
            cam.location = eye
            cam.rotation_euler = (mid - eye).to_track_quat('-Z', 'Y').to_euler()
            cam.data.ortho_scale = 0.42
            path = OUT.with_name(f'.tile-{row}-{f}.png')
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(str(path))
            w, h = img.size
            tiles[row, f] = np.array(img.pixels[:]).reshape(h, w, 4)
            bpy.data.images.remove(img)
            path.unlink()
    rows = [np.concatenate([tiles[r, f] for f in frames], axis=1) for r in (1, 0)]
    sheet = np.concatenate(rows, axis=0)
    out = bpy.data.images.new('forearm', sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels.foreach_set(sheet.astype(np.float32).ravel())
    out.filepath_raw = str(OUT)
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    scene.render.resolution_x, scene.render.resolution_y = old
    skeleton.animation_data.action = None
    print('wrote', OUT, 'frames', frames)


main()
