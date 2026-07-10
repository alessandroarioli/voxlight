#!/usr/bin/env python3
"""Generate Voxlight icons (speaker + sound waves on indigo rounded square). Stdlib only."""
import math
import os
import struct
import zlib

BG = (79, 70, 229)       # indigo
GLYPH = (255, 255, 255)  # speaker
WAVE = (255, 179, 0)     # amber arcs


def png_bytes(size, pixels):
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def sample(x, y):
    """Color at unit coords (0..1). Returns RGBA."""
    # Rounded-square background, corner radius 0.18
    dx = max(abs(x - 0.5) - 0.32, 0.0)
    dy = max(abs(y - 0.5) - 0.32, 0.0)
    if dx * dx + dy * dy > 0.18 * 0.18:
        return (0, 0, 0, 0)

    # Speaker body
    if 0.22 <= x <= 0.36 and 0.40 <= y <= 0.60:
        return (*GLYPH, 255)
    # Speaker horn (widening triangle)
    if 0.36 <= x <= 0.54:
        half = 0.10 + (x - 0.36) / 0.18 * 0.16
        if abs(y - 0.5) <= half:
            return (*GLYPH, 255)
    # Sound waves: two arcs right of the horn
    wx, wy = x - 0.56, y - 0.5
    if wx > 0 and abs(wy) < wx * 1.2:
        r = math.hypot(wx, wy)
        if abs(r - 0.13) <= 0.028 or abs(r - 0.21) <= 0.028:
            return (*WAVE, 255)

    return (*BG, 255)


def render(size, ss=3):
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    c = sample(x, y)
                    for i in range(4):
                        acc[i] += c[i]
            n = ss * ss
            row.append(tuple(v // n for v in acc))
        rows.append(row)
    return rows


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(png_bytes(size, render(size)))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
