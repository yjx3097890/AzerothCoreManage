#!/usr/bin/env python3
"""Extract WoW 3.3.5 Interface/WorldMap tiles into overview PNGs + index.json.

Source (zhCN client example):
  /Volumes/Extreme SSD/WOW/Data/zhCN/locale-zhCN.MPQ
  /Volumes/Extreme SSD/WOW/Data/zhCN/patch-zhCN.MPQ
  /Volumes/Extreme SSD/WOW/Data/zhCN/patch-zhCN-2.MPQ

Output under web/public/maps/worldmap/:
  continents/{0,1,530,571}/overview.png
  zones/<Folder>/overview.png
  index.json

Usage:
  python3 scripts/extract_worldmaps.py
  python3 scripts/extract_worldmaps.py --client "/Volumes/Extreme SSD/WOW"
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

try:
    from mpyq import MPQArchive
except ImportError:
    print("pip install mpyq", file=sys.stderr)
    raise

try:
    import texture2ddecoder
    from PIL import Image
except ImportError:
    print("pip install texture2ddecoder Pillow", file=sys.stderr)
    raise

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

CONTINENT_FOLDERS = {
    "Azeroth": 0,
    "Kalimdor": 1,
    "Expansion01": 530,
    "Northrend": 571,
}

COLS, ROWS = 4, 3  # tiles 1..12


def load_blp2_rgba(data: bytes) -> Image.Image:
    """Decode BLP2 to RGBA.

    zhCN Interface/WorldMap tiles often claim DXT mips at the file tail that are
    only 64×64 thumbnails; the real 256×256 DXT1 payload starts at offset 148.
    """
    if data[:4] != b"BLP2":
        raise ValueError("not BLP2")
    _typ, enc, _alpha_depth, alpha_enc, _has_mips = struct.unpack_from("<IBBBB", data, 4)
    width, height = struct.unpack_from("<II", data, 12)
    if enc != 2:
        raise ValueError(f"unsupported BLP encoding {enc}")

    header_end = 148
    dxt1_size = ((width + 3) // 4) * ((height + 3) // 4) * 8
    dxt5_size = dxt1_size * 2

    def decode_payload(payload: bytes, codec: str, w: int, h: int) -> Image.Image:
        if codec == "bc3":
            raw = texture2ddecoder.decode_bc3(payload, w, h)
        else:
            raw = texture2ddecoder.decode_bc1(payload, w, h)
        return Image.frombytes("RGBA", (w, h), raw, "raw", "BGRA")

    # 1) Full-res block right after header (preferred for WorldMap)
    if alpha_enc == 7 and len(data) >= header_end + dxt5_size:
        try:
            return decode_payload(data[header_end : header_end + dxt5_size], "bc3", width, height)
        except Exception:
            pass
    if len(data) >= header_end + dxt1_size:
        try:
            return decode_payload(data[header_end : header_end + dxt1_size], "bc1", width, height)
        except Exception:
            pass

    # 2) Fall back to mip0 table (may be thumbnail-sized)
    offsets = struct.unpack_from("<16I", data, 28)
    sizes = struct.unpack_from("<16I", data, 92)
    off0, size0 = offsets[0], sizes[0]
    if size0 <= 0:
        raise ValueError("empty BLP mip0")
    payload = data[off0 : off0 + size0]
    blocks = size0 // 8
    n = int(blocks**0.5)
    if n * n == blocks and n > 0:
        dw = dh = n * 4
        img = decode_payload(payload, "bc1", dw, dh)
        if (dw, dh) != (width, height):
            img = img.resize((width, height), Image.Resampling.BILINEAR)
        return img
    if alpha_enc == 7:
        return decode_payload(payload, "bc3", width, height)
    return decode_payload(payload, "bc1", width, height)


def read_merged_dbc(mpq_paths: list[Path]) -> list[dict]:
    by_id: dict[int, dict] = {}
    for path in mpq_paths:
        if not path.exists():
            continue
        try:
            arc = MPQArchive(str(path))
        except Exception as e:
            print(f"skip {path.name}: {e}", file=sys.stderr)
            continue
        data = arc.read_file("DBFilesClient\\WorldMapArea.dbc")
        if not data:
            continue
        _magic, rc, _fc, rs, _ss = struct.unpack_from("<4sIIII", data, 0)
        string_block = data[20 + rc * rs :]

        def get_str(off: int) -> str:
            if off <= 0 or off >= len(string_block):
                return ""
            end = string_block.find(b"\0", off)
            return string_block[off:end].decode("utf-8", "replace")

        for i in range(rc):
            vals = struct.unpack_from("<IIIIffffII", data, 20 + i * rs)
            by_id[vals[0]] = {
                "id": vals[0],
                "mapId": vals[1],
                "areaId": vals[2],
                "name": get_str(vals[3]),
                "locLeft": vals[4],
                "locRight": vals[5],
                "locTop": vals[6],
                "locBottom": vals[7],
            }
        print(f"  WorldMapArea from {path.name}: {rc} rows")
    return list(by_id.values())


def collect_worldmap_blps(mpq_paths: list[Path]) -> dict[str, dict[str, bytes]]:
    """folder lower -> {filename lower -> blp bytes}, later MPQs override."""
    folders: dict[str, dict[str, bytes]] = defaultdict(dict)
    for path in mpq_paths:
        if not path.exists():
            continue
        try:
            arc = MPQArchive(str(path))
        except Exception as e:
            print(f"skip {path.name}: {e}", file=sys.stderr)
            continue
        n = 0
        for raw in arc.files or []:
            name = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
            norm = name.replace("\\", "/")
            low = norm.lower()
            if "/worldmap/" not in low or not low.endswith(".blp"):
                continue
            # Interface/WorldMap/<Folder>/<file>.blp
            parts = norm.split("/")
            try:
                wi = next(i for i, p in enumerate(parts) if p.lower() == "worldmap")
            except StopIteration:
                continue
            if wi + 2 >= len(parts):
                continue
            folder = parts[wi + 1]
            fname = parts[wi + 2]
            if folder.lower() in ("",) or fname.lower().startswith("ui-"):
                continue
            try:
                data = arc.read_file(raw if isinstance(raw, bytes) else name.replace("/", "\\"))
            except Exception:
                data = None
            if not data:
                # try alternate separators
                data = arc.read_file(norm.replace("/", "\\"))
            if not data:
                continue
            folders[folder][fname.lower()] = data
            n += 1
        print(f"  WorldMap BLPs from {path.name}: {n}")
    return folders


_tile_re = re.compile(
    r"^(?P<base>.+?)(?P<floor>\d+)?_(?P<idx>\d+)\.blp$",
    re.I,
)
_simple_re = re.compile(r"^(?P<base>.+?)(?P<idx>\d+)\.blp$", re.I)


def pick_tile_set(files: dict[str, bytes], folder: str) -> list[tuple[int, bytes]] | None:
    """Return list of (1..12, bytes) for the best floor tile set."""
    folder_l = folder.lower()
    candidates: dict[tuple[str, int], dict[int, bytes]] = defaultdict(dict)

    # Prefer exact prefix strip: Expansion011.blp → folder Expansion01 + idx 1
    exact: dict[int, bytes] = {}
    for fname, data in files.items():
        low = fname.lower()
        if not low.endswith(".blp"):
            continue
        stem = low[:-4]
        if stem.startswith(folder_l):
            rest = stem[len(folder_l) :]
            if rest.isdigit():
                idx = int(rest)
                if 1 <= idx <= 12:
                    exact[idx] = data
            elif "_" in rest:
                # floor_idx e.g. 1_3
                left, _, right = rest.partition("_")
                if left.isdigit() and right.isdigit():
                    floor = int(left)
                    idx = int(right)
                    if 1 <= idx <= 12:
                        candidates[(folder_l, floor)][idx] = data
    if len(exact) >= 4:
        return sorted(exact.items(), key=lambda x: x[0])

    for fname, data in files.items():
        m = _tile_re.match(fname)
        if m and m.group("floor") is not None:
            base = m.group("base").lower()
            floor = int(m.group("floor"))
            idx = int(m.group("idx"))
            if 1 <= idx <= 12:
                candidates[(base, floor)][idx] = data
            continue
        m = _simple_re.match(fname)
        if m:
            base = m.group("base").lower()
            idx = int(m.group("idx"))
            if 1 <= idx <= 12:
                candidates[(base, 0)][idx] = data

    if exact:
        candidates[(folder_l, 0)] = exact

    if not candidates:
        return None

    def score(key: tuple[str, int], tiles: dict[int, bytes]) -> tuple:
        base, floor = key
        exact_name = 3 if base == folder_l else 0
        partial = 1 if (folder_l in base or base in folder_l) else 0
        return (len(tiles), exact_name + partial, 0 if floor == 0 else -floor)

    best_key = max(candidates.keys(), key=lambda k: score(k, candidates[k]))
    tiles = candidates[best_key]
    if len(tiles) < 8:
        named = [k for k in candidates if k[0] == folder_l]
        pool = named if named else list(candidates.keys())
        best_key = max(pool, key=lambda k: len(candidates[k]))
        tiles = candidates[best_key]
    if len(tiles) < 4:
        return None
    return sorted(tiles.items(), key=lambda x: x[0])


def read_merged_overlays(mpq_paths: list[Path]) -> dict[int, list[dict]]:
    """WorldMapAreaID -> list of overlay descriptors (fully explored art)."""
    by_area: dict[int, list[dict]] = {}
    for path in mpq_paths:
        if not path.exists():
            continue
        try:
            arc = MPQArchive(str(path))
        except Exception as e:
            print(f"skip {path.name}: {e}", file=sys.stderr)
            continue
        data = arc.read_file("DBFilesClient\\WorldMapOverlay.dbc")
        if not data:
            continue
        _magic, rc, fc, rs, _ss = struct.unpack_from("<4sIIII", data, 0)
        if fc < 13 or rs < 52:
            print(f"  unexpected WorldMapOverlay layout in {path.name}", file=sys.stderr)
            continue
        string_block = data[20 + rc * rs :]

        def get_str(off: int) -> str:
            if off <= 0 or off >= len(string_block):
                return ""
            end = string_block.find(b"\0", off)
            return string_block[off:end].decode("utf-8", "replace")

        n = 0
        for i in range(rc):
            vals = struct.unpack_from("<" + "I" * fc, data, 20 + i * rs)
            area_id = int(vals[1])
            tex = get_str(int(vals[8]))
            if not tex:
                continue
            ov = {
                "id": int(vals[0]),
                "texture": tex,
                "width": int(vals[9]),
                "height": int(vals[10]),
                "offsetX": int(vals[11]),
                "offsetY": int(vals[12]),
            }
            by_area.setdefault(area_id, [])
            # later MPQs override same overlay id
            existing = by_area[area_id]
            replaced = False
            for j, old in enumerate(existing):
                if old["id"] == ov["id"]:
                    existing[j] = ov
                    replaced = True
                    break
            if not replaced:
                existing.append(ov)
            n += 1
        print(f"  WorldMapOverlay from {path.name}: {n} rows")
    return by_area


def stitch_tiles(tile_list: list[tuple[int, bytes]], *, crop_black: bool = True) -> Image.Image:
    """Stitch 4×3 WorldMap detail tiles. crop_black drops per-tile top black strips."""
    images: dict[int, Image.Image] = {}
    for idx, data in tile_list:
        images[idx] = load_blp2_rgba(data)
    sample = images[min(images)]
    tw, th = sample.size
    top_crop = 0
    if crop_black:
        borders = [detect_top_black_border(img) for img in list(images.values())[:4]]
        top_crop = max(borders) if borders else 0
    content_h = th - top_crop
    if content_h <= 0:
        content_h = th
        top_crop = 0

    out = Image.new("RGBA", (COLS * tw, ROWS * content_h), (0, 0, 0, 255))
    for idx, img in images.items():
        i = idx - 1
        col, row = i % COLS, i // COLS
        if row >= ROWS:
            continue
        if img.size != (tw, th):
            img = img.resize((tw, th), Image.Resampling.BILINEAR)
        if top_crop > 0:
            img = img.crop((0, top_crop, tw, th))
        out.paste(img, (col * tw, row * content_h))
    if crop_black:
        return _crop_bottom_black(_blend_horizontal_seams(out, content_h, ROWS))
    return out


def apply_exploration_overlays(
    base: Image.Image,
    folder_files: dict[str, bytes],
    overlays: list[dict],
) -> Image.Image:
    """Composite WorldMapOverlay textures (explored regions) onto the blank parchment base."""
    if not overlays:
        return base
    canvas = base.convert("RGBA")
    applied = 0
    for ov in overlays:
        tex = ov["texture"]
        width, height = ov["width"], ov["height"]
        ox, oy = ov["offsetX"], ov["offsetY"]
        wide = max(1, (width + 255) // 256)
        tall = max(1, (height + 255) // 256)
        idx = 1
        for row in range(tall):
            for col in range(wide):
                key = f"{tex.lower()}{idx}.blp"
                data = folder_files.get(key)
                idx += 1
                if not data:
                    continue
                try:
                    tile = load_blp2_rgba(data)
                except Exception:
                    continue
                pw = min(256, width - col * 256)
                ph = min(256, height - row * 256)
                if pw <= 0 or ph <= 0:
                    continue
                if tile.size[0] < pw or tile.size[1] < ph:
                    tile = tile.resize((max(pw, tile.size[0]), max(ph, tile.size[1])), Image.Resampling.BILINEAR)
                tile = tile.crop((0, 0, pw, ph))
                px = ox + col * 256
                py = oy + row * 256
                layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
                layer.paste(tile, (px, py), tile)
                canvas = Image.alpha_composite(canvas, layer)
                applied += 1
    if applied:
        print(f"    overlays: {applied} pieces from {len(overlays)} regions")
    return canvas


def detect_top_black_border(img: Image.Image, max_check: int = 32, thr: int = 8) -> int:
    """How many fully-black rows at the top of a WorldMap tile (often 8)."""
    if np is None:
        rgba = img.convert("RGBA")
        w, h = rgba.size
        px = rgba.load()
        border = 0
        for y in range(min(max_check, h)):
            black = sum(1 for x in range(w) if px[x, y][3] < 8 or max(px[x, y][:3]) < thr)
            if black / w >= 0.98:
                border += 1
            else:
                break
        return border
    arr = np.asarray(img.convert("RGBA"))
    limit = min(max_check, arr.shape[0])
    border = 0
    for y in range(limit):
        row = arr[y]
        black = ((row[:, 3] < 8) | (row[:, :3].max(axis=1) < thr)).mean()
        if black >= 0.98:
            border += 1
        else:
            break
    return border


def _blend_horizontal_seams(img: Image.Image, row_h: int, rows: int) -> Image.Image:
    """Soften residual 1px discontinuities where tile rows meet."""
    if np is None or rows < 2 or row_h < 4:
        return img
    arr = np.asarray(img.convert("RGBA")).astype(np.float32)
    for r in range(1, rows):
        y = r * row_h
        if y <= 0 or y >= arr.shape[0]:
            continue
        above = arr[y - 1]
        below = arr[min(y, arr.shape[0] - 1)]
        # replace seam row and neighbors with short vertical blend
        for dy, w_above in ((-1, 0.75), (0, 0.5), (1, 0.25)):
            yy = y + dy
            if 0 <= yy < arr.shape[0]:
                arr[yy] = above * w_above + below * (1.0 - w_above)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _crop_bottom_black(img: Image.Image, thr: int = 8) -> Image.Image:
    """Trim trailing full-width black rows (empty tile padding at map bottom)."""
    if np is None:
        return img
    arr = np.asarray(img.convert("RGBA"))
    row_black = ((arr[:, :, 3] < 8) | (arr[:, :, :3].max(axis=2) < thr)).mean(axis=1) >= 0.98
    y1 = arr.shape[0]
    while y1 > 0 and row_black[y1 - 1]:
        y1 -= 1
    if y1 <= 0 or y1 == arr.shape[0]:
        return img
    if y1 < arr.shape[0] * 0.5:
        return img
    return Image.fromarray(arr[:y1])


def fix_stitched_overview(img: Image.Image, cols: int = COLS, rows: int = ROWS) -> Image.Image:
    """Remove horizontal black seam bands from an already-stitched overview PNG."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    if w % cols != 0 or rows < 2:
        return rgba
    tw, th = w // cols, h // rows
    if th * rows != h:
        return _fix_by_black_runs(rgba)

    if np is None:
        tiles = [
            rgba.crop((col * tw, row * th, (col + 1) * tw, (row + 1) * th))
            for row in range(rows)
            for col in range(cols)
        ]
        top_crop = max(detect_top_black_border(t) for t in tiles[:4])
        if top_crop <= 0:
            return rgba
        content_h = th - top_crop
        out = Image.new("RGBA", (w, rows * content_h), (0, 0, 0, 255))
        i = 0
        for row in range(rows):
            for col in range(cols):
                tile = tiles[i].crop((0, top_crop, tw, th))
                out.paste(tile, (col * tw, row * content_h))
                i += 1
        return _crop_bottom_black(_blend_horizontal_seams(out, content_h, rows))

    arr = np.asarray(rgba)
    borders = [
        detect_top_black_border(Image.fromarray(arr[0:th, col * tw : (col + 1) * tw]))
        for col in range(min(4, cols))
    ]
    top_crop = max(borders) if borders else 0
    if top_crop <= 0:
        return _crop_bottom_black(rgba)
    content_h = th - top_crop
    out = np.empty((rows * content_h, w, 4), dtype=arr.dtype)
    for row in range(rows):
        src_y0 = row * th + top_crop
        src_y1 = (row + 1) * th
        dst_y0 = row * content_h
        out[dst_y0 : dst_y0 + content_h] = arr[src_y0:src_y1]
    return _crop_bottom_black(_blend_horizontal_seams(Image.fromarray(out), content_h, rows))


def _fix_by_black_runs(rgba: Image.Image, thr: int = 8) -> Image.Image:
    """Fallback: delete near-full-width black row runs in the middle of the image."""
    if np is None:
        return rgba
    arr = np.asarray(rgba.convert("RGBA"))
    h = arr.shape[0]
    black_rows = ((arr[:, :, 3] < 8) | (arr[:, :, :3].max(axis=2) < thr)).mean(axis=1) >= 0.98
    keep = np.ones(h, dtype=bool)
    y = 0
    while y < h:
        if not black_rows[y]:
            y += 1
            continue
        y0 = y
        while y < h and black_rows[y]:
            y += 1
        if y0 > 16 and y < h - 16 and (y - y0) <= 16:
            keep[y0:y] = False
    if keep.all():
        return rgba
    return Image.fromarray(arr[keep])


def bounds_from_row(row: dict) -> dict:
    # Plan / client UV: left edge LocLeft? — use LocRight as minX, LocLeft as maxX
    return {
        "minX": float(row["locRight"]),
        "maxX": float(row["locLeft"]),
        "minY": float(row["locBottom"]),
        "maxY": float(row["locTop"]),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--client",
        default="/Volumes/Extreme SSD/WOW",
        help="WoW client root containing Data/",
    )
    ap.add_argument(
        "--out",
        default=None,
        help="Output dir (default: <repo>/web/public/maps/worldmap)",
    )
    ap.add_argument(
        "--fix-seams",
        action="store_true",
        help="Only fix horizontal black seams on existing overview.png files (no MPQ extract)",
    )
    args = ap.parse_args()
    repo = Path(__file__).resolve().parents[1]
    out = Path(args.out) if args.out else repo / "web" / "public" / "maps" / "worldmap"

    if args.fix_seams:
        if not out.is_dir():
            print(f"missing {out}", file=sys.stderr)
            return 1
        n = 0
        for png in sorted(out.rglob("overview.png")):
            before = Image.open(png)
            after = fix_stitched_overview(before)
            if after.size == before.size:
                after = _fix_by_black_runs(before.convert("RGBA"))
            if after.size != before.size:
                after.save(png, "PNG", optimize=True)
                print(f"  fixed {png.relative_to(out)} {before.size[0]}x{before.size[1]} -> {after.size[0]}x{after.size[1]}")
                n += 1
        print(f"fixed {n} maps under {out}")
        return 0

    client = Path(args.client)
    zh = client / "Data" / "zhCN"
    mpqs = [
        zh / "locale-zhCN.MPQ",
        zh / "patch-zhCN.MPQ",
        zh / "patch-zhCN-2.MPQ",
        zh / "lichking-locale-zhCN.MPQ",
        zh / "expansion-locale-zhCN.MPQ",
    ]

    print("Reading WorldMapArea.dbc…")
    rows = read_merged_dbc(mpqs)
    if not rows:
        print("No WorldMapArea.dbc found", file=sys.stderr)
        return 1

    print("Reading WorldMapOverlay.dbc…")
    overlays_by_area = read_merged_overlays(mpqs)

    print("Collecting WorldMap BLPs…")
    folders = collect_worldmap_blps(mpqs)
    # case-insensitive folder lookup
    folder_by_lower = {k.lower(): k for k in folders}

    out.mkdir(parents=True, exist_ok=True)
    (out / "continents").mkdir(exist_ok=True)
    (out / "zones").mkdir(exist_ok=True)

    by_area: dict[str, dict] = {}
    by_map: dict[str, dict] = {}
    name_to_row = {r["name"].lower(): r for r in rows if r["name"]}
    name_to_wma_id = {r["name"].lower(): r["id"] for r in rows if r["name"]}

    def export_folder(folder_key: str, rel_image: str) -> bool:
        actual = folder_by_lower.get(folder_key.lower())
        if not actual:
            print(f"  missing art: {folder_key}")
            return False
        tile_list = pick_tile_set(folders[actual], actual)
        if not tile_list:
            print(f"  no tiles: {actual}")
            return False
        try:
            # Keep original 4×3 UV space so overlay Offset_X/Y match the client.
            img = stitch_tiles(tile_list, crop_black=False)
            wma_id = name_to_wma_id.get(folder_key.lower()) or name_to_wma_id.get(actual.lower())
            if wma_id is not None:
                img = apply_exploration_overlays(img, folders[actual], overlays_by_area.get(wma_id, []))
            img = fix_stitched_overview(img)
            img = _crop_bottom_black(img)
        except Exception as e:
            print(f"  stitch fail {actual}: {e}")
            return False
        dest = out / rel_image
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, "PNG", optimize=True)
        print(f"  wrote {rel_image} ({img.size[0]}x{img.size[1]}, {len(tile_list)} tiles)")
        return True

    # Continents from DBC areaId==0
    for row in rows:
        if row["areaId"] != 0:
            continue
        name = row["name"]
        map_id = row["mapId"]
        if name not in CONTINENT_FOLDERS and map_id not in CONTINENT_FOLDERS.values():
            # still export if art exists
            pass
        rel = f"continents/{map_id}/overview.png"
        if export_folder(name, rel):
            entry = {
                "folder": name,
                "mapId": map_id,
                "areaId": 0,
                "image": rel,
                **bounds_from_row(row),
            }
            by_map[str(map_id)] = entry

    # Ensure CONTINENT_FOLDERS covered even if naming differs
    for folder, map_id in CONTINENT_FOLDERS.items():
        if str(map_id) in by_map:
            continue
        row = name_to_row.get(folder.lower())
        if not row:
            continue
        rel = f"continents/{map_id}/overview.png"
        if export_folder(folder, rel):
            by_map[str(map_id)] = {
                "folder": folder,
                "mapId": map_id,
                "areaId": 0,
                "image": rel,
                **bounds_from_row(row),
            }

    # Zones (areaId != 0)
    for row in rows:
        if row["areaId"] == 0:
            continue
        name = row["name"]
        if not name:
            continue
        # skip zero bounds (e.g. Dalaran placeholder)
        if row["locLeft"] == 0 and row["locRight"] == 0 and row["locTop"] == 0 and row["locBottom"] == 0:
            continue
        rel = f"zones/{name}/overview.png"
        if not export_folder(name, rel):
            continue
        by_area[str(row["areaId"])] = {
            "folder": name,
            "mapId": row["mapId"],
            "areaId": row["areaId"],
            "image": rel,
            **bounds_from_row(row),
        }

    index = {
        "version": 2,
        "source": "Interface/WorldMap detail tiles + WorldMapOverlay (fully explored)",
        "byAreaId": by_area,
        "byMapId": by_map,
    }
    index_path = out / "index.json"
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {index_path} areas={len(by_area)} continents={len(by_map)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
