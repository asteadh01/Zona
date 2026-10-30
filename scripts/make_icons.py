"""Draw Zona's Gauge logo (a five-segment dial around a Z) as the app icons and splash image, with the standard library only.

The geometry is in 1024 units and matches mobile/src/utils/logo-geometry.ts, which draws the same logo inside the app.

Run from the repo root: python scripts/make_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

Color = tuple[int, int, int]

RING_R, RING_WIDTH, RING_START, RING_SWEEP, RING_GAP = 340, 78, 135, 270, 8  # degrees run clockwise from 3 o'clock
SEGMENTS = 5
SEGMENT_SWEEP = (RING_SWEEP - RING_GAP * (SEGMENTS - 1)) / SEGMENTS
Z_SCALE = 0.6
Z_SHAPE = SEGMENTS  # shape index of the Z; the ring's segments are 0 to 4
FULL_SIZE = 1024
SPLASH_FROM, SPLASH_SIZE = 130, 764  # the mark without the icon's margin: same crop as LogoMark's viewBox
SAMPLES = 3  # per axis, for anti-aliasing


def rgb(value: str) -> Color:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def palette(ramp: list[str], z: str) -> list[Color]:
    return [rgb(c) for c in (*ramp, z)]


BRAND_BG = rgb("#104281")
BRAND = palette(["#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"], "#ffffff")
DARK = palette(["#1c5cab", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4"], "#eef0f2")
TINTED = palette(["#707070", "#8c8c8c", "#a8a8a8", "#c4c4c4", "#e4e4e4"], "#f4f4f4")  # iOS supplies the colour from this greyscale


def in_z(x: float, y: float) -> bool:
    ux, uy = 512 + (x - 512) / Z_SCALE, 512 + (y - 512) / Z_SCALE
    if not (262 <= ux <= 762 and 272 <= uy <= 752):
        return False
    if uy <= 388 or uy >= 636:
        return True
    slide = (uy - 388) * 326 / 248
    return 588 - slide <= ux <= 762 - slide


def shape_at(x: float, y: float) -> int | None:
    dx, dy = x - 512, y - 512
    if abs(math.hypot(dx, dy) - RING_R) <= RING_WIDTH / 2:
        along = (math.degrees(math.atan2(dy, dx)) - RING_START) % 360
        if along > RING_SWEEP:
            return None
        index = int(along // (SEGMENT_SWEEP + RING_GAP))
        return index if along - index * (SEGMENT_SWEEP + RING_GAP) <= SEGMENT_SWEEP else None
    return Z_SHAPE if in_z(x, y) else None


def coverage(size: int, origin: float = 0, span: float = FULL_SIZE) -> list[tuple[int, int]]:
    """For each pixel, the shape it touches and how much of it, 0 to 255. The shapes never share a pixel."""
    pixels = []
    unit = span / size
    for py in range(size):
        for px in range(size):
            hits: dict[int, int] = {}
            for i in range(SAMPLES):
                for j in range(SAMPLES):
                    shape = shape_at(origin + (px + (i + 0.5) / SAMPLES) * unit, origin + (py + (j + 0.5) / SAMPLES) * unit)
                    if shape is not None:
                        hits[shape] = hits.get(shape, 0) + 1
            shape, count = max(hits.items(), key=lambda hit: hit[1], default=(0, 0))
            pixels.append((shape, round(255 * count / SAMPLES ** 2)))
    return pixels


def png(size: int, channels: int, pixels: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    stride = size * channels
    rows = b"".join(b"\0" + pixels[y * stride:(y + 1) * stride] for y in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 2 if channels == 3 else 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def on_background(size: int, cover: list[tuple[int, int]], colors: list[Color], bg: Color) -> bytes:
    """Opaque, as App Store icons must be. iOS rounds the corners itself."""
    pixels = bytearray()
    for shape, a in cover:
        pixels.extend(round(b + (c - b) * a / 255) for b, c in zip(bg, colors[shape]))
    return png(size, 3, bytes(pixels))


def transparent(size: int, cover: list[tuple[int, int]], colors: list[Color]) -> bytes:
    pixels = bytearray()
    for shape, a in cover:
        pixels.extend((*colors[shape], a))
    return png(size, 4, bytes(pixels))


if __name__ == "__main__":
    images = Path(__file__).resolve().parent.parent / "mobile" / "assets" / "images"
    images.mkdir(parents=True, exist_ok=True)
    full = coverage(FULL_SIZE)
    (images / "icon.png").write_bytes(on_background(FULL_SIZE, full, BRAND, BRAND_BG))
    (images / "icon-dark.png").write_bytes(transparent(FULL_SIZE, full, DARK))  # iOS draws its own dark background
    (images / "icon-tinted.png").write_bytes(on_background(FULL_SIZE, full, TINTED, (0, 0, 0)))  # Expo would flatten transparency onto white
    splash = coverage(SPLASH_SIZE, SPLASH_FROM, SPLASH_SIZE)
    (images / "splash-icon.png").write_bytes(transparent(SPLASH_SIZE, splash, BRAND))
