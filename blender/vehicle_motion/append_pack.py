"""Appends animations (and their notes) from one vehicle pack to another, unchanged (pass A2): a clip that is
not being rebuilt keeps its shipped bytes.

  python3 blender/vehicle_motion/append_pack.py <into.glb> <from.glb> clip [clip ...]
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'rifle_motion'))
import gltfio  # noqa: E402


def append(into, src_path, names):
    into, src_path = pathlib.Path(into), pathlib.Path(src_path)
    gltf, binary = gltfio.read(into)
    src, src_bin = gltfio.read(src_path)
    binary = bytearray(binary)
    index = {n.get('name'): i for i, n in enumerate(gltf['nodes'])}
    src_names = [n.get('name') for n in src['nodes']]
    gltf['animations'] = [a for a in gltf['animations'] if a['name'] not in names]
    for anim in src['animations']:
        if anim['name'] not in names:
            continue
        samplers = []
        for smp in anim['samplers']:
            new = {}
            for key in ('input', 'output'):
                acc = dict(src['accessors'][smp[key]])
                view = dict(src['bufferViews'][acc['bufferView']])
                while len(binary) % 4:
                    binary.append(0)
                start = view.get('byteOffset', 0)
                chunk = src_bin[start:start + view['byteLength']]
                view['byteOffset'] = len(binary)
                view['buffer'] = 0
                binary += chunk
                gltf['bufferViews'].append(view)
                acc['bufferView'] = len(gltf['bufferViews']) - 1
                gltf['accessors'].append(acc)
                new[key] = len(gltf['accessors']) - 1
            new['interpolation'] = smp.get('interpolation', 'LINEAR')
            samplers.append(new)
        channels = [{'sampler': c['sampler'], 'target': {'node': index[src_names[c['target']['node']]], 'path': c['target']['path']}} for c in anim['channels']]
        gltf['animations'].append({'name': anim['name'], 'samplers': samplers, 'channels': channels})
    gltf['buffers'][0]['byteLength'] = len(binary)
    gltfio.write(into, gltf, bytes(binary))
    jn = into.with_suffix('.json')
    notes = json.loads(jn.read_text())
    src_notes = json.loads(src_path.with_suffix('.json').read_text())['clips']
    for n in names:
        notes['clips'][n] = src_notes[n]
    jn.write_text(json.dumps(notes, indent=1))
    print('appended', names)


if __name__ == '__main__':
    append(sys.argv[1], sys.argv[2], sys.argv[3:])
