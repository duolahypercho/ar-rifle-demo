"""Close-up contact sheets of one clip frame: both hands on the gun from the right, the left, below
and the front; the cheek weld from the front and the side; the pouch draw; the upper back from
behind. Orthographic Workbench renders tiled in one row (review.Sheets' camera and settings), for
looking at the fit of a body's hands, face and kit on the guns (pass T1b).

    closeups.render(scene, skeleton, 'blender/review/tripo/close-rifle-idle-0.png', frame=0,
                    views=('right', 'left', 'below', 'front'))
"""
import pathlib

import bpy
import numpy as np
from mathutils import Vector

# view -> (what it looks at, the direction the camera looks FROM (B: +x left of the body, -y in
# front of it, +z up), orthographic scale)
TARGETS = {
    'right': ('hands', Vector((-1, -0.25, 0.15)), 0.5),
    'left': ('hands', Vector((1, -0.25, 0.15)), 0.5),
    'below': ('hands', Vector((0.05, -0.25, -1)), 0.5),
    'front': ('hands', Vector((0.0, -1, 0.1)), 0.5),
    'grip-right': ('hand_r', Vector((-1, -0.1, 0.1)), 0.24),
    'grip-left': ('hand_r', Vector((1, -0.1, 0.1)), 0.24),
    'grip-below': ('hand_r', Vector((0, 0, -1)), 0.24),
    'support-right': ('hand_l', Vector((-1, -0.2, 0.1)), 0.24),
    'support-left': ('hand_l', Vector((1, -0.2, 0.1)), 0.24),
    'support-below': ('hand_l', Vector((0, 0, -1)), 0.24),
    'cheek-front': ('head', Vector((0, -1, 0.05)), 0.4),
    'cheek-side': ('head', Vector((-1, 0, 0.05)), 0.4),
    'cheek-top': ('head', Vector((0, -0.2, 1)), 0.4),
    'pouch': ('pelvis_l', Vector((1, -0.6, 0.2)), 0.5),
    'pouch-front': ('pelvis_l', Vector((0.2, -1, 0.1)), 0.5),
    'back': ('spine_05', Vector((0, 1, 0.15)), 0.75),
    'back-high': ('spine_05', Vector((0, 1, 0.8)), 0.75),
}


def _point(skeleton, what):
    mw = skeleton.matrix_world
    pb = skeleton.pose.bones
    if what == 'hands':
        return (mw @ pb['hand_l'].head + mw @ pb['hand_r'].head) / 2
    if what == 'hand_r':  # the middle of the hand, not the wrist
        return mw @ ((pb['hand_r'].head + pb['middle_01_r'].head) / 2)
    if what == 'hand_l':
        return mw @ ((pb['hand_l'].head + pb['middle_01_l'].head) / 2)
    if what == 'head':
        return mw @ pb['head'].head + Vector((0, -0.04, 0.06))
    if what == 'pelvis_l':
        return mw @ pb['thigh_l'].head + Vector((0.06, -0.02, 0.0))
    return mw @ pb[what].head


def render(scene, skeleton, path, frame=0, views=('right', 'left', 'below', 'front'), size=360):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    cam = bpy.data.objects['review-camera']
    old = (scene.render.resolution_x, scene.render.resolution_y)
    scene.render.resolution_x = scene.render.resolution_y = size
    tiles = []
    path = pathlib.Path(path)
    ground = bpy.data.objects.get('review-ground')
    for view in views:
        what, came_from, scale = TARGETS[view]
        target = _point(skeleton, what)
        eye = target + came_from.normalized() * 3.0
        cam.location = eye
        cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
        cam.data.ortho_scale = scale
        if ground is not None:
            ground.hide_render = came_from.z < 0  # (seen from below, the floor is in the way)
        tmp = path.parent / f'.close-{view}.png'
        scene.render.filepath = str(tmp)
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(str(tmp))
        w, h = img.size
        tiles.append(np.array(img.pixels[:]).reshape(h, w, 4))
        bpy.data.images.remove(img)
        tmp.unlink()
    if ground is not None:
        ground.hide_render = False
    sheet = np.concatenate(tiles, axis=1)
    out = bpy.data.images.new(path.stem, sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels.foreach_set(sheet.astype(np.float32).ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    scene.render.resolution_x, scene.render.resolution_y = old
    return path
