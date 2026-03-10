#!/usr/bin/env python3
"""Generate all icon variants for the Lease Mileage Tracker PWA.

Design: three-zone budget gauge on a blue iOS-style rounded square.
  Green  (150°–230°, 80°) — on track / under budget
  Yellow (230°–290°, 60°) — approaching limit
  Red    (290°→30°, 100°)  — over budget
Needle sits solidly in the green zone at 190°.
"""

from PIL import Image, ImageDraw
import math, os

# ── Palette ────────────────────────────────────────────────────────────────────
BLUE   = (59,  130, 246, 255)   # brand blue background
GREEN  = (34,  197,  94, 255)   # on-track zone
YELLOW = (245, 158,  11, 255)   # warning zone
RED    = (239,  68,  68, 255)   # over-budget zone
WHITE  = (255, 255, 255, 255)


def draw_gauge_icon(out_size: int, gauge_scale: float = 1.0) -> Image.Image:
    """
    Render the gauge icon at `out_size` × `out_size` pixels.
    gauge_scale=1.0 → standard; 0.78 → maskable safe-zone variant.
    Uses 4× super-sampling for anti-aliased edges.
    """
    SS = 4                          # super-sampling factor
    S  = out_size * SS

    img  = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── 1. Blue rounded-square background ──────────────────────────────────────
    corner_r = int(S * 0.22)        # ~22% → iOS squircle rounding
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=corner_r, fill=BLUE)

    # ── 2. Gauge geometry ──────────────────────────────────────────────────────
    cx = S // 2
    cy = int(S * 0.55)              # center sits slightly below icon midpoint
    outer_r = int(S * 0.355 * gauge_scale)
    inner_r = int(S * 0.220 * gauge_scale)

    o_bbox = [cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r]
    i_bbox = [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r]

    # ── 3. Donut gauge sectors ─────────────────────────────────────────────────
    # PIL angles: 0°=east, clockwise-positive (y-down).
    # Arc runs 150° → 30° clockwise (240° sweep, arch over the top).
    # Red wraps past 360° so we split it at 0°.
    draw.pieslice(o_bbox, 150, 230, fill=GREEN)
    draw.pieslice(o_bbox, 230, 290, fill=YELLOW)
    draw.pieslice(o_bbox, 290, 360, fill=RED)   # 290 → 360
    draw.pieslice(o_bbox,   0,  30, fill=RED)   #   0 →  30

    # Erase centre → turns pie slices into a donut ring
    draw.ellipse(i_bbox, fill=BLUE)

    # ── 4. Needle ──────────────────────────────────────────────────────────────
    # 190° is solidly in the green zone (green: 150°–230°).
    # At 190° the needle tip is upper-left of pivot — a natural "safe" reading.
    angle_rad  = math.radians(190)
    needle_len = int(outer_r * 0.82)
    nx = cx + int(needle_len * math.cos(angle_rad))
    ny = cy + int(needle_len * math.sin(angle_rad))
    nw = max(12, int(S * 0.016))    # scales with icon size
    draw.line([(cx, cy), (nx, ny)], fill=WHITE, width=nw)

    # ── 5. Pivot circle ────────────────────────────────────────────────────────
    piv_r = int(S * 0.036)
    draw.ellipse(
        [cx - piv_r, cy - piv_r, cx + piv_r, cy + piv_r],
        fill=WHITE,
    )

    # ── 6. Downsample with LANCZOS for quality ─────────────────────────────────
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
