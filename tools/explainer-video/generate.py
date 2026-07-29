#!/usr/bin/env python3
"""Explainer-video pipeline (spec -> narration -> animated frames -> MP4).

Narration-driven timing: each beat's on-screen duration is set by the real
measured length of its `say`-generated narration clip (plus a fixed gap), so
audio and video align by construction.

Pipeline:
  1. NARRATION  : `say -v <voice>` per beat -> aiff -> wav; measure with ffprobe;
                  concatenate (with silence gaps) into one narration.wav.
  2. FRAMES     : PIL renders 30fps frames for each beat's measured duration.
                  Elements animate (token motion, alpha fades, gate snap).
  3. CAPTIONS   : burned per-beat as a lower-third (drawn straight into frames).
  4. ASSEMBLE   : ffmpeg image2 + narration.wav -> H.264 yuv420p +faststart.

Dependencies: PIL (Pillow) + ffmpeg + macOS `say` only. No npm/Remotion.

Usage:
    python3 generate.py --spec <spec.json> [--voice Samantha] [--test-frame]
    python3 generate.py --spec <spec.json>                 # full build
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ----------------------------------------------------------------------------
# Paths / constants
# ----------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FRAMES_DIR = OUT / "frames"
AUDIO_DIR = OUT / "audio"

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
SAY = "/usr/bin/say"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

GAP_SECONDS = 0.3  # silence after each beat's narration

# Palette (from spec style)
BG = (20, 22, 26)          # #14161a
TEAL = (45, 212, 191)      # #2dd4bf  allowed / flow
AMBER = (245, 158, 11)     # #f59e0b  gates
RED = (239, 68, 68)        # #ef4444  hard-stop
GREY = (100, 116, 139)     # #64748b  inactive
WHITE = (235, 238, 242)
DIM = (150, 160, 172)


# ----------------------------------------------------------------------------
# Small utilities
# ----------------------------------------------------------------------------
def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REGULAR
    if not Path(path).exists():
        path = FONT_REGULAR if Path(FONT_REGULAR).exists() else FONT_BOLD
    return ImageFont.truetype(path, size)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease(t: float) -> float:
    """Smoothstep easing, t in [0,1]."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def mix(c1, c2, t: float):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def probe_duration(path: Path) -> float:
    r = run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)])
    return float(r.stdout.strip())


def text_centered(draw, cx, cy, s, fnt, fill, anchor="mm"):
    draw.text((cx, cy), s, font=fnt, fill=fill, anchor=anchor)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


# ----------------------------------------------------------------------------
# Narration
# ----------------------------------------------------------------------------
def build_narration(spec: dict, voice: str) -> list[dict]:
    """Generate per-beat narration, measure durations, concat one track.
    Returns a duration manifest (list of {id, narration_dur, beat_dur, ...})."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    wav_paths = []

    # one silence clip reused between beats
    silence = AUDIO_DIR / "silence.wav"
    run([FFMPEG, "-y", "-f", "lavfi", "-i",
         "anullsrc=channel_layout=mono:sample_rate=44100",
         "-t", str(GAP_SECONDS), "-c:a", "pcm_s16le", str(silence)])

    for i, beat in enumerate(spec["beats"]):
        aiff = AUDIO_DIR / f"beat_{i}.aiff"
        wav = AUDIO_DIR / f"beat_{i}.wav"
        run([SAY, "-v", voice, "-o", str(aiff), beat["narration"]])
        # normalize to pcm_s16le mono 44100 so concat is clean
        run([FFMPEG, "-y", "-i", str(aiff), "-ar", "44100", "-ac", "1",
             "-c:a", "pcm_s16le", str(wav)])
        dur = probe_duration(wav)
        beat_dur = dur + GAP_SECONDS
        manifest.append({
            "id": beat["id"],
            "narration_dur": round(dur, 3),
            "beat_dur": round(beat_dur, 3),
            "n_frames": None,  # filled after fps known
        })
        wav_paths.append(wav)

    # concat list: beat0, silence, beat1, silence, ...
    concat_list = AUDIO_DIR / "concat.txt"
    lines = []
    for wp in wav_paths:
        lines.append(f"file '{wp.name}'")
        lines.append(f"file '{silence.name}'")
    concat_list.write_text("\n".join(lines) + "\n")

    narration = OUT / "narration.wav"
    run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-c", "copy", str(narration)])
    return manifest


# ----------------------------------------------------------------------------
# Shared visual scaffolding
# ----------------------------------------------------------------------------
LOOP_NODES = ["ORIENT", "CASCADE", "GRADE", "BUBBLE", "CLOSE"]
# which node each beat lights
BEAT_ACTIVE_NODE = {
    "b1-title": None,
    "b2-orient": "ORIENT",
    "b3-cascade-grade": "GRADE",   # cascade+grade; grade is the point
    "b4-layers-gate": "BUBBLE",    # routing/gate -> bubble-up
    "b5-close": "CLOSE",
}


def loop_ring_geom(cx, cy, r):
    """Return list of (name, x, y) for the 5 nodes, starting at top going CW."""
    pts = []
    n = len(LOOP_NODES)
    for i, name in enumerate(LOOP_NODES):
        ang = -math.pi / 2 + i * (2 * math.pi / n)
        pts.append((name, cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def draw_loop_ring(draw, cx, cy, r, active=None, rotation_glow=0.0, scale=1.0):
    """Draw the loop ring + 5 nodes; highlight `active`. rotation_glow animates
    a bright arc traveling around the ring (0..1)."""
    # ring
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GREY, width=3)
    # traveling glow arc
    if rotation_glow > 0:
        start = -90 + rotation_glow * 360
        draw.arc([cx - r, cy - r, cx + r, cy + r],
                 start=start, end=start + 45, fill=TEAL, width=5)
    nr = int(30 * scale)
    fnt = font(int(19 * scale), bold=True)
    for name, x, y in loop_ring_geom(cx, cy, r):
        on = (name == active)
        col = TEAL if on else GREY
        fillc = mix(BG, TEAL, 0.22) if on else BG
        draw.ellipse([x - nr, y - nr, x + nr, y + nr],
                     fill=fillc, outline=col, width=3 if on else 2)
        lx = x
        ly = y - nr - 14
        # keep labels inside frame-ish; place below for bottom nodes
        if y > cy:
            ly = y + nr + 14
        draw.text((lx, ly), name, font=fnt, fill=(WHITE if on else DIM), anchor="mm")


def draw_caption(img, text):
    """Lower-third caption bar with semi-opaque background."""
    if not text:
        return
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    fnt = font(34, bold=True)
    tb = draw.textbbox((0, 0), text, font=fnt)
    tw = tb[2] - tb[0]
    th = tb[3] - tb[1]
    pad_x, pad_y = 34, 20
    bar_w = tw + pad_x * 2
    bar_h = th + pad_y * 2
    bx = (W - bar_w) // 2
    by = H - 120 - bar_h
    draw.rounded_rectangle([bx, by, bx + bar_w, by + bar_h],
                           radius=12, fill=(10, 12, 15, 205))
    draw.text((W // 2, by + bar_h // 2), text, font=fnt, fill=WHITE, anchor="mm")


def base_frame() -> Image.Image:
    return Image.new("RGB", (1920, 1080), BG)


def draw_token(draw, x, y, label, color, r=26, alpha_scale=1.0):
    fillc = mix(BG, color, 0.30 * alpha_scale)
    outc = color
    draw.ellipse([x - r, y - r, x + r, y + r], fill=fillc, outline=outc, width=3)
    draw.text((x, y), label, font=font(22, bold=True), fill=WHITE, anchor="mm")


# ----------------------------------------------------------------------------
# Per-beat renderers.  Each takes (p) progress in [0,1] -> RGB Image.
# ----------------------------------------------------------------------------
def render_b1(p):
    img = base_frame()
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = 960, 470
    # faint circular arrow fading in behind text
    a = int(120 * ease(min(1.0, p * 1.6)))
    r = 240
    draw.arc([cx - r, cy - r, cx + r, cy + r], start=-60, end=250,
             fill=(TEAL[0], TEAL[1], TEAL[2], a), width=6)
    # arrowhead
    ah = a
    draw.polygon([(cx + r - 4, cy - 8), (cx + r + 22, cy + 4), (cx + r - 4, cy + 30)],
                 fill=(TEAL[0], TEAL[1], TEAL[2], ah))
    # title fades/rises in
    t = ease(min(1.0, p * 1.4))
    ty = int(lerp(500, 470, t))
    ta = int(255 * t)
    draw.text((cx, ty), "The Self-Improving Loop", font=font(74, bold=True),
              fill=(WHITE[0], WHITE[1], WHITE[2], ta), anchor="mm")
    draw.text((cx, ty + 70), "one iteration", font=font(38),
              fill=(DIM[0], DIM[1], DIM[2], ta), anchor="mm")
    return img


def render_b2(p):
    """ORIENT + fail-closed branch."""
    img = base_frame()
    draw = ImageDraw.Draw(img, "RGBA")
    draw_loop_ring(draw, 320, 300, 170, active="ORIENT")

    # probe from ORIENT area toward a host icon on the right
    ox, oy = 720, 300      # probe origin
    hx, hy = 1300, 300     # host icon
    # host box
    rounded(draw, [hx - 70, hy - 55, hx + 70, hy + 55], 12,
            fill=mix(BG, GREY, 0.25), outline=GREY, width=3)
    draw.text((hx, hy), "HOST", font=font(26, bold=True), fill=WHITE, anchor="mm")

    # probe travels 0..~0.45, then branch resolves to fail-closed and settles
    reach = ease(min(1.0, p / 0.45))
    tipx = lerp(ox, hx - 78, reach)
    # decide: fail-closed branch is the settled state
    failing = p > 0.5
    probe_col = RED if failing else TEAL
    draw.line([(ox, oy), (tipx, oy)], fill=probe_col, width=6)
    draw.text(((ox + hx) / 2, oy - 34), "runtime?", font=font(24),
              fill=DIM, anchor="mm")

    if not failing:
        # transient: reachable check hint (early)
        if reach > 0.8:
            draw.text((hx, hy + 92), "reachable?", font=font(22),
                      fill=DIM, anchor="mm")
    else:
        # fail closed: host unreachable -> red, UNKNOWN badge, STOP bar
        fp = ease(min(1.0, (p - 0.5) / 0.3))
        # red X over host
        draw.line([(hx - 40, hy - 40), (hx + 40, hy + 40)], fill=RED, width=6)
        draw.line([(hx - 40, hy + 40), (hx + 40, hy - 40)], fill=RED, width=6)
        # UNKNOWN badge
        ba = int(255 * fp)
        bx, by = 1010, 470
        rounded(draw, [bx - 130, by - 34, bx + 130, by + 34], 18,
                fill=(RED[0], RED[1], RED[2], int(60 * fp)),
                outline=(RED[0], RED[1], RED[2], ba), width=3)
        draw.text((bx, by), "STATE: UNKNOWN", font=font(30, bold=True),
                  fill=(WHITE[0], WHITE[1], WHITE[2], ba), anchor="mm")
        # red STOP bar blocking the path
        sw = int(lerp(0, 520, fp))
        sy = 640
        draw.rectangle([960 - sw // 2, sy - 26, 960 + sw // 2, sy + 26],
                       fill=(RED[0], RED[1], RED[2], int(230 * fp)))
        if fp > 0.4:
            draw.text((960, sy), "STOP — fail closed", font=font(30, bold=True),
                      fill=WHITE, anchor="mm")
    return img


def render_b3(p):
    """CASCADE draft -> distinct GRADER; producer != validator."""
    img = base_frame()
    draw = ImageDraw.Draw(img, "RGBA")
    draw_loop_ring(draw, 320, 300, 170, active="GRADE")

    # producer (CASCADE) on left emits a draft card that travels right to grader
    px, py = 760, 340
    gx, gy = 1400, 340
    # producer icon (circle, teal)
    draw.ellipse([px - 60, py - 60, px + 60, py + 60],
                 fill=mix(BG, TEAL, 0.25), outline=TEAL, width=3)
    draw.text((px, py), "CASCADE", font=font(22, bold=True), fill=WHITE, anchor="mm")
    draw.text((px, py + 88), "producer", font=font(22), fill=DIM, anchor="mm")

    # grader icon (distinct: amber, square/diamond)
    da = ease(min(1.0, p * 1.5))
    gcol = AMBER
    # diamond
    pts = [(gx, gy - 62), (gx + 62, gy), (gx, gy + 62), (gx - 62, gy)]
    draw.polygon(pts, fill=(gcol[0], gcol[1], gcol[2], int(70 * da)),
                 outline=gcol)
    draw.line(pts + [pts[0]], fill=gcol, width=3)
    draw.text((gx, gy), "GRADER", font=font(22, bold=True), fill=WHITE, anchor="mm")
    draw.text((gx, gy + 90), "distinct mind", font=font(22), fill=DIM, anchor="mm")

    # draft card travels 0..0.55
    travel = ease(min(1.0, p / 0.55))
    dx = lerp(px + 80, gx - 90, travel)
    rounded(draw, [dx - 55, py - 40, dx + 55, py + 40], 10,
            fill=mix(BG, TEAL, 0.3), outline=TEAL, width=3)
    draw.text((dx, py), "draft", font=font(24, bold=True), fill=WHITE, anchor="mm")

    # link label with shield
    draw.text(((px + gx) / 2, py - 110), "producer  ≠  validator",
              font=font(28, bold=True), fill=WHITE, anchor="mm")
    # shield glyph
    shx, shy = (px + gx) / 2, py - 60
    draw.polygon([(shx, shy - 22), (shx + 20, shy - 12), (shx + 20, shy + 8),
                  (shx, shy + 24), (shx - 20, shy + 8), (shx - 20, shy - 12)],
                 fill=mix(BG, TEAL, 0.35), outline=TEAL)

    # convergent check appears at end
    if p > 0.7:
        ca = ease((p - 0.7) / 0.3)
        cxk, cyk = gx, gy - 120
        col = (TEAL[0], TEAL[1], TEAL[2], int(255 * ca))
        draw.line([(cxk - 20, cyk), (cxk - 6, cyk + 16)], fill=col, width=7)
        draw.line([(cxk - 6, cyk + 16), (cxk + 24, cyk - 18)], fill=col, width=7)
    return img


def render_b4(p):
    """Four risk lanes; token A passes L0; token B flips to L1, gate SNAPS shut,
    routed to operator. Dignity-floor tripwire glows at bottom."""
    img = base_frame()
    draw = ImageDraw.Draw(img, "RGBA")

    # small loop ring top-left for continuity
    draw_loop_ring(draw, 250, 210, 120, active="BUBBLE", scale=0.8)

    lanes = [
        ("L0  Draft", mix(BG, TEAL, 0.16), TEAL),
        ("L0.5  Framework-grant", mix(BG, TEAL, 0.10), mix(TEAL, GREY, 0.4)),
        ("L1  Governance", mix(BG, AMBER, 0.16), AMBER),
        ("L2  Operator", mix(BG, AMBER, 0.28), mix(AMBER, (120, 70, 0), 0.4)),
    ]
    left, right = 560, 1720
    top = 250
    lane_h = 120
    lane_gap = 18
    lane_y = []
    for i, (label, fillc, edge) in enumerate(lanes):
        y0 = top + i * (lane_h + lane_gap)
        y1 = y0 + lane_h
        lane_y.append((y0 + y1) // 2)
        rounded(draw, [left, y0, right, y1], 12, fill=fillc, outline=edge, width=2)
        draw.text((left + 20, y0 + lane_h // 2), label, font=font(26, bold=True),
                  fill=WHITE, anchor="lm")

    l0_y = lane_y[0]
    l1_y = lane_y[2]

    # ---- Operator icon on the right of L1 ----
    opx, opy = right - 70, l1_y
    draw.ellipse([opx - 44, opy - 60, opx + 44, opy + 20], outline=AMBER, width=3)
    draw.ellipse([opx - 24, opy - 78, opx + 24, opy - 34],
                 fill=mix(BG, AMBER, 0.3), outline=AMBER, width=3)
    draw.text((opx, opy + 44), "operator", font=font(22, bold=True),
              fill=AMBER, anchor="mm")

    # ---- Token A: clean pass through L0 (whole beat) ----
    ax = lerp(left + 90, right - 90, ease(p))
    draw_token(draw, ax, l0_y, "A", TEAL)
    draw.text((left + 90, l0_y - 78), "content", font=font(22), fill=DIM, anchor="lm")

    # ---- Token B: enters L0, physics flips it up to L1, gate snaps, routed ----
    # phase timing
    enter_end = 0.30      # B slides in along L0
    flip_end = 0.50       # B rises from L0 to L1
    gate_close_at = 0.52  # gate begins snapping
    gate_close_dur = 0.12 # ~0.4s of a ~3.6s beat... snap fast
    route_end = 0.92

    bx_start = left + 90
    flip_x = 980          # x where physics kicks it upward
    gate_x = 1240         # amber gate position in L1

    if p <= enter_end:
        t = ease(p / enter_end)
        bx = lerp(bx_start, flip_x, t)
        by = l0_y
    elif p <= flip_end:
        t = ease((p - enter_end) / (flip_end - enter_end))
        bx = lerp(flip_x, gate_x - 150, t)
        by = lerp(l0_y, l1_y, t)
    elif p <= route_end:
        t = ease((p - flip_end) / (route_end - flip_end))
        # travels toward gate, pauses at gate, then routed to operator
        bx = lerp(gate_x - 150, opx - 70, t)
        by = l1_y
    else:
        bx, by = opx - 70, l1_y

    # physics arrow at flip point
    if p > enter_end * 0.6 and p < flip_end + 0.1:
        aa = 220
        draw.line([(flip_x, l0_y - 40), (flip_x, l1_y + 40)],
                  fill=(RED[0], RED[1], RED[2], 160), width=3)
        draw.text((flip_x, (l0_y + l1_y) / 2 - 10), "risk\nflip", font=font(20, bold=True),
                  fill=RED, anchor="mm", align="center")

    # ---- Amber GATE in L1: two halves that SNAP shut ----
    gate_open = 1.0
    if p >= gate_close_at:
        gate_open = 1.0 - ease(min(1.0, (p - gate_close_at) / gate_close_dur))
    # gate full vertical span within lane
    gy0, gy1 = l1_y - 52, l1_y + 52
    half = 52
    gap = int(half * gate_open)  # opening between the two halves
    # top half descends, bottom half rises to meet
    top_h_bottom = l1_y - gap
    bot_h_top = l1_y + gap
    # draw gate posts
    draw.rectangle([gate_x - 10, gy0 - 14, gate_x + 10, top_h_bottom],
                   fill=AMBER)
    draw.rectangle([gate_x - 10, bot_h_top, gate_x + 10, gy1 + 14],
                   fill=AMBER)
    # gate label
    lbl_col = AMBER if gate_open > 0.1 else RED
    draw.text((gate_x, gy0 - 34), "GATE", font=font(24, bold=True),
              fill=lbl_col, anchor="mm")
    # snap flash
    if 0 < (p - gate_close_at) < gate_close_dur + 0.05 and gate_open < 0.15:
        draw.line([(gate_x, gy0 - 14), (gate_x, gy1 + 14)],
                  fill=(255, 255, 255, 180), width=4)

    # draw token B (amber = risky change)
    draw_token(draw, bx, by, "B", AMBER)
    if p < 0.25:
        draw.text((bx, by + 70), "edit gate rules", font=font(20, bold=True),
                  fill=AMBER, anchor="mm")

    # routed-to-operator confirmation
    if p > route_end - 0.02:
        draw.text((opx, opy - 108), "→ comes to you", font=font(24, bold=True),
                  fill=AMBER, anchor="mm")

    # ---- dignity-floor tripwire glowing at the very bottom ----
    fy = top + 4 * (lane_h + lane_gap) + 8
    glow = 0.4 + 0.6 * abs(math.sin(p * math.pi * 3))
    dc = (RED[0], RED[1], RED[2], int(120 + 120 * glow))
    for gx in range(left, right, 26):
        draw.line([(gx, fy), (gx + 14, fy)], fill=dc, width=3)
    draw.text((left, fy + 24), "dignity floor  (hard tripwire)",
              font=font(22, bold=True),
              fill=(RED[0], RED[1], RED[2], 230), anchor="lm")
    return img


def render_b5(p):
    """CLOSE: evidence files into ledger; ring completes a rotation;
    interruptible glyph; end card."""
    img = base_frame()
    draw = ImageDraw.Draw(img, "RGBA")
    # ring completes one rotation (traveling glow) while CLOSE lights
    draw_loop_ring(draw, 350, 360, 180, active="CLOSE", rotation_glow=ease(min(1.0, p / 0.7)))

    # evidence doc files into a ledger on the right
    lx, ly = 1250, 360
    # ledger
    rounded(draw, [lx - 90, ly - 110, lx + 90, ly + 140], 12,
            fill=mix(BG, GREY, 0.2), outline=GREY, width=3)
    draw.text((lx, ly + 165), "ledger", font=font(24, bold=True), fill=DIM, anchor="mm")
    # doc travels into ledger 0..0.5
    dt = ease(min(1.0, p / 0.5))
    dx = lerp(760, lx, dt)
    dy = lerp(300, ly - 40, dt)
    da = 1.0 - max(0.0, (p - 0.5) / 0.5)  # fades as it "files"
    dcol = (TEAL[0], TEAL[1], TEAL[2], int(255 * max(0.15, da)))
    rounded(draw, [dx - 44, dy - 56, dx + 44, dy + 56], 8,
            fill=(TEAL[0], TEAL[1], TEAL[2], int(70 * max(0.15, da))),
            outline=dcol, width=3)
    for k in range(3):
        yy = dy - 24 + k * 22
        draw.line([(dx - 26, yy), (dx + 26, yy)], fill=dcol, width=3)
    draw.text((dx, dy + 84), "evidence", font=font(20), fill=DIM, anchor="mm")
    # stacked filed docs in ledger
    filed = int(min(3, math.floor(p * 4)))
    for k in range(filed):
        yy = ly + 90 - k * 26
        draw.rectangle([lx - 60, yy - 8, lx + 60, yy + 8],
                       fill=mix(BG, TEAL, 0.3), outline=TEAL, width=2)

    # interruptible pause/kill glyph
    if p > 0.35:
        ia = ease(min(1.0, (p - 0.35) / 0.3))
        ix, iy = 700, 760
        col = (WHITE[0], WHITE[1], WHITE[2], int(255 * ia))
        draw.rectangle([ix - 16, iy - 22, ix - 4, iy + 22], fill=col)
        draw.rectangle([ix + 4, iy - 22, ix + 16, iy + 22], fill=col)
        draw.text((ix + 46, iy), "interruptible", font=font(26, bold=True),
                  fill=(WHITE[0], WHITE[1], WHITE[2], int(255 * ia)), anchor="lm")

    # end card text (fades in late)
    if p > 0.55:
        ea = ease((p - 0.55) / 0.45)
        draw.text((960, 940), "The loop drafts freely.",
                  font=font(34, bold=True),
                  fill=(WHITE[0], WHITE[1], WHITE[2], int(255 * ea)), anchor="mm")
        draw.text((960, 986),
                  "It can never change its own rules, or go live, without you.",
                  font=font(30),
                  fill=(AMBER[0], AMBER[1], AMBER[2], int(255 * ea)), anchor="mm")
    return img


RENDERERS = {
    "b1-title": render_b1,
    "b2-orient": render_b2,
    "b3-cascade-grade": render_b3,
    "b4-layers-gate": render_b4,
    "b5-close": render_b5,
}


# ----------------------------------------------------------------------------
# Frame rendering + assembly
# ----------------------------------------------------------------------------
def render_frames(spec: dict, manifest: list[dict], fps: int) -> int:
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    global_idx = 0
    b4_keep = None
    for beat, m in zip(spec["beats"], manifest):
        n = int(round(m["beat_dur"] * fps))
        m["n_frames"] = n
        renderer = RENDERERS[beat["id"]]
        caption = beat.get("caption", "")
        for f in range(n):
            p = f / max(1, n - 1)
            img = renderer(p)
            draw_caption(img, caption)
            img.save(FRAMES_DIR / f"frame-{global_idx:05d}.png")
            # keep a representative b4 mid-gate frame
            if beat["id"] == "b4-layers-gate" and abs(p - 0.62) < (0.5 / n):
                b4_keep = global_idx
            global_idx += 1
    # save sample-b4
    if b4_keep is not None:
        shutil.copy(FRAMES_DIR / f"frame-{b4_keep:05d}.png", OUT / "sample-b4.png")
    return global_idx


def assemble(fps: int, out_mp4: Path):
    narration = OUT / "narration.wav"
    cmd = [
        FFMPEG, "-y",
        "-framerate", str(fps),
        "-i", str(FRAMES_DIR / "frame-%05d.png"),
        "-i", str(narration),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(out_mp4),
    ]
    run(cmd)


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--voice", default="Samantha")
    ap.add_argument("--test-frame", action="store_true",
                    help="Render one test frame per beat and exit (font/render proof).")
    ap.add_argument("--keep-frames", action="store_true")
    args = ap.parse_args()

    spec = json.loads(Path(args.spec).read_text())
    fps = spec.get("fps", 30)
    OUT.mkdir(parents=True, exist_ok=True)

    # PROVE font loads + a frame renders before any heavy work
    _ = font(40, bold=True)
    if args.test_frame:
        for beat in spec["beats"]:
            img = RENDERERS[beat["id"]](0.62)
            draw_caption(img, beat.get("caption", ""))
            outp = OUT / f"test-{beat['id']}.png"
            img.save(outp)
            print(f"  test frame: {outp}")
        print("Font + all beat renderers OK.")
        return

    print("[1/4] Narration (say -> wav, measure, concat)...")
    manifest = build_narration(spec, args.voice)

    print("[2/4] Rendering frames...")
    total = render_frames(spec, manifest, fps)
    total_dur = sum(m["beat_dur"] for m in manifest)
    (OUT / "duration-manifest.json").write_text(json.dumps({
        "voice": args.voice, "fps": fps, "gap_seconds": GAP_SECONDS,
        "total_frames": total, "total_seconds": round(total_dur, 3),
        "beats": manifest,
    }, indent=2))
    print(f"      {total} frames, {total_dur:.2f}s timeline")

    print("[3/4] Assembling MP4...")
    out_mp4 = OUT / f"{spec['video_id']}.mp4"
    assemble(fps, out_mp4)

    print("[4/4] Cleaning frames (keeping sample-b4.png)...")
    if not args.keep_frames:
        shutil.rmtree(FRAMES_DIR)
        shutil.rmtree(AUDIO_DIR)
    print(f"DONE: {out_mp4}")


if __name__ == "__main__":
    main()
