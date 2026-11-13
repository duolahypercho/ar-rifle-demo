"""Reading and writing GLB files directly: the exporter's output is trimmed to the channels the
game reads, and the result is checked against what was baked."""
import json
import pathlib
import struct

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
COMPONENT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read(path):
    data = pathlib.Path(path).read_bytes()
    magic, _, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise ValueError(f'{path} is not a GLB')
    offset, chunks = 12, {}
    while offset < length:
        size, kind = struct.unpack_from('<II', data, offset)
        chunks[kind] = data[offset + 8: offset + 8 + size]
        offset += 8 + size
    return json.loads(chunks[JSON_CHUNK]), chunks.get(BIN_CHUNK, b'')


def rows(gltf, binary, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    fmt, size = COMPONENT[acc['componentType']]
    width = WIDTH[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride', size * width)
    return [struct.unpack_from('<' + fmt * width, binary, start + k * stride) for k in range(acc['count'])]


def write(path, gltf, binary):
    text = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    text += b' ' * ((4 - len(text) % 4) % 4)
    binary = bytes(binary) + b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(text) + (8 + len(binary) if binary else 0)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(text), JSON_CHUNK) + text
    if binary:
        out += struct.pack('<II', len(binary), BIN_CHUNK) + binary
    pathlib.Path(path).write_bytes(out)


def repack(gltf, binary, keep):
    """Rebuilds the binary chunk with only the accessors in `keep`, one buffer view each.
    Returns the old-to-new accessor index map and the new binary."""
    remap, accessors, views, blob = {}, [], [], bytearray()
    for old in sorted(keep):
        acc = dict(gltf['accessors'][old])
        view = gltf['bufferViews'][acc['bufferView']]
        fmt, size = COMPONENT[acc['componentType']]
        width = WIDTH[acc['type']]
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = view.get('byteStride', size * width)
        chunk = bytearray()
        for k in range(acc['count']):
            chunk += binary[start + k * stride: start + k * stride + size * width]
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(chunk)})
        blob += chunk
        acc['bufferView'] = len(views) - 1
        acc.pop('byteOffset', None)
        remap[old] = len(accessors)
        accessors.append(acc)
    gltf['accessors'] = accessors
    gltf['bufferViews'] = views
    gltf['buffers'] = [{'byteLength': (len(blob) + 3) // 4 * 4}]
    return remap, bytes(blob)
