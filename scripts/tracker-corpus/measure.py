#!/usr/bin/env python3
"""Measure UI dimensions from the (git-ignored) Tracker help-site screenshot corpus.

The corpus images are help-article screenshots: cropped and scaled by an unknown
factor, so every measurement is reported in *image pixels* and converted to CSS px
only via an explicitly named ruler (--scale).

Usage:
  measure.py rows   <prefix> --x0 N --x1 N [--y0 N --y1 N] [--scale S]
  measure.py cols   <prefix> --y0 N --y1 N [--x0 N --x1 N] [--scale S]
  measure.py runs   <prefix> --axis x|y --at N   # colour runs along a scanline
  measure.py glyph  <prefix> --x0 --x1 --y0 --y1 # ink bbox (x-height / cap-height)
  measure.py size   <prefix>
"""
import argparse, glob, os, sys
from PIL import Image

IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "..", "docs", "reference", "tracker", "images")


def resolve(prefix):
    for pat in (prefix + "@1x-*.png", prefix + "@2x-*.png", prefix + "*.png"):
        m = sorted(glob.glob(os.path.join(IMG_DIR, pat)))
        if m:
            return m[0]
    sys.exit("no image for prefix %r" % prefix)


def load(prefix):
    return Image.open(resolve(prefix)).convert("RGB")


def band_means(im, x0, x1, y0, y1, axis):
    px = im.load()
    out = []
    if axis == "y":
        for y in range(y0, y1):
            n = x1 - x0
            r = sum(px[x, y][0] for x in range(x0, x1)) / n
            g = sum(px[x, y][1] for x in range(x0, x1)) / n
            b = sum(px[x, y][2] for x in range(x0, x1)) / n
            out.append((y, r, g, b))
    else:
        for x in range(x0, x1):
            n = y1 - y0
            r = sum(px[x, y][0] for y in range(y0, y1)) / n
            g = sum(px[x, y][1] for y in range(y0, y1)) / n
            b = sum(px[x, y][2] for y in range(y0, y1)) / n
            out.append((x, r, g, b))
    return out


def find_edges(means, thr):
    """Indices where the banded mean colour jumps by more than `thr`."""
    edges = []
    for i in range(1, len(means)):
        p, q = means[i - 1], means[i]
        d = max(abs(p[1] - q[1]), abs(p[2] - q[2]), abs(p[3] - q[3]))
        if d >= thr:
            edges.append((means[i][0], round(d, 1)))
    return edges


def cmd_rows(a):
    im = load(a.prefix)
    w, h = im.size
    x1 = a.x1 if a.x1 is not None else w
    y1 = a.y1 if a.y1 is not None else h
    means = band_means(im, a.x0, x1, a.y0, y1, "y")
    edges = find_edges(means, a.thr)
    print("image %s  size=%dx%d  band x=%d..%d" % (os.path.basename(resolve(a.prefix)), w, h, a.x0, x1))
    prev = None
    for y, d in edges:
        pitch = "" if prev is None else "  pitch=%d" % (y - prev)
        if a.scale:
            pitch += ("  (%.1f css px)" % ((y - prev) / a.scale)) if prev is not None else ""
        print("  edge y=%-5d delta=%-6s%s" % (y, d, pitch))
        prev = y


def cmd_cols(a):
    im = load(a.prefix)
    w, h = im.size
    x1 = a.x1 if a.x1 is not None else w
    y1 = a.y1 if a.y1 is not None else h
    means = band_means(im, a.x0, x1, a.y0, y1, "x")
    edges = find_edges(means, a.thr)
    print("image %s  size=%dx%d  band y=%d..%d" % (os.path.basename(resolve(a.prefix)), w, h, a.y0, y1))
    prev = None
    for x, d in edges:
        pitch = "" if prev is None else "  pitch=%d" % (x - prev)
        if a.scale:
            pitch += ("  (%.1f css px)" % ((x - prev) / a.scale)) if prev is not None else ""
        print("  edge x=%-5d delta=%-6s%s" % (x, d, pitch))
        prev = x


def cmd_runs(a):
    im = load(a.prefix)
    w, h = im.size
    px = im.load()
    seq = [px[a.at, y] for y in range(h)] if a.axis == "y" else [px[x, a.at] for x in range(w)]
    start, cur = 0, seq[0]
    for i, c in enumerate(seq[1:], 1):
        if max(abs(c[k] - cur[k]) for k in range(3)) > a.thr:
            print("  %4d..%-4d len=%-4d %s" % (start, i - 1, i - start, cur))
            start, cur = i, c
    print("  %4d..%-4d len=%-4d %s" % (start, len(seq) - 1, len(seq) - start, cur))


def cmd_glyph(a):
    """Ink bounding box inside a rect: use on a lowercase run for x-height,
    on an uppercase run for cap-height."""
    im = load(a.prefix)
    px = im.load()
    x1 = a.x1 or im.size[0]
    y1 = a.y1 or im.size[1]
    # background = most common colour in the rect
    from collections import Counter
    cnt = Counter(px[x, y] for x in range(a.x0, x1) for y in range(a.y0, y1))
    bg = cnt.most_common(1)[0][0]
    rows, cols = [], []
    for y in range(a.y0, y1):
        for x in range(a.x0, x1):
            if max(abs(px[x, y][k] - bg[k]) for k in range(3)) > a.thr:
                rows.append(y)
                cols.append(x)
    if not rows:
        print("  no ink found (bg=%s)" % (bg,))
        return
    print("  bg=%s ink bbox x=%d..%d (w=%d) y=%d..%d (h=%d)"
          % (bg, min(cols), max(cols), max(cols) - min(cols) + 1,
             min(rows), max(rows), max(rows) - min(rows) + 1))
    if a.scale:
        print("  -> %.2f css px tall" % ((max(rows) - min(rows) + 1) / a.scale))


def cmd_size(a):
    im = load(a.prefix)
    print(os.path.basename(resolve(a.prefix)), im.size)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["rows", "cols", "runs", "glyph", "size"])
    p.add_argument("prefix")
    p.add_argument("--x0", type=int, default=0)
    p.add_argument("--x1", type=int, default=None)
    p.add_argument("--y0", type=int, default=0)
    p.add_argument("--y1", type=int, default=None)
    p.add_argument("--thr", type=float, default=12)
    p.add_argument("--axis", default="y")
    p.add_argument("--at", type=int, default=0)
    p.add_argument("--scale", type=float, default=None,
                   help="image px per CSS px, derived from a named ruler")
    a = p.parse_args()
    globals()["cmd_" + a.cmd](a)


if __name__ == "__main__":
    main()
