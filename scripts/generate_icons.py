#!/usr/bin/env python3
"""Generate PWA icons without external dependencies."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "icons"
BG = (37, 99, 235)  # --primary blue
FG = (255, 255, 255)


def _chunk(tag: bytes, data: bytes) -> bytes:
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def _solid_png(size: int, rgb: tuple[int, int, int]) -> bytes:
    row = b"\x00" + bytes(rgb) * size
    raw = row * size
    compressed = zlib.compress(raw, 9)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")


def _draw_box_png(size: int) -> bytes:
    """Simple box icon: blue background, lighter inner rectangle."""
    light = (59, 130, 246)
    margin = size // 6
    inner = size - margin * 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            in_inner = margin <= x < margin + inner and margin <= y < margin + inner
            if in_inner and y < margin + inner // 4:
                row.extend(FG)
            elif in_inner:
                row.extend(light)
            else:
                row.extend(BG)
        rows.append(bytes(row))
    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = OUT / f"icon-{size}.png"
        path.write_bytes(_draw_box_png(size))
        print(f"Created {path}")


if __name__ == "__main__":
    main()
