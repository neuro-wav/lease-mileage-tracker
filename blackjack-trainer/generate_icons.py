#!/usr/bin/env python3
"""Generate PWA icons for the Blackjack Counting Trainer using only the
Python standard library (struct/zlib for PNG encoding, no PIL).

Design: deep-green felt rounded square, gold border, a white playing-card
silhouette with a gold diamond pip — evokes "cards + a counting/training tool"
without needing font rendering.
"""

import struct
import zlib
import os

FELT = (11, 61, 46)
FELT_DARK = (8, 43, 32)
GOLD = (212, 175, 55)
WHITE = (245, 239, 227)


def make_png(width, height, pixels):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b in row:
            raw.extend((r & 0xFF, g & 0xFF, b & 0xFF))
    idat = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def canvas(size, color):
    return [[color for _ in range(size)] for _ in range(size)]


def blend(pixels, x, y, color, alpha, size):
    if 0 <= x < size and 0 <= y < size and alpha > 0:
        bg = pixels[y][x]
        a = min(1.0, alpha)
        pixels[y][x] = tuple(int(bg[i] * (1 - a) + color[i] * a) for i in range(3))


def supersampled_fill(pixels, size, color, inside_fn, bbox, ss=4):
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(size - 1, int(x1)), min(size - 1, int(y1))
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            count = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    if inside_fn(px, py):
                        count += 1
            if count:
                blend(pixels, x, y, color, count / (ss * ss), size)


def rounded_rect_fn(cx0, cy0, cx1, cy1, radius):
    def inside(x, y):
        if cx0 + radius <= x <= cx1 - radius:
            return cy0 <= y <= cy1
        if cy0 + radius <= y <= cy1 - radius:
            return cx0 <= x <= cx1
        for ccx, ccy in ((cx0 + radius, cy0 + radius), (cx1 - radius, cy0 + radius),
                         (cx0 + radius, cy1 - radius), (cx1 - radius, cy1 - radius)):
            if (x - ccx) ** 2 + (y - ccy) ** 2 <= radius ** 2:
                return True
        return False
    return inside


def diamond_fn(cx, cy, half_w, half_h):
    def inside(x, y):
        return abs(x - cx) / half_w + abs(y - cy) / half_h <= 1.0
    return inside


def draw_shape(pixels, size, color, shape_fn, bbox):
    supersampled_fill(pixels, size, color, shape_fn, bbox)


def generate_icon(size, maskable=False):
    pixels = canvas(size, FELT)

    # Background: rounded square (or full bleed for maskable, then inset content)
    bg_radius = size * (0.0 if maskable else 0.22)
    if bg_radius:
        mask_inside = rounded_rect_fn(0, 0, size - 1, size - 1, bg_radius)
        for y in range(size):
            for x in range(size):
                if not mask_inside(x + 0.5, y + 0.5):
                    pixels[y][x] = (0, 0, 0)  # will be transparent-ish via alpha not supported; keep felt edge instead
        pixels = canvas(size, FELT)
        # redraw with darker corners blended for a soft vignette feel instead of true transparency
        for y in range(size):
            for x in range(size):
                if not mask_inside(x + 0.5, y + 0.5):
                    pixels[y][x] = FELT_DARK

    content_scale = 0.56 if maskable else 0.72
    cx, cy = size / 2.0, size / 2.0
    card_w = size * content_scale * 0.62
    card_h = size * content_scale

    # Gold border ring around the card
    border = max(2.0, size * 0.012)
    draw_shape(pixels, size, GOLD,
               rounded_rect_fn(cx - card_w / 2 - border, cy - card_h / 2 - border,
                               cx + card_w / 2 + border, cy + card_h / 2 + border, size * 0.05),
               (cx - card_w / 2 - border - 2, cy - card_h / 2 - border - 2,
                cx + card_w / 2 + border + 2, cy + card_h / 2 + border + 2))

    # White card face
    draw_shape(pixels, size, WHITE,
               rounded_rect_fn(cx - card_w / 2, cy - card_h / 2, cx + card_w / 2, cy + card_h / 2, size * 0.045),
               (cx - card_w / 2 - 2, cy - card_h / 2 - 2, cx + card_w / 2 + 2, cy + card_h / 2 + 2))

    # Center diamond pip (felt-green on white card)
    dw, dh = card_w * 0.30, card_h * 0.20
    draw_shape(pixels, size, FELT, diamond_fn(cx, cy, dw, dh),
               (cx - dw - 2, cy - dh - 2, cx + dw + 2, cy + dh + 2))

    # Corner pips (top-left, bottom-right) — smaller diamonds
    pip_w, pip_h = card_w * 0.13, card_h * 0.09
    off_x, off_y = card_w * 0.30, card_h * 0.36
    for sx, sy in ((-1, -1), (1, 1)):
        pcx, pcy = cx + sx * off_x, cy + sy * off_y
        draw_shape(pixels, size, FELT, diamond_fn(pcx, pcy, pip_w, pip_h),
                   (pcx - pip_w - 2, pcy - pip_h - 2, pcx + pip_w + 2, pcy + pip_h + 2))

    return pixels


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(out_dir, exist_ok=True)
    configs = [
        ('icon-180.png', 180, False),
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('icon-maskable-192.png', 192, True),
        ('icon-maskable-512.png', 512, True),
    ]
    for filename, size, maskable in configs:
        pixels = generate_icon(size, maskable)
        data = make_png(size, size, pixels)
        path = os.path.join(out_dir, filename)
        with open(path, 'wb') as f:
            f.write(data)
        print(f'wrote {path} ({len(data):,} bytes)')


if __name__ == '__main__':
    main()
