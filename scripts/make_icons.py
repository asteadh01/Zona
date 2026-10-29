"""Draw Zona's home-screen icons (a white drop on the accent blue) with the standard library only.

Run from the repo root: python scripts/make_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

BLUE, WHITE = (42, 120, 214), (255, 255, 255)
CX, CY, R, TIP_Y = 0.5, 0.6, 0.22, 0.17  # drop geometry as fractions of the icon size
SAMPLES = 4  # per axis, for anti-aliasing


def in_drop(x: float, y: float) -> bool:
    if (x - CX) ** 2 + (y - CY) ** 2 <= R * R:
        return True
    d = CY - TIP_Y
    tangent_y = CY - R * R / d
    if TIP_Y <= y <= tangent_y:
        return abs(x - CX) <= (y - TIP_Y) * R / math.sqrt(d * d - R * R)
    return False


def png(size: int) -> bytes:
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            hits = sum(in_drop((px + (i + 0.5) / SAMPLES) / size, (py + (j + 0.5) / SAMPLES) / size)
                       for i in range(SAMPLES) for j in range(SAMPLES))
            a = hits / SAMPLES ** 2
            rows.extend(round(b + (w - b) * a) for b, w in zip(BLUE, WHITE))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    web = Path(__file__).resolve().parent.parent / "web"
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        (web / name).write_bytes(png(size))
