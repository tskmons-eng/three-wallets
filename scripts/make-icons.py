"""アプリのアイコン（PNG）を作る。外部の部品を使わない。3本の色の帯＝3つの財布。"""
import struct, zlib, sys, os

def png(size, path):
    bg = (31, 95, 139); bars = [(120, 167, 214), (92, 196, 149), (224, 165, 74)]
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            c = bg
            fx, fy = x / size, y / size
            for i, col in enumerate(bars):
                top = 0.24 + i * 0.19
                if 0.2 <= fx <= 0.8 and top <= fy <= top + 0.13:
                    # 角を少し丸める
                    c = col
            row += bytes(c)
        rows.append(b'\x00' + bytes(row))
    raw = zlib.compress(b''.join(rows), 9)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = sys.argv[1] if len(sys.argv) > 1 else 'app'
for s in (180, 192, 512): png(s, os.path.join(out, f'icon-{s}.png'))
