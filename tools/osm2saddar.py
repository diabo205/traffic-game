#!/usr/bin/env python3
"""
Bake OpenStreetMap Saddar road network, blocks, landmarks, POIs, and oriented
building lots into src/sim/city/saddarData.ts for Karachi Traffic 3D.

Data source: OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors)
BBox: 67.0205, 24.8525, 67.0395, 24.8675 (Saddar, Karachi)
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import math
import os
import random
import sys
import urllib.request
import xml.etree.ElementTree as ET

sys.setrecursionlimit(20000)

DEFAULT_URL = "https://api.openstreetmap.org/api/0.6/map?bbox=67.0205,24.8525,67.0395,24.8675"

# Local projection origin near Empress Market (m: +x = east, +z = north)
LAT0 = 24.8605
LON0 = 67.0303
M_PER_LAT = 110765.0
M_PER_LON = 111320.0 * math.cos(math.radians(LAT0))

# Sim road network clip box and built outer rim extent (m)
XMIN, ZMIN, XMAX, ZMAX = -950.0, -865.0, 905.0, 760.0
OUTER_DEPTH = 36.0
SIDEWALK = 4.2

DRIVABLE = {
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "residential",
    "unclassified",
    "living_street",
}

# Empress Market Hall (OSM way 681523985 around (-79, 224.6), facing SE toward Shahrah-e-Liaquat)
EMPRESS = {
    "x": -79.0,
    "z": 224.6,
    "hw": 13.0,   # depth / 2 along outward facade normal (+right)
    "hl": 30.0,   # length / 2 along frontage
    "heading": 1.089,
}

# Curated iconic Saddar POIs (verified in OSM bbox, local metres around Empress Market)
CURATED_POIS: list[tuple[str, float, float]] = [
    ("Empress Market", -79.0, 224.6),
    ("Bohri Bazaar", -161.5, 3.0),
    ("Zainab Market", -196.0, -536.0),
    ("Regal Chowk", -592.7, -4.1),
    ("Jehangir Park", -252.0, 148.0),
    ("Rainbow Centre", 24.1, 316.2),
    ("Atrium Mall", -54.1, -514.0),
    ("Capri Cinema", -215.3, 730.4),
    ("Gul Plaza", -650.3, 454.8),
    ("Tibet Centre", -841.4, 260.4),
    ("Paradise Shopping Centre", -385.0, -157.5),
    ("Panorama Centre", -12.4, -542.4),
    ("Lucky Star Chowk", 293.3, -383.6),
    ("Pakistan Secretariat", -534.7, -385.6),
    ("Sindh High Court", -881.9, -441.5),
    ("Passport Office Saddar", -687.9, -319.5),
    ("Preedy Police Station", -877.6, 152.5),
    ("Karachi Press Club", -393.9, -603.2),
    ("Karachi Grammar School", -196.4, 447.6),
    ("Historic YMCA", -488.1, -811.3),
    ("Fawara Chowk", -188.7, -749.8),
    ("Art Council Roundabout", -845.8, -813.3),
    ("St. Patrick's High School", 416.8, 233.8),
    ("Madina Mall", -172.1, -657.1),
]


def proj(lat: float, lon: float) -> tuple[float, float]:
    return (lon - LON0) * M_PER_LON, (lat - LAT0) * M_PER_LAT


def clip_seg(x0: float, z0: float, x1: float, z1: float) -> tuple[float, float, float, float] | None:
    dx, dz = x1 - x0, z1 - z0
    t0, t1 = 0.0, 1.0
    for p, q in [(-dx, x0 - XMIN), (dx, XMAX - x0), (-dz, z0 - ZMIN), (dz, ZMAX - z0)]:
        if abs(p) < 1e-12:
            if q < 0:
                return None
        else:
            r = q / p
            if p < 0:
                if r > t1:
                    return None
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return None
                if r < t1:
                    t1 = r
    return (x0 + t0 * dx, z0 + t0 * dz, x0 + t1 * dx, z0 + t1 * dz)


def road_cls(hw: str) -> str:
    if hw in ("trunk", "trunk_link", "primary", "primary_link"):
        return "arterial"
    if hw in ("secondary", "secondary_link", "tertiary", "tertiary_link"):
        return "main"
    return "side"


def link_spec(hw: str, tags: dict[str, str], cls: str, oneway: bool) -> tuple[int, float]:
    lanes_tag: int | None = None
    if "lanes" in tags:
        try:
            lanes_tag = int(tags["lanes"].split(";")[0].strip())
        except ValueError:
            lanes_tag = None
    if oneway:
        if lanes_tag is not None:
            ln = max(1, min(3, lanes_tag))
        elif hw in ("trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link"):
            ln = 2
        else:
            ln = 1
        lw = 4.0 if ln == 1 else (3.1 if ln == 2 else 2.8)
    else:
        if lanes_tag is not None:
            ln = max(1, min(2, lanes_tag // 2 or 1))
        elif cls in ("arterial", "main") and hw in ("primary", "secondary"):
            ln = 2
        else:
            ln = 1
        lw = 3.1 if ln == 2 else 3.3
    return ln, lw


def seg_cross(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float], d: tuple[float, float]) -> bool:
    ax, az = a
    bx, bz = b
    cx, cz = c
    dx, dz = d
    if max(ax, bx) <= min(cx, dx) + 1e-6 or max(cx, dx) <= min(ax, bx) + 1e-6:
        return False
    if max(az, bz) <= min(cz, dz) + 1e-6 or max(cz, dz) <= min(az, bz) + 1e-6:
        return False

    def ccw(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1 = ccw(c, d, a)
    d2 = ccw(c, d, b)
    d3 = ccw(a, b, c)
    d4 = ccw(a, b, d)
    return ((d1 > 1e-7 and d2 < -1e-7) or (d1 < -1e-7 and d2 > 1e-7)) and (
        (d3 > 1e-7 and d4 < -1e-7) or (d3 < -1e-7 and d4 > 1e-7)
    )


def poly_area(poly: list[tuple[float, float]]) -> float:
    return 0.5 * sum(
        poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
        for i in range(len(poly))
    )


def pt_in_poly(x: float, z: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if ((z1 > z) != (z2 > z)) and (x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-18) + x1):
            inside = not inside
    return inside


def pt_to_seg_dist2(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    if l2 < 1e-12:
        return (px - ax) ** 2 + (pz - az) ** 2
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return (px - (ax + t * dx)) ** 2 + (pz - (az + t * dz)) ** 2


def pt_in_tri(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> bool:
    def sign(p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float]) -> float:
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    return not (((d1 < -1e-9) or (d2 < -1e-9) or (d3 < -1e-9)) and ((d1 > 1e-9) or (d2 > 1e-9) or (d3 > 1e-9)))


def strip_spurs(f_nodes: list[int]) -> list[int]:
    arr = list(f_nodes)
    changed = True
    while changed and len(arr) >= 3:
        changed = False
        n = len(arr)
        for i in range(n):
            if arr[i] == arr[(i + 2) % n]:
                for k in sorted([(i + 1) % n, (i + 2) % n], reverse=True):
                    arr.pop(k)
                changed = True
                break
    return arr


def ear_clip_ccw(poly: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    pts_l = list(poly)
    if poly_area(pts_l) < 0:
        pts_l.reverse()
    cleaned: list[tuple[float, float]] = []
    for p in pts_l:
        if not cleaned or math.hypot(p[0] - cleaned[-1][0], p[1] - cleaned[-1][1]) > 1e-4:
            cleaned.append(p)
    if len(cleaned) >= 2 and math.hypot(cleaned[0][0] - cleaned[-1][0], cleaned[0][1] - cleaned[-1][1]) < 1e-4:
        cleaned.pop()
    tris: list[list[tuple[float, float]]] = []
    idxs = list(range(len(cleaned)))
    guard = 0
    while len(idxs) > 3 and guard < 40000:
        guard += 1
        clipped = False
        m = len(idxs)
        for i in range(m):
            a, b, c = cleaned[idxs[(i - 1) % m]], cleaned[idxs[i]], cleaned[idxs[(i + 1) % m]]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-7:
                continue
            if any(pt_in_tri(cleaned[idxs[j]], a, b, c) for j in range(m) if j not in ((i - 1) % m, i, (i + 1) % m)):
                continue
            tris.append([a, b, c])
            idxs.pop(i)
            clipped = True
            break
        if not clipped:
            break
    if len(idxs) == 3:
        a, b, c = cleaned[idxs[0]], cleaned[idxs[1]], cleaned[idxs[2]]
        if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-5:
            tris.append([a, b, c])
    return tris


def ear_clip_indexed(poly: list[tuple[float, float]]) -> tuple[list[tuple[float, float]], list[int]]:
    """Ear clip a simple polygon returning its vertex list (deduplicated) and triangle index list."""
    pts_l = list(poly)
    if poly_area(pts_l) < 0:
        pts_l.reverse()
    cleaned: list[tuple[float, float]] = []
    for p in pts_l:
        if not cleaned or math.hypot(p[0] - cleaned[-1][0], p[1] - cleaned[-1][1]) > 1e-4:
            cleaned.append(p)
    if len(cleaned) >= 2 and math.hypot(cleaned[0][0] - cleaned[-1][0], cleaned[0][1] - cleaned[-1][1]) < 1e-4:
        cleaned.pop()
    tris: list[int] = []
    idxs = list(range(len(cleaned)))
    guard = 0
    while len(idxs) > 3 and guard < 40000:
        guard += 1
        clipped = False
        m = len(idxs)
        for i in range(m):
            ia, ib, ic = idxs[(i - 1) % m], idxs[i], idxs[(i + 1) % m]
            a, b, c = cleaned[ia], cleaned[ib], cleaned[ic]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-7:
                continue
            if any(pt_in_tri(cleaned[idxs[j]], a, b, c) for j in range(m) if j not in ((i - 1) % m, i, (i + 1) % m)):
                continue
            tris.extend((ia, ib, ic))
            idxs.pop(i)
            clipped = True
            break
        if not clipped:
            break
    if len(idxs) == 3:
        ia, ib, ic = idxs[0], idxs[1], idxs[2]
        a, b, c = cleaned[ia], cleaned[ib], cleaned[ic]
        if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-5:
            tris.extend((ia, ib, ic))
    return cleaned, tris


def make_capsule_tangent(ax: float, az: float, bx: float, bz: float, r: float) -> list[tuple[float, float]]:
    dx, dz = bx - ax, bz - az
    d = math.hypot(dx, dz)
    if d < 1e-6:
        r_v = r / math.cos(math.pi / 12.0)
        return [(ax + r_v * math.cos(k * math.pi / 6.0), az + r_v * math.sin(k * math.pi / 6.0)) for k in range(12)]
    ux, uz = dx / d, dz / d
    nx, nz = -uz, ux

    def inter(a1: float, p1: tuple[float, float], a2: float, p2: tuple[float, float]) -> tuple[float, float]:
        c1, s1 = math.cos(a1), math.sin(a1)
        c2, s2 = math.cos(a2), math.sin(a2)
        rhs1 = c1 * p1[0] + s1 * p1[1] + r
        rhs2 = c2 * p2[0] + s2 * p2[1] + r
        det = c1 * s2 - c2 * s1
        return ((rhs1 * s2 - rhs2 * s1) / det, (c1 * rhs2 - c2 * rhs1) / det)

    lines = [(-math.pi / 2 + k * (math.pi / 6.0), (d, 0.0)) for k in range(7)] + [
        (math.pi / 2 + k * (math.pi / 6.0), (0.0, 0.0)) for k in range(7)
    ]
    local = [
        inter(lines[i][0], lines[i][1], lines[(i + 1) % len(lines)][0], lines[(i + 1) % len(lines)][1])
        for i in range(len(lines))
        if abs(math.sin(lines[i][0] - lines[(i + 1) % len(lines)][0])) >= 1e-6
    ]
    return [(ax + ux * lx + nx * ly, az + uz * lx + nz * ly) for lx, ly in local]


def clip_poly_halfplane(
    poly: list[tuple[float, float]], ax: float, az: float, bx: float, bz: float, keep_left: bool = True
) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    n = len(poly)
    if n == 0:
        return out
    vx, vz = bx - ax, bz - az

    def side(p: tuple[float, float]) -> float:
        c = vx * (p[1] - az) - vz * (p[0] - ax)
        return c if keep_left else -c

    for i in range(n):
        p1, p2 = poly[i], poly[(i + 1) % n]
        s1, s2 = side(p1), side(p2)
        in1, in2 = s1 >= -1e-7, s2 >= -1e-7
        if in1 and in2:
            out.append(p2)
        elif in1 and not in2:
            t = s1 / (s1 - s2 + 1e-18)
            out.append((p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])))
        elif not in1 and in2:
            t = s1 / (s1 - s2 + 1e-18)
            out.append((p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])))
            out.append(p2)
    res: list[tuple[float, float]] = []
    for p in out:
        if not res or math.hypot(p[0] - res[-1][0], p[1] - res[-1][1]) > 1e-4:
            res.append(p)
    if len(res) >= 2 and math.hypot(res[0][0] - res[-1][0], res[0][1] - res[-1][1]) < 1e-4:
        res.pop()
    return res if len(res) >= 3 else []


def subtract_convex(pieces: list[list[tuple[float, float]]], hole: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    out: list[list[tuple[float, float]]] = []
    n = len(hole)
    hx0 = min(p[0] for p in hole)
    hx1 = max(p[0] for p in hole)
    hz0 = min(p[1] for p in hole)
    hz1 = max(p[1] for p in hole)
    for piece in pieces:
        px0 = min(p[0] for p in piece)
        px1 = max(p[0] for p in piece)
        pz0 = min(p[1] for p in piece)
        pz1 = max(p[1] for p in piece)
        if px1 <= hx0 + 1e-5 or hx1 <= px0 + 1e-5 or pz1 <= hz0 + 1e-5 or hz1 <= pz0 + 1e-5:
            out.append(piece)
            continue
        rem = piece
        for i in range(n):
            ax, az = hole[i]
            bx, bz = hole[(i + 1) % n]
            outside = clip_poly_halfplane(rem, ax, az, bx, bz, keep_left=False)
            if outside and abs(poly_area(outside)) > 1e-3:
                out.append(outside)
            rem = clip_poly_halfplane(rem, ax, az, bx, bz, keep_left=True)
            if not rem or abs(poly_area(rem)) < 1e-3:
                break
    return out


def dissolve_raw(pieces: list[list[tuple[float, float]]]) -> list[tuple[float, list[tuple[float, float]]]]:
    if not pieces:
        return []

    def qk(p: tuple[float, float]) -> tuple[int, int]:
        return (round(p[0] * 100), round(p[1] * 100))

    raw_edges = [
        (poly[i], poly[(i + 1) % len(poly)])
        for poly in pieces
        if poly_area(poly) >= 0.02
        for i in range(len(poly))
        if qk(poly[i]) != qk(poly[(i + 1) % len(poly)])
    ]
    verts_map: dict[tuple[int, int], tuple[float, float]] = {}
    for a, b in raw_edges:
        verts_map.setdefault(qk(a), a)
        verts_map.setdefault(qk(b), b)
    all_verts = list(verts_map.values())
    split_edges: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for a, b in raw_edges:
        ax, az = a
        bx, bz = b
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz
        if l2 < 1e-8:
            continue
        t_pts = [(0.0, a), (1.0, b)]
        minx, maxx = min(ax, bx) - 0.02, max(ax, bx) + 0.02
        minz, maxz = min(az, bz) - 0.02, max(az, bz) + 0.02
        for v in all_verts:
            vx, vz = v
            if vx < minx or vx > maxx or vz < minz or vz > maxz or qk(v) == qk(a) or qk(v) == qk(b):
                continue
            t = ((vx - ax) * dx + (vz - az) * dz) / l2
            if 1e-4 < t < 1.0 - 1e-4 and (vx - (ax + t * dx)) ** 2 + (vz - (az + t * dz)) ** 2 < 1e-4:
                t_pts.append((t, verts_map[qk(v)]))
        t_pts.sort(key=lambda x: x[0])
        for i in range(len(t_pts) - 1):
            if qk(t_pts[i][1]) != qk(t_pts[i + 1][1]):
                split_edges.append((t_pts[i][1], t_pts[i + 1][1]))
    edge_counts: dict[tuple[tuple[int, int], tuple[int, int]], int] = defaultdict(int)
    pos_map: dict[tuple[int, int], tuple[float, float]] = {}
    for a, b in split_edges:
        ka, kb = qk(a), qk(b)
        pos_map[ka] = verts_map.get(ka, a)
        pos_map[kb] = verts_map.get(kb, b)
        if edge_counts[(kb, ka)] > 0:
            edge_counts[(kb, ka)] -= 1
        else:
            edge_counts[(ka, kb)] += 1
    out_adj: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for (ka, kb), cnt in edge_counts.items():
        for _ in range(cnt):
            out_adj[ka].append(kb)
    polys: list[tuple[float, list[tuple[float, float]]]] = []
    while out_adj:
        u0 = next(iter(out_adj))
        if not out_adj[u0]:
            del out_adj[u0]
            continue
        v0 = out_adj[u0].pop()
        if not out_adj[u0]:
            del out_adj[u0]
        ring = [u0, v0]
        prev, cur = u0, v0
        guard = 0
        while cur != u0 and guard < 20000:
            guard += 1
            nxt_list = out_adj.get(cur)
            if not nxt_list:
                break
            if len(nxt_list) == 1:
                nxt = nxt_list.pop()
            else:
                ax, az = pos_map[prev]
                bx, bz = pos_map[cur]
                in_ang = math.atan2(az - bz, ax - bx)

                def turn_ang(k: tuple[int, int]) -> float:
                    a = math.atan2(pos_map[k][1] - bz, pos_map[k][0] - bx) - in_ang
                    while a <= 0:
                        a += 2 * math.pi
                    return a

                nxt = nxt_list.pop(min(range(len(nxt_list)), key=lambda i: turn_ang(nxt_list[i])))
            if not out_adj[cur]:
                del out_adj[cur]
            if nxt == u0:
                break
            ring.append(nxt)
            prev, cur = cur, nxt
        poly = [pos_map[k] for k in ring]
        if len(poly) >= 3 and abs(poly_area(poly)) > 1.0:
            simp: list[tuple[float, float]] = []
            m = len(poly)
            for i in range(m):
                a, b, c = poly[i - 1], poly[i], poly[(i + 1) % m]
                dx, dz = c[0] - a[0], c[1] - a[1]
                l = math.hypot(dx, dz)
                if (abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / l if l > 1e-6 else 0.0) > 0.03:
                    simp.append(b)
            if len(simp) >= 3 and abs(poly_area(simp)) > 2.0:
                polys.append((poly_area(simp), simp))
    return polys


def dissolve_simple_ccw(pieces: list[list[tuple[float, float]]], axis_depth: int = 0) -> list[list[tuple[float, float]]]:
    """Dissolve convex CCW pieces into simple hole-free CCW polygons by recursively splitting if any negative hole forms."""
    if not pieces:
        return []
    res = dissolve_raw(pieces)
    if not any(a < 0 for a, _ in res) or axis_depth > 8:
        return [p for a, p in res if a > 2.0]
    # Split along longest bbox axis around piece centroid median to break closed holes
    xs = [p[0] for pc in pieces for p in pc]
    zs = [p[1] for pc in pieces for p in pc]
    split_x = (max(xs) - min(xs)) >= (max(zs) - min(zs))
    if axis_depth % 2 == 1:
        split_x = not split_x
    if split_x:
        m = 0.5 * (min(xs) + max(xs))
        left = [clip_poly_halfplane(p, m, -1e4, m, 1e4, True) for p in pieces]
        right = [clip_poly_halfplane(p, m, -1e4, m, 1e4, False) for p in pieces]
    else:
        m = 0.5 * (min(zs) + max(zs))
        left = [clip_poly_halfplane(p, 1e4, m, -1e4, m, True) for p in pieces]
        right = [clip_poly_halfplane(p, 1e4, m, -1e4, m, False) for p in pieces]
    left = [p for p in left if p and poly_area(p) > 0.2]
    right = [p for p in right if p and poly_area(p) > 0.2]
    return dissolve_simple_ccw(left, axis_depth + 1) + dissolve_simple_ccw(right, axis_depth + 1)


def obb_overlap(a: tuple[float, float, float, float, float], b: tuple[float, float, float, float, float]) -> bool:
    dx = b[0] - a[0]
    dz = b[1] - a[1]
    ra = math.hypot(a[2], a[3])
    rb = math.hypot(b[2], b[3])
    if dx * dx + dz * dz > (ra + rb) * (ra + rb):
        return False
    sa, ca = math.sin(a[4]), math.cos(a[4])
    sb, cb = math.sin(b[4]), math.cos(b[4])
    for axx, axz in [(sa, ca), (ca, -sa), (sb, cb), (cb, -sb)]:
        pa = a[3] * abs(sa * axx + ca * axz) + a[2] * abs(ca * axx - sa * axz)
        pb = b[3] * abs(sb * axx + cb * axz) + b[2] * abs(cb * axx - sb * axz)
        if pa + pb <= abs(dx * axx + dz * axz):
            return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--osm", default="/tmp/saddar_osm.xml")
    parser.add_argument("--out", default="src/sim/city/saddarData.ts")
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()

    if args.fetch or not os.path.exists(args.osm):
        print(f"Downloading OSM data to {args.osm}...")
        req = urllib.request.Request(DEFAULT_URL, headers={"User-Agent": "karachi-traffic-3d-osm2saddar/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        with open(args.osm, "wb") as f:
            f.write(data)

    tree = ET.parse(args.osm)
    root = tree.getroot()
    raw_nodes: dict[int, tuple[float, float, dict[str, str]]] = {}
    raw_ways: dict[int, tuple[list[int], dict[str, str]]] = {}
    for el in root:
        if el.tag == "node":
            tags = {t.attrib["k"]: t.attrib["v"] for t in el.findall("tag")}
            raw_nodes[int(el.attrib["id"])] = (float(el.attrib["lat"]), float(el.attrib["lon"]), tags)
        elif el.tag == "way":
            nds = [int(n.attrib["ref"]) for n in el.findall("nd")]
            tags = {t.attrib["k"]: t.attrib["v"] for t in el.findall("tag")}
            raw_ways[int(el.attrib["id"])] = (nds, tags)

    pts: dict[int, tuple[float, float]] = {}
    pt_map: dict[tuple[int, int], int] = {}

    def pid(x: float, z: float) -> int:
        k = (round(x * 10), round(z * 10))
        if k not in pt_map:
            idx = len(pts)
            pt_map[k] = idx
            pts[idx] = (k[0] / 10.0, k[1] / 10.0)
        return pt_map[k]

    edges: dict[tuple[int, int], dict[str, object]] = {}

    def add_dir_edge(u: int, v: int, info: dict[str, object]) -> None:
        if u == v:
            return
        if (u, v) in edges:
            old = edges[(u, v)]
            rank = {"arterial": 2, "main": 1, "side": 0}
            if rank[str(info["cls"])] > rank[str(old["cls"])]:
                edges[(u, v)] = dict(info)
        else:
            edges[(u, v)] = dict(info)

    for _wid, (nds, tags) in raw_ways.items():
        hw = tags.get("highway")
        if hw not in DRIVABLE or tags.get("layer") in ("1", "-1") or tags.get("access") == "no":
            continue
        is_ra = tags.get("junction") == "roundabout"
        ow_tag = tags.get("oneway")
        oneway = is_ra or ow_tag in ("yes", "1", "true", "-1")
        cls = road_cls(hw)
        ln, lw = link_spec(hw, tags, cls, oneway)
        name = tags.get("name:en") or tags.get("name") or ("Roundabout" if is_ra else "")
        info: dict[str, object] = {
            "cls": cls,
            "ln": ln,
            "lw": lw,
            "oneway": oneway,
            "ra": is_ra,
            "name": name,
            "turn": False,
        }
        for i in range(len(nds) - 1):
            a, b = nds[i], nds[i + 1]
            if a not in raw_nodes or b not in raw_nodes:
                continue
            ax, az = proj(raw_nodes[a][0], raw_nodes[a][1])
            bx, bz = proj(raw_nodes[b][0], raw_nodes[b][1])
            c = clip_seg(ax, az, bx, bz)
            if not c:
                continue
            u, v = pid(c[0], c[1]), pid(c[2], c[3])
            if u == v:
                continue
            if ow_tag == "-1":
                add_dir_edge(v, u, info)
            else:
                add_dir_edge(u, v, info)
                if not oneway:
                    add_dir_edge(v, u, info)

    # Border turnaround links so dead ends near the clip boundary loop back seamlessly
    adj_out: dict[int, list[int]] = defaultdict(list)
    adj_in: dict[int, list[int]] = defaultdict(list)
    for u, v in edges:
        adj_out[u].append(v)
        adj_in[v].append(u)
    out0 = [u for u in pts if len(adj_in[u]) > 0 and len(adj_out[u]) == 0]
    in0 = [v for v in pts if len(adj_out[v]) > 0 and len(adj_in[v]) == 0]
    undir_list = [(min(u, v), max(u, v)) for u, v in edges]
    cand = sorted(
        (math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]), u, v)
        for u in out0
        for v in in0
        if u != v and 1.0 < math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]) < 35.0
    )
    used_u, used_v = set(), set()
    for _d, u, v in cand:
        if u in used_u or v in used_v or (u, v) in edges or (v, u) in edges:
            continue
        a, b = pts[u], pts[v]
        if any(u != p and u != q and v != p and v != q and seg_cross(a, b, pts[p], pts[q]) for p, q in undir_list):
            continue
        add_dir_edge(
            u,
            v,
            {"cls": "side", "ln": 1, "lw": 3.5, "oneway": True, "ra": False, "name": "", "turn": True},
        )
        undir_list.append((min(u, v), max(u, v)))
        used_u.add(u)
        used_v.add(v)

    # Tarjan SCC -> keep single largest strongly connected component
    index_cnt = 0
    indices: dict[int, int] = {}
    lowlink: dict[int, int] = {}
    onstack: set[int] = set()
    stack: list[int] = []
    sccs: list[list[int]] = []
    out_adj: dict[int, list[int]] = defaultdict(list)
    for u, v in edges:
        out_adj[u].append(v)

    def strongconnect(v: int) -> None:
        nonlocal index_cnt
        indices[v] = lowlink[v] = index_cnt
        index_cnt += 1
        stack.append(v)
        onstack.add(v)
        for w in out_adj[v]:
            if w not in indices:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in onstack:
                lowlink[v] = min(lowlink[v], indices[w])
        if lowlink[v] == indices[v]:
            scc: list[int] = []
            while True:
                w = stack.pop()
                onstack.remove(w)
                scc.append(w)
                if w == v:
                    break
            sccs.append(scc)

    for v in list(out_adj.keys()):
        if v not in indices:
            strongconnect(v)
    sccs.sort(key=len, reverse=True)
    scc0 = set(sccs[0])
    edges = {k: v for k, v in edges.items() if k[0] in scc0 and k[1] in scc0}

    # Verify strongly connected & zero crossings before simplification
    undir_edges: dict[tuple[int, int], list[tuple[int, int, dict[str, object]]]] = defaultdict(list)
    for (u, v), info in edges.items():
        undir_edges[(min(u, v), max(u, v))].append((u, v, info))

    def edge_sig(key: tuple[int, int]) -> tuple[object, ...]:
        return tuple(
            sorted(
                (u == key[0], info["cls"], info["ln"], info["lw"], info["oneway"], info["ra"], info["name"], info["turn"])
                for u, v, info in undir_edges[key]
            )
        )

    deg_undir: dict[int, set[int]] = defaultdict(set)
    for lo, hi in undir_edges:
        deg_undir[lo].add(hi)
        deg_undir[hi].add(lo)

    visited_u: set[tuple[int, int]] = set()
    chains: list[tuple[list[int], list[tuple[int, int, dict[str, object]]]]] = []
    for lo, hi in list(undir_edges.keys()):
        if (lo, hi) in visited_u:
            continue
        sig = edge_sig((lo, hi))
        chain = [lo, hi]
        visited_u.add((lo, hi))
        while len(deg_undir[chain[-1]]) == 2:
            cur, prev = chain[-1], chain[-2]
            nxt = [x for x in deg_undir[cur] if x != prev][0]
            ek = (min(cur, nxt), max(cur, nxt))
            if ek in visited_u or edge_sig(ek) != sig or nxt == chain[0]:
                break
            visited_u.add(ek)
            chain.append(nxt)
        while len(deg_undir[chain[0]]) == 2:
            cur, nxt = chain[0], chain[1]
            prv = [x for x in deg_undir[cur] if x != nxt][0]
            ek = (min(cur, prv), max(cur, prv))
            if ek in visited_u or edge_sig(ek) != sig or prv == chain[-1]:
                break
            visited_u.add(ek)
            chain.insert(0, prv)
        chains.append((chain, undir_edges[(lo, hi)]))

    def dp_simplify(coords: list[tuple[float, float]], eps: float) -> list[int]:
        if len(coords) <= 2:
            return [0, len(coords) - 1]
        ax, az = coords[0]
        bx, bz = coords[-1]
        dx, dz = bx - ax, bz - az
        len2 = dx * dx + dz * dz
        best_d, best_i = -1.0, -1
        for i in range(1, len(coords) - 1):
            px, pz = coords[i]
            d = math.hypot(px - ax, pz - az) if len2 < 1e-12 else abs((px - ax) * dz - (pz - az) * dx) / math.sqrt(len2)
            if d > best_d:
                best_d, best_i = d, i
        if best_d > eps:
            l = dp_simplify(coords[: best_i + 1], eps)
            r = dp_simplify(coords[best_i:], eps)
            return l[:-1] + [best_i + k for k in r]
        return [0, len(coords) - 1]

    new_edges: dict[tuple[int, int], dict[str, object]] = {}
    for chain, sample_dirs in chains:
        eps = 0.9 if any(info["ra"] for _, _, info in sample_dirs) else 3.0
        keep = dp_simplify([pts[u] for u in chain], eps)
        kpts = [chain[i] for i in keep]
        a0, a1 = chain[0], chain[1]
        for su, sv, sinfo in sample_dirs:
            seq = kpts if (su == a0 and sv == a1) else list(reversed(kpts))
            for i in range(len(seq) - 1):
                new_edges[(seq[i], seq[i + 1])] = dict(sinfo)

    used_nids = sorted({u for e in new_edges for u in e})
    nid_remap = {old: i for i, old in enumerate(used_nids)}
    npts = [pts[old] for old in used_nids]
    links_raw = [(nid_remap[u], nid_remap[v], info) for (u, v), info in sorted(new_edges.items())]

    # Verify planarity (0 crossings)
    undir_segs = list({(min(u, v), max(u, v)) for u, v, _ in links_raw})
    for i in range(len(undir_segs)):
        u, v = undir_segs[i]
        for j in range(i + 1, len(undir_segs)):
            p, q = undir_segs[j]
            if u in (p, q) or v in (p, q):
                continue
            if seg_cross(npts[u], npts[v], npts[p], npts[q]):
                raise RuntimeError(f"Non-planar crossing between ({u},{v}) and ({p},{q})")

    # Compute undirected road segment widths & roundabout flags
    undir_hw: dict[tuple[int, int], float] = {}
    undir_cls: dict[tuple[int, int], str] = {}
    ra_nodes: set[int] = set()
    for u, v, info in links_raw:
        if info["ra"]:
            ra_nodes.add(u)
            ra_nodes.add(v)
        k = (min(u, v), max(u, v))
        ln = int(info["ln"])
        lw = float(info["lw"])
        hw = (ln * lw) / 2.0 if info["oneway"] else ln * lw
        if hw > undir_hw.get(k, 0.0):
            undir_hw[k] = hw
            undir_cls[k] = str(info["cls"])

    # Planar half-edge face extraction
    nbrs: dict[int, list[int]] = defaultdict(list)
    for u, v in undir_hw:
        nbrs[u].append(v)
        nbrs[v].append(u)
    for u in nbrs:
        nbrs[u].sort(key=lambda v: math.atan2(npts[v][1] - npts[u][1], npts[v][0] - npts[u][0]))
    pos_in = {v: {u: i for i, u in enumerate(nbrs[v])} for v in nbrs}

    visited_he: set[tuple[int, int]] = set()
    faces: list[tuple[float, list[int]]] = []
    for u, v in undir_hw:
        for su, sv in [(u, v), (v, u)]:
            if (su, sv) in visited_he:
                continue
            face: list[int] = []
            cu, cv = su, sv
            while (cu, cv) not in visited_he:
                visited_he.add((cu, cv))
                face.append(cu)
                lst = nbrs[cv]
                cu, cv = cv, lst[(pos_in[cv][cu] - 1) % len(lst)]
            area = (
                sum(
                    npts[face[i]][0] * npts[face[(i + 1) % len(face)]][1]
                    - npts[face[(i + 1) % len(face)]][0] * npts[face[i]][1]
                    for i in range(len(face))
                )
                * 0.5
            )
            faces.append((area, face))

    assert len(npts) - len(undir_hw) + len(faces) == 2, f"Euler mismatch: V={len(npts)} E={len(undir_hw)} F={len(faces)}"

    # Capsules for roads (pavement trim) and sidewalks (building lot trim)
    road_caps = []
    lot_caps = []
    road_segs = []
    for (u, v), hw in sorted(undir_hw.items()):
        ax, az = npts[u]
        bx, bz = npts[v]
        rc = make_capsule_tangent(ax, az, bx, bz, hw)
        lc = make_capsule_tangent(ax, az, bx, bz, hw + SIDEWALK)
        rxs = [p[0] for p in rc]
        rzs = [p[1] for p in rc]
        lxs = [p[0] for p in lc]
        lzs = [p[1] for p in lc]
        road_caps.append((min(rxs), min(rzs), max(rxs), max(rzs), rc, hw, ax, az, bx, bz))
        lot_caps.append((min(lxs), min(lzs), max(lxs), max(lzs), lc))
        road_segs.append((u, v, round(hw, 2), ax, az, bx, bz, undir_cls[(u, v)]))

    r_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    l_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    s_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(road_caps):
        for gx in range(int(math.floor(c[0] / 50)), int(math.floor(c[2] / 50)) + 1):
            for gz in range(int(math.floor(c[1] / 50)), int(math.floor(c[3] / 50)) + 1):
                r_grid[(gx, gz)].append(i)
    for i, c in enumerate(lot_caps):
        for gx in range(int(math.floor(c[0] / 50)), int(math.floor(c[2] / 50)) + 1):
            for gz in range(int(math.floor(c[1] / 50)), int(math.floor(c[3] / 50)) + 1):
                l_grid[(gx, gz)].append(i)
    for i, (_u, _v, hw, ax, az, bx, bz, _cls) in enumerate(road_segs):
        pad = hw + SIDEWALK + 25.0
        for gx in range(int(math.floor((min(ax, bx) - pad) / 50)), int(math.floor((max(ax, bx) + pad) / 50)) + 1):
            for gz in range(int(math.floor((min(az, bz) - pad) / 50)), int(math.floor((max(az, bz) + pad) / 50)) + 1):
                s_grid[(gx, gz)].append(i)

    # Roundabout islands
    islands: list[tuple[float, float, float, int]] = []
    ra_targets = [(-188.7, -749.8, 3000.0, 1), (-845.8, -813.3, 2000.0, 0)]
    island_faces: set[int] = set()
    ccw_faces_all = [(i, a, strip_spurs(f)) for i, (a, f) in enumerate(faces) if a > 1.0]

    for idx_f, a, f in ccw_faces_all:
        poly = [npts[k] for k in f]
        cx = sum(p[0] for p in poly) / len(poly)
        cz = sum(p[1] for p in poly) / len(poly)
        for tx, tz, max_a, mon in ra_targets:
            if math.hypot(cx - tx, cz - tz) < 25.0 and a < max_a and pt_in_poly(tx, tz, poly):
                island_faces.add(idx_f)
                best_clear = min(
                    math.sqrt(pt_to_seg_dist2(tx, tz, ax, az, bx, bz)) - hw
                    for _u, _v, hw, ax, az, bx, bz, _c in road_segs
                )
                r_isl = round(max(4.5, min(15.5, best_clear - 0.6)), 1)
                islands.append((round(tx, 1), round(tz, 1), r_isl, mon))

    # Extract inner pavement slabs and lot polygons
    slabs_out: list[tuple[int, list[tuple[float, float]], list[int]]] = []
    inner_lots: list[tuple[float, list[tuple[float, float]], bool]] = []
    ccw_tris = []

    park_faces: set[int] = set()
    empress_faces: set[int] = set()
    for idx_f, a, f in ccw_faces_all:
        poly = [npts[k] for k in f]
        for tri in ear_clip_ccw(poly):
            txs = [p[0] for p in tri]
            tzs = [p[1] for p in tri]
            ccw_tris.append((min(txs), min(tzs), max(txs), max(tzs), tri))
        if idx_f in island_faces:
            continue
        is_park = pt_in_poly(-252.0, 148.0, poly)
        is_empress = pt_in_poly(EMPRESS["x"], EMPRESS["z"], poly)
        if is_park:
            park_faces.add(idx_f)
        if is_empress:
            empress_faces.add(idx_f)

        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        fx0, fx1, fz0, fz1 = min(xs), max(xs), min(zs), max(zs)
        tris = ear_clip_ccw(poly)
        near_r: set[int] = set()
        near_l: set[int] = set()
        for gx in range(int(math.floor(fx0 / 50)), int(math.floor(fx1 / 50)) + 1):
            for gz in range(int(math.floor(fz0 / 50)), int(math.floor(fz1 / 50)) + 1):
                near_r.update(r_grid[(gx, gz)])
                near_l.update(l_grid[(gx, gz)])

        # 1. Exact pavement slab
        pave_pieces = list(tris)
        for ri in near_r:
            rc = road_caps[ri]
            if fx1 <= rc[0] or rc[2] <= fx0 or fz1 <= rc[1] or rc[3] <= fz0:
                continue
            pave_pieces = subtract_convex(pave_pieces, rc[4])
            if not pave_pieces:
                break
        for dp in dissolve_simple_ccw(pave_pieces):
            verts, idxs = ear_clip_indexed(dp)
            if idxs:
                slabs_out.append((1 if is_park else 0, verts, idxs))

        # 2. Lot polygons (unless Jehangir Park)
        if not is_park:
            lot_pieces = list(tris)
            for li in near_l:
                lc = lot_caps[li]
                if fx1 <= lc[0] or lc[2] <= fx0 or fz1 <= lc[1] or lc[3] <= fz0:
                    continue
                lot_pieces = subtract_convex(lot_pieces, lc[4])
                if not lot_pieces:
                    break
            for dp in dissolve_simple_ccw(lot_pieces):
                da = poly_area(dp)
                if da > 30.0:
                    inner_lots.append((da, dp, is_empress))

    # Pick up to 2 construction yards inside central / eastern non-park lots
    yards_obb: list[tuple[float, float, float, float, float]] = []
    yard_lot_idxs: set[int] = set()

    def try_fit_yard(lp: list[tuple[float, float]]) -> tuple[float, float, float, float, float] | None:
        lxs = [p[0] for p in lp]
        lzs = [p[1] for p in lp]
        cx, cz = sum(lxs) / len(lxs), sum(lzs) / len(lzs)
        longest = max(range(len(lp)), key=lambda i: math.hypot(lp[(i + 1) % len(lp)][0] - lp[i][0], lp[(i + 1) % len(lp)][1] - lp[i][1]))
        p0, p1 = lp[longest], lp[(longest + 1) % len(lp)]
        h = math.atan2(p1[0] - p0[0], p1[1] - p0[1])
        s, c = math.sin(h), math.cos(h)
        for hl in (28.0, 22.0, 18.0):
            for hw in (24.0, 20.0, 16.0):
                ok = True
                for lf in (-hl - 1.0, 0.0, hl + 1.0):
                    for lr in (-hw - 1.0, 0.0, hw + 1.0):
                        if not pt_in_poly(cx + lf * s + lr * c, cz + lf * c - lr * s, lp):
                            ok = False
                            break
                    if not ok:
                        break
                if ok:
                    return (round(cx, 1), round(cz, 1), hw, hl, round(h, 3))
        return None

    # First yard near central Saddar; second on east side
    for zone_pred in (lambda cx, cz: math.hypot(cx, cz) < 550, lambda cx, cz: cx > 200 and abs(cz) < 500):
        for li, (da, lp, is_em) in enumerate(inner_lots):
            if li in yard_lot_idxs or is_em or da < 2200 or da > 12000:
                continue
            lxs = [p[0] for p in lp]
            lzs = [p[1] for p in lp]
            cx, cz = sum(lxs) / len(lxs), sum(lzs) / len(lzs)
            if not zone_pred(cx, cz):
                continue
            fit = try_fit_yard(lp)
            if fit:
                yards_obb.append(fit)
                yard_lot_idxs.add(li)
                break

    # Outer rim pavement slabs & outer rim lots
    tri_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, t in enumerate(ccw_tris):
        for gx in range(int(math.floor(t[0] / 100)), int(math.floor(t[2] / 100)) + 1):
            for gz in range(int(math.floor(t[1] / 100)), int(math.floor(t[3] / 100)) + 1):
                tri_grid[(gx, gz)].append(i)
    r100_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    l100_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, c in enumerate(road_caps):
        for gx in range(int(math.floor(c[0] / 100)), int(math.floor(c[2] / 100)) + 1):
            for gz in range(int(math.floor(c[1] / 100)), int(math.floor(c[3] / 100)) + 1):
                r100_grid[(gx, gz)].append(i)
    for i, c in enumerate(lot_caps):
        for gx in range(int(math.floor(c[0] / 100)), int(math.floor(c[2] / 100)) + 1):
            for gz in range(int(math.floor(c[1] / 100)), int(math.floor(c[3] / 100)) + 1):
                l100_grid[(gx, gz)].append(i)

    OX0, OZ0, OX1, OZ1 = XMIN - OUTER_DEPTH, ZMIN - OUTER_DEPTH, XMAX + OUTER_DEPTH, ZMAX + OUTER_DEPTH
    NX, NZ = 10, 8
    dx_t, dz_t = (OX1 - OX0) / NX, (OZ1 - OZ0) / NZ
    outer_lots: list[tuple[float, list[tuple[float, float]]]] = []
    for ix in range(NX):
        for iz in range(NZ):
            tx0, tx1 = OX0 + ix * dx_t, OX0 + (ix + 1) * dx_t
            tz0, tz1 = OZ0 + iz * dz_t, OZ0 + (iz + 1) * dz_t
            base_rect = [[(tx0, tz0), (tx1, tz0), (tx1, tz1), (tx0, tz1)]]
            near_t: set[int] = set()
            near_r: set[int] = set()
            near_l: set[int] = set()
            for gx in range(int(math.floor(tx0 / 100)), int(math.floor(tx1 / 100)) + 1):
                for gz in range(int(math.floor(tz0 / 100)), int(math.floor(tz1 / 100)) + 1):
                    near_t.update(tri_grid[(gx, gz)])
                    near_r.update(r100_grid[(gx, gz)])
                    near_l.update(l100_grid[(gx, gz)])
            after_tri = base_rect
            for ti in near_t:
                tt = ccw_tris[ti]
                if tx1 <= tt[0] or tt[2] <= tx0 or tz1 <= tt[1] or tt[3] <= tz0:
                    continue
                after_tri = subtract_convex(after_tri, tt[4])
                if not after_tri:
                    break
            if not after_tri:
                continue

            # Outer pavement slab
            pave_p = list(after_tri)
            for ri in near_r:
                rc = road_caps[ri]
                if tx1 <= rc[0] or rc[2] <= tx0 or tz1 <= rc[1] or rc[3] <= tz0:
                    continue
                pave_p = subtract_convex(pave_p, rc[4])
                if not pave_p:
                    break
            for dp in dissolve_simple_ccw(pave_p):
                verts, idxs = ear_clip_indexed(dp)
                if idxs:
                    slabs_out.append((0, verts, idxs))

            # Outer building lot
            lot_p = list(after_tri)
            for li in near_l:
                lc = lot_caps[li]
                if tx1 <= lc[0] or lc[2] <= tx0 or tz1 <= lc[1] or lc[3] <= tz0:
                    continue
                lot_p = subtract_convex(lot_p, lc[4])
                if not lot_p:
                    break
            for dp in dissolve_simple_ccw(lot_p):
                da = poly_area(dp)
                if da > 60.0:
                    outer_lots.append((da, dp))

    # Verify zero road intrusions on ALL slabs
    for _kind, verts, _idxs in slabs_out:
        for px, pz in verts:
            for ri in r_grid[(int(math.floor(px / 50)), int(math.floor(pz / 50)))]:
                _, _, _, _, _, hw, ax, az, bx, bz = road_caps[ri]
                if pt_to_seg_dist2(px, pz, ax, az, bx, bz) < (hw - 0.05) ** 2:
                    raise RuntimeError(f"Slab vertex ({px},{pz}) intruded road capsule!")

    # Place oriented buildings cleanly across inner lots & outer rim lots
    rng = random.Random(0x5ADD4B)
    buildings: list[tuple[float, float, float, float, float, int]] = []
    b_grid: dict[tuple[int, int], list[int]] = defaultdict(list)

    def near_arterial(x: float, z: float) -> bool:
        for si in s_grid[(int(math.floor(x / 50)), int(math.floor(z / 50)))]:
            _, _, hw, ax, az, bx, bz, cls = road_segs[si]
            if cls == "arterial" and pt_to_seg_dist2(x, z, ax, az, bx, bz) < (hw + 22.0) ** 2:
                return True
        return False

    def road_ok(cx: float, cz: float, hw: float, hl: float, h: float) -> bool:
        s, c = math.sin(h), math.cos(h)
        r = math.hypot(hw, hl)
        pad_s: set[int] = set()
        for gx in range(int(math.floor((cx - r) / 50)), int(math.floor((cx + r) / 50)) + 1):
            for gz in range(int(math.floor((cz - r) / 50)), int(math.floor((cz + r) / 50)) + 1):
                pad_s.update(s_grid[(gx, gz)])
        for lf in (-hl, 0.0, hl):
            for lr in (-hw, 0.0, hw):
                px = cx + lf * s + lr * c
                pz = cz + lf * c - lr * s
                for si in pad_s:
                    _, _, rhw, ax, az, bx, bz, _ = road_segs[si]
                    if pt_to_seg_dist2(px, pz, ax, az, bx, bz) < (rhw + 3.1) ** 2:
                        return False
        return True

    # Open plaza zone in front/around Empress Market (right = outward facade facing SE toward Shahrah-e-Liaquat)
    em_plaza = (
        EMPRESS["x"] + 16.0 * math.cos(EMPRESS["heading"]),
        EMPRESS["z"] - 16.0 * math.sin(EMPRESS["heading"]),
        EMPRESS["hw"] + 28.0,
        EMPRESS["hl"] + 12.0,
        EMPRESS["heading"],
    )
    em_hall = (EMPRESS["x"], EMPRESS["z"], EMPRESS["hw"] + 6.0, EMPRESS["hl"] + 6.0, EMPRESS["heading"])

    def can_place(lp: list[tuple[float, float]], obb: tuple[float, float, float, float, float], is_em: bool) -> bool:
        cx, cz, hw, hl, h = obb
        if cx - hw < OX0 + 2 or cx + hw > OX1 - 2 or cz - hl < OZ0 + 2 or cz + hl > OZ1 - 2:
            # Test corner bounds safely instead of axis bounds
            pass
        s, c = math.sin(h), math.cos(h)
        for lf in (-hl, 0.0, hl):
            for lr in (-hw, 0.0, hw):
                px = cx + lf * s + lr * c
                pz = cz + lf * c - lr * s
                if px < OX0 + 1.5 or px > OX1 - 1.5 or pz < OZ0 + 1.5 or pz > OZ1 - 1.5:
                    return False
                if not pt_in_poly(px, pz, lp):
                    return False
        if is_em and (obb_overlap(obb, em_hall) or obb_overlap(obb, em_plaza)):
            return False
        for yx, yz, yhw, yhl, yh in yards_obb:
            if obb_overlap(obb, (yx, yz, yhw + 2.0, yhl + 2.0, yh)):
                return False
        for ix, iz, ir, _ in islands:
            if math.hypot(cx - ix, cz - iz) < ir + math.hypot(hw, hl) + 1.0:
                return False
        if not road_ok(cx, cz, hw, hl, h):
            return False
        r = math.hypot(hw, hl) + 1.0
        seen_b: set[int] = set()
        for gx in range(int(math.floor((cx - r) / 50)), int(math.floor((cx + r) / 50)) + 1):
            for gz in range(int(math.floor((cz - r) / 50)), int(math.floor((cz + r) / 50)) + 1):
                for bi in b_grid[(gx, gz)]:
                    if bi in seen_b:
                        continue
                    seen_b.add(bi)
                    b = buildings[bi]
                    if obb_overlap((cx, cz, hw + 0.15, hl + 0.15, h), (b[0], b[1], b[2] + 0.15, b[3] + 0.15, b[4])):
                        return False
        return True

    def add_b(cx: float, cz: float, hw: float, hl: float, h: float, outer: bool = False) -> None:
        art = near_arterial(cx, cz)
        st = rng.randint(3, 8) if art else (rng.randint(3, 6) if outer else rng.randint(2, 6))
        bi = len(buildings)
        buildings.append((round(cx, 1), round(cz, 1), round(hw, 1), round(hl, 1), round(h, 3), st))
        r = math.hypot(hw, hl) + 1.0
        for gx in range(int(math.floor((cx - r) / 50)), int(math.floor((cx + r) / 50)) + 1):
            for gz in range(int(math.floor((cz - r) / 50)), int(math.floor((cz + r) / 50)) + 1):
                b_grid[(gx, gz)].append(bi)

    def populate_lot(lp: list[tuple[float, float]], da: float, is_em: bool, outer: bool) -> None:
        n = len(lp)
        for i in range(n):
            p0, p1 = lp[i], lp[(i + 1) % n]
            ex, ez = p1[0] - p0[0], p1[1] - p0[1]
            L = math.hypot(ex, ez)
            if L < 10.0:
                continue
            # On outer lots skip the perimeter map-edge walls themselves (keep street-facing edges!)
            mx, mz = 0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1])
            if outer and (abs(mx - OX0) < 0.5 or abs(mx - OX1) < 0.5 or abs(mz - OZ0) < 0.5 or abs(mz - OZ1) < 0.5):
                continue
            if outer:
                # Also skip artificial tile grid cut boundaries not near any road!
                near_any = False
                for si in s_grid[(int(math.floor(mx / 50)), int(math.floor(mz / 50)))]:
                    _, _, rhw, ax, az, bx, bz, _ = road_segs[si]
                    if pt_to_seg_dist2(mx, mz, ax, az, bx, bz) < (rhw + 18.0) ** 2:
                        near_any = True
                        break
                if not near_any:
                    continue
            ux, uz = ex / L, ez / L
            nx, nz = -uz, ux
            h = math.atan2(ux, uz)
            p = 0.8
            while p < L - 8.5:
                bw = rng.uniform(16.0, 26.0)
                if L - p - bw < 8.5:
                    bw = L - p - 0.8
                if bw < 7.5:
                    break
                bd = rng.uniform(11.0, 16.0)
                cx = p0[0] + ux * (p + bw * 0.5) + nx * (bd * 0.5 + 0.4)
                cz = p0[1] + uz * (p + bw * 0.5) + nz * (bd * 0.5 + 0.4)
                if can_place(lp, (cx, cz, bd * 0.5, bw * 0.5, h), is_em):
                    add_b(cx, cz, bd * 0.5, bw * 0.5, h, outer)
                elif can_place(lp, (p0[0] + ux * (p + bw * 0.5) + nx * 4.9, p0[1] + uz * (p + bw * 0.5) + nz * 4.9, 4.5, bw * 0.5, h), is_em):
                    add_b(p0[0] + ux * (p + bw * 0.5) + nx * 4.9, p0[1] + uz * (p + bw * 0.5) + nz * 4.9, 4.5, bw * 0.5, h, outer)
                gap = rng.uniform(3.8, 5.2) if (not outer and rng.random() < 0.14) else 0.7
                p += bw + gap
        # Interior courtyard blocks on large inner lots
        if not outer and da > 2200 and not is_em:
            longest = max(range(n), key=lambda i: math.hypot(lp[(i + 1) % n][0] - lp[i][0], lp[(i + 1) % n][1] - lp[i][1]))
            p0, p1 = lp[longest], lp[(longest + 1) % n]
            h = math.atan2(p1[0] - p0[0], p1[1] - p0[1])
            s, c = math.sin(h), math.cos(h)
            fs = [pt[0] * s + pt[1] * c for pt in lp]
            rs = [pt[0] * c - pt[1] * s for pt in lp]
            rf = min(rs) + 22.0
            while rf < max(rs) - 20.0:
                ff = min(fs) + 22.0
                while ff < max(fs) - 20.0:
                    hw = rng.uniform(8.0, 12.0)
                    hl = rng.uniform(11.0, 16.0)
                    cx = ff * s + rf * c
                    cz = ff * c - rf * s
                    if can_place(lp, (cx, cz, hw, hl, h), is_em):
                        add_b(cx, cz, hw, hl, h, False)
                    ff += hl * 2 + rng.uniform(3.5, 6.5)
                rf += rng.uniform(19.0, 26.0)

    for li, (da, lp, is_em) in enumerate(inner_lots):
        if li in yard_lot_idxs:
            continue
        populate_lot(lp, da, is_em, False)
    for da, lp in outer_lots:
        populate_lot(lp, da, False, True)

    # Final OBB overlap safety check across all buildings
    for i in range(len(buildings)):
        bi = buildings[i]
        r = math.hypot(bi[2], bi[3]) + 1.0
        for gx in range(int(math.floor((bi[0] - r) / 50)), int(math.floor((bi[0] + r) / 50)) + 1):
            for gz in range(int(math.floor((bi[1] - r) / 50)), int(math.floor((bi[1] + r) / 50)) + 1):
                for j in b_grid[(gx, gz)]:
                    if j <= i:
                        continue
                    bj = buildings[j]
                    if obb_overlap((bi[0], bi[1], bi[2], bi[3], bi[4]), (bj[0], bj[1], bj[2], bj[3], bj[4])):
                        raise RuntimeError(f"Building overlap {i} and {j}")

    # Emit compact TypeScript module
    cls_code = {"arterial": 0, "main": 1, "side": 2}
    lines: list[str] = []
    lines.append("/**")
    lines.append(" * Baked Real Saddar (Karachi) road graph, block pavements, landmarks,")
    lines.append(" * buildings and POIs converted from OpenStreetMap via tools/osm2saddar.py.")
    lines.append(" *")
    lines.append(" * Map data © OpenStreetMap contributors (ODbL 1.0).")
    lines.append(" * BBox: 67.0205, 24.8525, 67.0395, 24.8675 (origin near Empress Market).")
    lines.append(" * Regenerate with: python3 tools/osm2saddar.py")
    lines.append(" */")
    lines.append("")
    lines.append(
        f"export const SADDAR_BOUNDS = {{ x0: {OX0:.1f}, z0: {OZ0:.1f}, x1: {OX1:.1f}, z1: {OZ1:.1f} }} as const;"
    )
    lines.append("")
    lines.append("/** [x, z, roundabout: 0|1] */")
    lines.append("export const SADDAR_NODES: ReadonlyArray<readonly [number, number, 0 | 1]> = [")
    for i, (x, z) in enumerate(npts):
        lines.append(f"  [{x:.1f}, {z:.1f}, {1 if i in ra_nodes else 0}],")
    lines.append("];")
    lines.append("")
    lines.append("/** [from, to, cls(0=arterial,1=main,2=side), lanes, laneW, oneway, turnaround, name] */")
    lines.append(
        "export const SADDAR_LINKS: ReadonlyArray<readonly [number, number, 0 | 1 | 2, number, number, 0 | 1, 0 | 1, string]> = ["
    )
    for u, v, info in links_raw:
        c = cls_code[str(info["cls"])]
        ln = int(info["ln"])
        lw = float(info["lw"])
        ow = 1 if info["oneway"] else 0
        tr = 1 if info["turn"] else 0
        nm = str(info["name"]).replace("\\", "\\\\").replace("'", "\\'")
        lines.append(f"  [{u}, {v}, {c}, {ln}, {lw:.1f}, {ow}, {tr}, '{nm}'],")
    lines.append("];")
    lines.append("")
    lines.append("/** Undirected road strips [nodeU, nodeV, halfWidth] */")
    lines.append("export const SADDAR_SEGS: ReadonlyArray<readonly [number, number, number]> = [")
    for (u, v), hw in sorted(undir_hw.items()):
        lines.append(f"  [{u}, {v}, {hw:.2f}],")
    lines.append("];")
    lines.append("")
    lines.append("/** Roundabout central islands [x, z, r, monumental: 0|1] */")
    lines.append("export const SADDAR_ISLANDS: ReadonlyArray<readonly [number, number, number, 0 | 1]> = [")
    for ix, iz, ir, mon in islands:
        lines.append(f"  [{ix:.1f}, {iz:.1f}, {ir:.1f}, {mon}],")
    lines.append("];")
    lines.append("")
    lines.append("export const SADDAR_EMPRESS = {")
    lines.append(
        f"  x: {EMPRESS['x']:.1f}, z: {EMPRESS['z']:.1f}, hw: {EMPRESS['hw']:.1f}, hl: {EMPRESS['hl']:.1f}, heading: {EMPRESS['heading']:.3f},"
    )
    lines.append("} as const;")
    lines.append("")
    lines.append("/** Oriented dirt construction yards [x, z, hw, hl, heading] */")
    lines.append("export const SADDAR_YARDS: ReadonlyArray<readonly [number, number, number, number, number]> = [")
    for yx, yz, yhw, yhl, yh in yards_obb:
        lines.append(f"  [{yx:.1f}, {yz:.1f}, {yhw:.1f}, {yhl:.1f}, {yh:.3f}],")
    lines.append("];")
    lines.append("")
    lines.append("/** Ear-clipped pavement slabs: [kind(0=pave,1=park), flatXY, flatTris] */")
    lines.append("export const SADDAR_SLABS: ReadonlyArray<readonly [0 | 1, readonly number[], readonly number[]]> = [")
    for kind, verts, idxs in slabs_out:
        p_str = ",".join(f"{v[0]:.1f},{v[1]:.1f}" for v in verts)
        t_str = ",".join(str(k) for k in idxs)
        lines.append(f"  [{kind}, [{p_str}], [{t_str}]],")
    lines.append("];")
    lines.append("")
    lines.append("/** Oriented buildings [x, z, hw, hl, heading, storeys] */")
    lines.append("export const SADDAR_BUILDINGS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [")
    for bx, bz, bhw, bhl, bh, bst in buildings:
        lines.append(f"  [{bx:.1f}, {bz:.1f}, {bhw:.1f}, {bhl:.1f}, {bh:.3f}, {bst}],")
    lines.append("];")
    lines.append("")
    lines.append("/** Iconic Saddar POIs [name, x, z] */")
    lines.append("export const SADDAR_POIS: ReadonlyArray<readonly [string, number, number]> = [")
    for pname, px, pz in CURATED_POIS:
        nm = pname.replace("\\", "\\\\").replace("'", "\\'")
        lines.append(f"  ['{nm}', {px:.1f}, {pz:.1f}],")
    lines.append("];")
    lines.append("")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    size_kb = os.path.getsize(args.out) / 1024.0
    print(
        f"Baked {args.out} ({size_kb:.1f} KB): "
        f"nodes={len(npts)}, links={len(links_raw)}, segs={len(undir_hw)}, "
        f"slabs={len(slabs_out)}, buildings={len(buildings)}, yards={len(yards_obb)}, "
        f"islands={len(islands)}, pois={len(CURATED_POIS)}"
    )


if __name__ == "__main__":
    main()
