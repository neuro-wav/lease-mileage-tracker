#!/usr/bin/env python3
"""
Generate PWA speedometer icons using only Python standard library.
Produces PNG files by manually constructing the binary format.
"""

import struct
import zlib
import math
import os

# --- PNG writing helpers ---

def make_png(width, height, pixels):
    """
    Create a PNG file from raw pixel data.
    pixels: list of rows, each row is list of (R, G, B) tuples.
    Returns bytes of the PNG file.
    """
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)

    # Signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT - raw image data with filter byte 0 per row
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: None
        for r, g, b in row:
            raw.append(r & 0xFF)
            raw.append(g & 0xFF)
            raw.append(b & 0xFF)

    compressed = zlib.compress(bytes(raw), 9)
    idat = make_chunk(b'IDAT', compressed)

    # IEND
    iend = make_chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


# --- Drawing primitives ---

def create_canvas(size, bg_color):
    """Create a size x size canvas filled with bg_color."""
    return [[bg_color for _ in range(size)] for _ in range(size)]


def blend_pixel(pixels, x, y, color, alpha, size):
    """Blend a color onto a pixel with given alpha (0.0 - 1.0)."""
    if 0 <= x < size and 0 <= y < size:
        bg = pixels[y][x]
        r = int(bg[0] * (1 - alpha) + color[0] * alpha)
        g = int(bg[1] * (1 - alpha) + color[1] * alpha)
        b = int(bg[2] * (1 - alpha) + color[2] * alpha)
        pixels[y][x] = (r, g, b)


def draw_aa_filled_circle(pixels, cx, cy, radius, color, size):
    """Draw a filled circle with anti-aliased edges using sub-pixel sampling."""
    x_min = max(0, int(cx - radius - 2))
    x_max = min(size - 1, int(cx + radius + 2))
    y_min = max(0, int(cy - radius - 2))
    y_max = min(size - 1, int(cy + radius + 2))

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            # 4x4 sub-pixel sampling
            count = 0
            for sy in range(4):
                for sx in range(4):
                    px = x + (sx + 0.5) / 4.0 - 0.5
                    py = y + (sy + 0.5) / 4.0 - 0.5
                    dx = px - cx
                    dy = py - cy
                    if dx * dx + dy * dy <= radius * radius:
                        count += 1
            if count > 0:
                alpha = count / 16.0
                blend_pixel(pixels, x, y, color, alpha, size)


def draw_thick_arc(pixels, cx, cy, radius, thickness, start_angle, end_angle, color, size):
    """
    Draw a thick arc by placing anti-aliased circles along the arc path.
    Angles in radians. Arc goes from start_angle to end_angle.
    """
    arc_length = abs(end_angle - start_angle) * radius
    steps = max(int(arc_length * 2.5), 200)
    dot_radius = thickness / 2.0

    for i in range(steps + 1):
        t = i / steps
        angle = start_angle + t * (end_angle - start_angle)
        x = cx + radius * math.cos(angle)
        y = cy + radius * math.sin(angle)
        draw_aa_filled_circle(pixels, x, y, dot_radius, color, size)


def draw_thick_line(pixels, x1, y1, x2, y2, thickness, color, size):
    """Draw a thick line by placing anti-aliased circles along it."""
    dx = x2 - x1
    dy = y2 - y1
    length = math.sqrt(dx * dx + dy * dy)
    steps = max(int(length * 2.5), 50)
    dot_radius = thickness / 2.0

    for i in range(steps + 1):
        t = i / steps
        x = x1 + t * dx
        y = y1 + t * dy
        draw_aa_filled_circle(pixels, x, y, dot_radius, color, size)


# --- Icon generation ---

def generate_speedometer_icon(size, maskable=False):
    """Generate a speedometer icon at the given size."""
    blue = (59, 130, 246)
    white = (255, 255, 255)
    light_blue = (96, 165, 250)

    pixels = create_canvas(size, blue)

    # For maskable icons, scale content to ~55% and center it.
    # For regular icons, use ~80% of the canvas.
    if maskable:
        scale = 0.55
    else:
        scale = 0.80

    cx = size / 2.0
    cy = size / 2.0

    arc_radius = size * scale * 0.36
    arc_thickness = max(2.0, size * scale * 0.045)

    # Gauge arc: open at the bottom.
    # Screen coords with math.cos/sin: 0=right, pi/2=down, pi=left, 3pi/2=up
    # 80° gap at the bottom
    gap_angle = math.radians(80)
    start_angle = math.pi / 2 + gap_angle / 2
    end_angle = math.pi / 2 - gap_angle / 2 + 2 * math.pi

    # Shift center down slightly
    gauge_cy = cy + size * scale * 0.06

    # Draw outer arc
    draw_thick_arc(pixels, cx, gauge_cy, arc_radius, arc_thickness, start_angle, end_angle, white, size)

    # Draw major tick marks
    num_major = 10
    tick_outer_radius = arc_radius + arc_thickness * 0.5 + size * scale * 0.04
    tick_inner_radius = arc_radius + arc_thickness * 0.5
    tick_thickness = max(1.5, size * scale * 0.02)

    for i in range(num_major + 1):
        t = i / num_major
        angle = start_angle + t * (end_angle - start_angle)
        x1 = cx + tick_inner_radius * math.cos(angle)
        y1 = gauge_cy + tick_inner_radius * math.sin(angle)
        x2 = cx + tick_outer_radius * math.cos(angle)
        y2 = gauge_cy + tick_outer_radius * math.sin(angle)
        draw_thick_line(pixels, x1, y1, x2, y2, tick_thickness, white, size)

    # Draw inner arc (thinner, decorative)
    inner_arc_radius = arc_radius * 0.72
    inner_arc_thickness = max(1.0, arc_thickness * 0.35)
    draw_thick_arc(pixels, cx, gauge_cy, inner_arc_radius, inner_arc_thickness, start_angle, end_angle, light_blue, size)

    # Draw needle at ~35% position
    needle_fraction = 0.35
    needle_angle = start_angle + needle_fraction * (end_angle - start_angle)
    needle_length = arc_radius * 0.78
    needle_thickness = max(2.0, size * scale * 0.032)

    needle_tip_x = cx + needle_length * math.cos(needle_angle)
    needle_tip_y = gauge_cy + needle_length * math.sin(needle_angle)

    draw_thick_line(pixels, cx, gauge_cy, needle_tip_x, needle_tip_y, needle_thickness, white, size)

    # Draw needle hub
    base_radius = max(2.0, size * scale * 0.04)
    draw_aa_filled_circle(pixels, cx, gauge_cy, base_radius * 1.5, white, size)

    # Draw center dot (accent)
    center_dot_radius = max(1.5, size * scale * 0.022)
    draw_aa_filled_circle(pixels, cx, gauge_cy, center_dot_radius, blue, size)

    # Draw small indicator bar below gauge
    bar_y = gauge_cy + arc_radius * 0.45
    bar_half_width = size * scale * 0.08
    bar_thickness = max(1.0, size * scale * 0.018)
    draw_thick_line(pixels, cx - bar_half_width, bar_y, cx + bar_half_width, bar_y, bar_thickness, light_blue, size)

    # Draw small dot below the bar
    dot_y = bar_y + size * scale * 0.05
    dot_r = max(1.0, size * scale * 0.012)
    draw_aa_filled_circle(pixels, cx, dot_y, dot_r, light_blue, size)

    return pixels


def main():
    output_dir = "/Users/estherjeon/Claude Code/icons"
    os.makedirs(output_dir, exist_ok=True)

    configs = [
        ("icon-180.png", 180, False),
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-192.png", 192, True),
        ("icon-maskable-512.png", 512, True),
    ]

    for filename, size, maskable in configs:
        print(f"Generating {filename} ({size}x{size}, maskable={maskable})...")
        pixels = generate_speedometer_icon(size, maskable)
        png_data = make_png(size, size, pixels)

        filepath = os.path.join(output_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(png_data)

        file_size = os.path.getsize(filepath)
        print(f"  -> {filepath} ({file_size:,} bytes)")

    # Verify all files
    print("\nVerification:")
    for filename, size, maskable in configs:
        filepath = os.path.join(output_dir, filename)
        if os.path.exists(filepath):
            file_size = os.path.getsize(filepath)
            print(f"  OK: {filename} exists ({file_size:,} bytes)")
        else:
            print(f"  MISSING: {filename}")

    print("\nDone!")


if __name__ == "__main__":
    main()
