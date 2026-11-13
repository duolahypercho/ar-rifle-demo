"""Copies a vehicle GLB with its embedded textures scaled down (pass V1).

No Blender needed: the GLB's JSON and binary chunk are rewritten directly, each embedded image
re-encoded by macOS `sips` at the size asked for (same format), every bufferView re-laid out.
Geometry, materials, nodes and animations are byte-identical.

    python3 blender/vehicles/shrink_textures.py SRC.glb OUT.glb name=size [name=size ...] [default=size]

Used for the supercar (README, "Vehicles"):
    python3 blender/vehicles/shrink_textures.py ../supercar/supercar.glb public/vehicles/supercar.glb \
        interior_normal=2048 interior_orm=2048 default=1024
"""
import json, os, struct, subprocess, sys, tempfile

def main():
    src, out, *specs = sys.argv[1:]
    sizes = dict(s.split('=') for s in specs)
    default = int(sizes.pop('default', 0))
    data = open(src, 'rb').read()
    jl, _ = struct.unpack('<II', data[12:20])
    g = json.loads(data[20:20 + jl])
    off = 20 + jl
    bl, _ = struct.unpack('<II', data[off:off + 8])
    binary = data[off + 8:off + 8 + bl]
    views = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in g['bufferViews']]
    tmp = tempfile.mkdtemp()
    for im in g.get('images', []):
        size = int(sizes.get(im.get('name'), default))
        if not size:
            continue
        ext = 'png' if im['mimeType'] == 'image/png' else 'jpg'
        path = os.path.join(tmp, f"{im['name']}.{ext}")
        open(path, 'wb').write(views[im['bufferView']])
        w = int(subprocess.check_output(['sips', '-g', 'pixelWidth', path]).split()[-1])
        if w <= size:
            continue
        args = ['sips', '-Z', str(size), path, '--out', path]
        if ext == 'jpg':
            args[1:1] = ['-s', 'formatOptions', '92']
        subprocess.check_call(args, stdout=subprocess.DEVNULL)
        before = len(views[im['bufferView']])
        views[im['bufferView']] = open(path, 'rb').read()
        print(f"{im['name']}: {w} -> {size} px, {before} -> {len(views[im['bufferView']])} bytes")
    blob = bytearray()
    for v, b in zip(g['bufferViews'], views):
        while len(blob) % 4:
            blob.append(0)
        v['byteOffset'] = len(blob)
        v['byteLength'] = len(b)
        blob += b
    while len(blob) % 4:
        blob.append(0)
    g['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(g, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + blob)
    print(out, total, 'bytes')

main()
