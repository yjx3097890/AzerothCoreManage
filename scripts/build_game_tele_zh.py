#!/usr/bin/env python3
"""Build game_tele_zhCN.json by matching AC game_tele English names to Area/Map locale.

Usage:
  python3 scripts/build_game_tele_zh.py \\
    [--en-sql /path/to/game_tele.sql] \\
    [--out api/internal/gamelocale/game_tele_zhCN.json]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALE = ROOT / "api" / "internal" / "gamelocale"

ALIASES = {
    "stormwind": "stormwind city",
    "shattrath": "shattrath city",
    "silvermoon": "silvermoon city",
    "exodar": "the exodar",
    "thunderbluff": "thunder bluff",
    "aq20": "ruins of ahnqiraj",
    "aq40": "ahnqiraj temple",
    "ab": "arathi basin",
    "av": "alterac valley",
    "wsg": "warsong gulch",
    "eots": "eye of the storm",
    "sota": "strand of the ancients",
    "ioc": "isle of conquest",
    "naxx": "naxxramas",
    "kara": "karazhan",
    "brd": "blackrock depths",
    "lbrs": "lower blackrock spire",
    "ubrs": "upper blackrock spire",
    "bwl": "blackwing lair",
    "mc": "molten core",
    "zf": "zul farrak",
    "zg": "zul gurub",
    "strath": "stratholme",
    "scholo": "scholomance",
    "sm": "scarlet monastery",
    "bfd": "blackfathom deeps",
    "rfc": "ragefire chasm",
    "rfd": "razorfen downs",
    "rfk": "razorfen kraul",
    "sfk": "shadowfang keep",
    "stocks": "the stockade",
    "ulda": "uldaman",
    "marr": "maraudon",
    "st": "the temple of atal hakkar",
    "dm": "dire maul",
    "dmwest": "dire maul",
    "dmeast": "dire maul",
    "dmnorth": "dire maul",
    "gnomer": "gnomeregan",
    "arca": "the arcatraz",
    "bota": "the botanica",
    "mech": "the mechanar",
    "mag": "magtheridons lair",
    "gruul": "gruuls lair",
    "ssc": "serpentshrine cavern",
    "tk": "tempest keep",
    "bt": "black temple",
    "sp": "the steamvault",
    "ub": "the underbog",
    "sv": "the slave pens",
    "ac": "auchenai crypts",
    "sh": "sethekk halls",
    "sl": "shadow labyrinth",
    "mt": "mana tombs",
    "bm": "opening of the dark portal",
    "oldhillsbrad": "old hillsbrad foothills",
    "hillsbradfoothill": "hillsbrad foothills",
    "bf": "blood furnace",
    "hr": "hellfire ramparts",
    "shattered": "the shattered halls",
    "mgt": "magisters terrace",
    "uk": "utgarde keep",
    "up": "utgarde pinnacle",
    "nexus": "the nexus",
    "oculus": "the oculus",
    "an": "azjol nerub",
    "ak": "ahnkahet the old kingdom",
    "dtk": "drak tharon keep",
    "vh": "violet hold",
    "gun": "gundrak",
    "hos": "halls of stone",
    "hol": "halls of lightning",
    "cos": "culling of stratholme",
    "toc": "trial of the crusader",
    "toc5": "trial of the champion",
    "icc": "icecrown citadel",
    "voa": "vault of archavon",
    "os": "the obsidian sanctum",
    "eoe": "the eye of eternity",
    "ony": "onyxias lair",
    "rs": "the ruby sanctum",
}


def camel_split(s: str) -> str:
    s = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([a-zA-Z])", r"\1 \2", s)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s)
    return s


def norm_forms(s: str) -> set[str]:
    s = re.sub(r"\s+UNUSED$", "", s, flags=re.I)
    spaced = camel_split(s)
    spaced = spaced.replace("_", " ").replace("-", " ").replace("'", "").replace("`", "")
    spaced = re.sub(r"\s+", " ", spaced).strip().lower()
    if not spaced:
        return set()
    forms = {spaced, spaced.replace(" ", "")}
    if spaced.startswith("the "):
        forms.add(spaced[4:])
        forms.add(spaced[4:].replace(" ", ""))
    return forms


def load_id_map(path: Path) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_index() -> dict[str, str]:
    areas_en = load_id_map(LOCALE / "area_enUS.json")
    areas_zh = load_id_map(LOCALE / "area_zhCN.json")
    maps_en = load_id_map(LOCALE / "map_enUS.json")
    maps_zh = load_id_map(LOCALE / "map_zhCN.json")
    idx: dict[str, str] = {}
    for src, dest in ((maps_en, maps_zh), (areas_en, areas_zh)):
        for id_, en in src.items():
            zh = dest.get(id_, "")
            if not en or not zh or re.search(r"UNUSED", en, re.I):
                continue
            for form in norm_forms(en):
                idx.setdefault(form, zh)
    for alias, target in ALIASES.items():
        for form in norm_forms(target):
            if form in idx:
                for aform in norm_forms(alias):
                    idx.setdefault(aform, idx[form])
                break
    return idx


def parse_tele_names(en_sql: str) -> list[str]:
    names: list[str] = []
    for m in re.finditer(
        r"\((\d+)\s*,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*\d+\s*,\s*'((?:\\'|[^'])*)'\s*\)",
        en_sql,
    ):
        names.append(m.group(2).replace("\\'", "'"))
    return names


def resolve(name: str, idx: dict[str, str]) -> str:
    forms = list(norm_forms(name))
    low = name.lower()
    if low in ALIASES:
        forms.extend(norm_forms(ALIASES[low]))
    n = next(iter(norm_forms(name)), "")
    for suf in (" alliance", " horde", " raid", " dungeon"):
        if n.endswith(suf):
            forms.extend(norm_forms(n[: -len(suf)]))
    for form in forms:
        if form in idx:
            return idx[form]
    for suf in (" city", " keep"):
        for form in list(forms):
            if form + suf.replace(" ", "") in idx:
                return idx[form + suf.replace(" ", "")]
            spaced = (form + suf).strip()
            if spaced in idx:
                return idx[spaced]
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--en-sql",
        default="",
        help="AzerothCore game_tele.sql (default: download or local /tmp)",
    )
    ap.add_argument(
        "--out",
        default=str(LOCALE / "game_tele_zhCN.json"),
    )
    args = ap.parse_args()
    en_path = Path(args.en_sql) if args.en_sql else Path("/tmp/telezh/en.sql")
    if not en_path.is_file():
        raise SystemExit(f"missing English game_tele.sql: {en_path}")
    idx = build_index()
    names = parse_tele_names(en_path.read_text(encoding="utf-8", errors="replace"))
    mapping = {n: zh for n in names if (zh := resolve(n, idx))}
    out = Path(args.out)
    out.write_text(json.dumps(mapping, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(mapping)}/{len(names)} names)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
