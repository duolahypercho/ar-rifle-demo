"""The game's copy of a prepared body with lighter textures (pass F1). The master (full-resolution
textures) stays under blender/bodies/<body>/ and is what the Unreal export reads; the game loads the
copy in public/characters/.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
      --python blender/bodies/game_copy.py -- --src blender/bodies/tripo/tripo-player-ue5.glb \
      --out public/characters/tripo-player-ue5.glb [--base 4096] [--other 2048] [--quality 90] [--tmp DIR]

Every image is decoded and resized with Blender's own image scaling (bpy Image.scale) to at most --base
(the base colour) / --other (normal, roughness-metal) on its long side, re-encoded in its own format
(JPEG at --quality; PNG stays PNG) and written back into the GLB; everything else (nodes, skin,
mesh, morphs, materials) is copied byte for byte. Prints sizes and the decoded texture memory
(RGBA8, with mipmaps x 4/3) before and after.
"""
import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from rifle_motion import gltfio  # noqa: E402


def role_of(g, k):
    for m in g.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for key, tex in (('base', pbr.get('baseColorTexture')), ('other', pbr.get('metallicRoughnessTexture')),
                         ('other', m.get('normalTexture')), ('other', m.get('occlusionTexture')), ('base', m.get('emissiveTexture'))):
            if tex is not None and g['textures'][tex['index']]['source'] == k:
                return key
    return 'other'


def mem(w, h):
    return w * h * 4 * 4 / 3


def main(argv):
    import bpy
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--base', type=int, default=4096)
    ap.add_argument('--other', type=int, default=2048)
    ap.add_argument('--quality', type=int, default=90)
    ap.add_argument('--tmp', default='/tmp')
    a = ap.parse_args(argv)
    g, b = gltfio.read(a.src)
    tmp = pathlib.Path(a.tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    new_images = {}
    report = []
    for k, im in enumerate(g.get('images', [])):
        v = g['bufferViews'][im['bufferView']]
        data = bytes(b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']])
        ext = '.png' if im['mimeType'] == 'image/png' else '.jpg'
        src = tmp / f'gc_src_{k}{ext}'
        src.write_bytes(data)
        img = bpy.data.images.load(str(src), check_existing=False)
        w, h = img.size
        cap = a.base if role_of(g, k) == 'base' else a.other
        s = min(1.0, cap / max(w, h))
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        if s < 1:
            img.scale(nw, nh)
        dst = tmp / f'gc_dst_{k}{ext}'
        img.file_format = 'PNG' if ext == '.png' else 'JPEG'
        img.save(filepath=str(dst), quality=a.quality)     # Image.save: no view transform, pixels as stored
        new_images[k] = dst.read_bytes()
        report.append(dict(image=im.get('name'), mime=im['mimeType'], before=f'{w}x{h}', after=f'{nw}x{nh}',
                           bytesBefore=len(data), bytesAfter=len(new_images[k]), memBeforeMB=round(mem(w, h) / 1e6, 1),
                           memAfterMB=round(mem(nw, nh) / 1e6, 1)))
        bpy.data.images.remove(img)
    # rebuild the binary: every buffer view as it was, the image views replaced
    img_view = {g['images'][k]['bufferView']: k for k in new_images}
    blob = bytearray()
    views = []
    for i, v in enumerate(g['bufferViews']):
        while len(blob) % 4:
            blob.append(0)
        data = new_images[img_view[i]] if i in img_view else bytes(b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']])
        nv = dict(v, byteOffset=len(blob), byteLength=len(data))
        blob += data
        views.append(nv)
    g['bufferViews'] = views
    g['buffers'] = [{'byteLength': (len(blob) + 3) // 4 * 4}]
    ex = g.setdefault('asset', {}).setdefault('extras', {})
    ex['gameCopy'] = dict(master=str(pathlib.Path(a.src).name), textures={r['image']: r['after'] for r in report},
                          note='game copy (pass F1, blender/bodies/game_copy.py); the full-resolution master is in blender/bodies/')
    gltfio.write(a.out, g, bytes(blob))
    for r in report:
        print('[game_copy]', r, flush=True)
    sb, sa = pathlib.Path(a.src).stat().st_size, pathlib.Path(a.out).stat().st_size
    print(f'[game_copy] file {sb / 1e6:.2f} MB -> {sa / 1e6:.2f} MB; decoded textures {sum(r["memBeforeMB"] for r in report):.0f} -> '
          f'{sum(r["memAfterMB"] for r in report):.0f} MB (RGBA8 + mips)', flush=True)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
