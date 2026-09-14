#!/usr/bin/env python3
"""Download Huijiwiki DGMap journal maps (WoW 1.0 / 2.0 / 3.0) for MyBots.

Classic/TBC clients usually have no WorldMap parchment for dungeons; these
journal maps are visual-only (hasCoords=false). WotLK instances that already
exist under worldmap/index.json byAreaId are preferred at runtime.

Usage:
  python3 scripts/fetch_dgmaps.py
  python3 scripts/fetch_dgmaps.py --force
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "scripts" / "data" / "dgmap_sources.json"
OUT_DIR = ROOT / "web" / "public" / "maps" / "dungeons"
INDEX = OUT_DIR / "index.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-download existing files")
    ap.add_argument("--sources", type=Path, default=SOURCES)
    args = ap.parse_args()

    if not args.sources.is_file():
        print(f"missing sources list: {args.sources}", file=sys.stderr)
        return 1
    if not INDEX.is_file():
        print(f"missing index: {INDEX}", file=sys.stderr)
        return 1

    sources = json.loads(args.sources.read_text(encoding="utf-8"))
    ok = 0
    skip = 0
    fail = 0
    for row in sources:
        mid = int(row["mapId"])
        name = row["file"]
        url = row["url"]
        dest = OUT_DIR / str(mid) / name
        if dest.is_file() and not args.force:
            skip += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AzerothCoreManage/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if len(data) < 1000:
                raise RuntimeError(f"too small ({len(data)} bytes)")
            dest.write_bytes(data)
            ok += 1
            print(f"ok  {dest.relative_to(ROOT)} ({len(data)} bytes)")
        except Exception as e:
            fail += 1
            print(f"fail {name}: {e}", file=sys.stderr)

    print(f"done: downloaded={ok} skipped={skip} failed={fail}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
