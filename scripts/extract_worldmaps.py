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


def stitch_tiles(tile_list: list[tuple[int, bytes]]) -> Image.Image:
    images: dict[int, Image.Image] = {}
    for idx, data in tile_list:
        images[idx] = load_blp2_rgba(data)
    # assume equal size from tile 1 or first
    sample = images[min(images)]
    tw, th = sample.size
    out = Image.new("RGBA", (COLS * tw, ROWS * th), (0, 0, 0, 255))
    for idx, img in images.items():
        i = idx - 1
        col, row = i % COLS, i // COLS
        if row >= ROWS:
            continue
        if img.size != (tw, th):
            img = img.resize((tw, th), Image.Resampling.BILINEAR)
        out.paste(img, (col * tw, row * th))
    return out


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
    args = ap.parse_args()
    client = Path(args.client)
    repo = Path(__file__).resolve().parents[1]
    out = Path(args.out) if args.out else repo / "web" / "public" / "maps" / "worldmap"
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
            img = stitch_tiles(tile_list)
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
        "version": 1,
        "source": "Interface/WorldMap + WorldMapArea.dbc",
        "byAreaId": by_area,
        "byMapId": by_map,
    }
    index_path = out / "index.json"
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {index_path} areas={len(by_area)} continents={len(by_map)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
