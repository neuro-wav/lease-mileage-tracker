#!/usr/bin/env python3
"""Generate all icon variants for the Lease Mileage Tracker PWA.

Design: Apple-style — radial blue gradient, single green progress arc,
white needle, blue-toned odometer pill with placeholder bars.
"""

import math, os
import numpy as np
from PIL import Image, ImageDraw

# ── Palette ────────────────────────────────────────────────────────────────────
BG_HOT    = np.array([96,  165, 250])   # #60A5FA — focal highlight
BG_BASE   = np.array([29,   78, 216])   # #1E4ED8 — outer base
IOS_GREEN = (48, 209,  88, 255)          # #30D158 — Apple system green
WHITE     = (255, 255, 255, 255)
ODO_BG    = ( 16,  46, 130, 255)         # dark blue
ODO_DIG   = (148, 198, 252, 255)         # light blue bars
ODO_DIV   = ( 28,  64, 160, 255)         # mid blue divider


def _bg(S):
    """Radial gradient: brighter at top-center, darker at edges."""
    yy, xx = np.mgrid[0:S, 0:S]
    fx, fy  = S * 0.50, S * 0.05
    dist    = np.sqrt((xx - fx)**2 + (yy - fy)**2) / (S * 0.88)
    t       = np.clip(dist, 0, 1)
    arr     = np.zeros((S, S, 4), dtype=np.float32)
    for i in range(3):
        arr[:, :, i] = BG_HOT[i] * (1 - t) + BG_BASE[i] * t
    arr[:, :, 3] = 255
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8))


def draw_gauge_icon(out_size: int, gauge_scale: float = 1.0) -> Image.Image:
    """
    Render the gauge icon at `out_size` × `out_size` pixels.
    gauge_scale=1.0 → standard; 0.78 → maskable safe-zone variant.
    Uses 4× super-sampling for anti-aliased edges.
    """
    SS = 4
    S  = out_size * SS

    # ── Background through rounded-rect mask ───────────────────────────────────
    bg  = _bg(S)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    msk = Image.new("L",    (S, S), 0)
    ImageDraw.Draw(msk).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255
    )
    img.paste(bg, mask=msk)

    # ── Gauge ring geometry ────────────────────────────────────────────────────
    cx = S // 2
    cy = int(S * 0.49)
    OR = int(S * 0.340 * gauge_scale)
    IR = int(S * 0.212 * gauge_scale)
    mr = (OR + IR) // 2
    rw = OR - IR
    bbox = [cx - mr, cy - mr, cx + mr, cy + mr]

    # Track arc — translucent white, full 240°
    track = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(track).arc(bbox, 150, 390, fill=(255, 255, 255, 50), width=rw)
    img   = Image.alpha_composite(img, track)

    draw = ImageDraw.Draw(img)

    # Progress arc — iOS green, ~62% of 240° (148°), from 150° to 298°
    draw.arc(bbox, 150, 298, fill=IOS_GREEN, width=rw)

    # ── Needle ─────────────────────────────────────────────────────────────────
    a  = math.radians(190)
    nl = int(IR * 0.80)
    nx = cx + int(nl * math.cos(a))
    ny = cy + int(nl * math.sin(a))
    draw.line([(cx, cy), (nx, ny)], fill=WHITE, width=max(10, int(S * 0.013)))

    # Pivot dot
    pr = int(S * 0.022 * gauge_scale)
    draw.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=WHITE)

    # ── Odometer ───────────────────────────────────────────────────────────────
    ow  = int(S * 0.185 * gauge_scale)
    oh  = int(S * 0.076 * gauge_scale)
    ocx = cx
    ocy = cy + int(S * 0.108 * gauge_scale)
    or_ = int(oh * 0.36)
    OL, OT  = ocx - ow // 2, ocy - oh // 2
    OR2, OB = ocx + ow // 2, ocy + oh // 2

    draw.rounded_rectangle([OL, OT, OR2, OB], radius=or_, fill=ODO_BG)

    # Cell dividers
    n  = 5
    cw = ow // n
    for i in range(1, n):
        x = OL + i * cw
        draw.rectangle([x - 2, OT + or_, x + 2, OB - or_], fill=ODO_DIV)

    # Placeholder bars
    bw = int(cw * 0.42)
    bh = int(oh * 0.22)
    br = bh // 2
    for i in range(n):
        ccx = OL + i * cw + cw // 2
        draw.rounded_rectangle(
            [ccx - bw // 2, ocy - bh // 2, ccx + bw // 2, ocy + bh // 2],
            radius=br, fill=ODO_DIG,
        )

    # ── Downsample ─────────────────────────────────────────────────────────────
    return img.resize((out_size, out_size), Image.LANCZOS)


# ── Generate all five icon variants ───────────────────────────────────────────
VARIANTS = [
    (512, "icon-512.png",          1.00),   # PWA large
    (192, "icon-192.png",          1.00),   # PWA standard
    (512, "icon-maskable-512.png", 0.78),   # Android adaptive large
    (192, "icon-maskable-192.png", 0.78),   # Android adaptive standard
    (180, "icon-180.png",          1.00),   # Apple touch icon
]

os.makedirs("icons", exist_ok=True)

for out_size, filename, scale in VARIANTS:
    icon = draw_gauge_icon(out_size, scale)
    path = f"icons/{filename}"
    icon.save(path, optimize=True)
    print(f"  ✓  {path}")

print("\nDone — all icons written to icons/")
