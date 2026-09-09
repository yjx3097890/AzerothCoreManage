#!/usr/bin/env python3
"""Extract / rebuild game_event zh-CN names from a WoW zhCN client + live world DB.

Example:
  python3 scripts/extract_game_event_locale.py \\
    --client "/Volumes/Extreme SSD/WOW/Data/zhCN" \\
    --mysql-host 192.168.31.100 --mysql-port 3307 \\
    --mysql-user root --mysql-password qwe123 \\
    --mysql-db acore_world
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

ZHCN_LOCALE_FIELD = 5  # 1 + localeIndex(zhCN=4)


def read_dbc(data: bytes):
    assert data[:4] == b"WDBC"
    rec_count, _field_count, rec_size, _str_size = struct.unpack_from("<IIII", data, 4)
    offset = 20
    records = data[offset : offset + rec_count * rec_size]
    strings = data[offset + rec_count * rec_size :]

    def sget(off: int) -> str:
        if off <= 0 or off >= len(strings):
            return ""
        end = strings.find(b"\x00", off)
        if end < 0:
            end = len(strings)
        return strings[off:end].decode("utf-8", errors="replace")

    rows = [
        struct.unpack_from("<" + "I" * (rec_size // 4), records, i * rec_size)
        for i in range(rec_count)
    ]
    return rows, sget


def has_cjk(s: str) -> bool:
    return any("\u4e00" <= c <= "\u9fff" for c in (s or ""))


def load_holiday_zh(client_dir: Path) -> dict[int, str]:
    try:
        import mpyq
    except ImportError as e:
        raise SystemExit("需要 mpyq：pip3 install mpyq") from e

    mpq_path = client_dir / "locale-zhCN.MPQ"
    if not mpq_path.exists():
        raise SystemExit(f"找不到 {mpq_path}")
    archive = mpyq.MPQArchive(str(mpq_path))
    rows, sget = read_dbc(archive.read_file(r"DBFilesClient\HolidayNames.dbc"))
    holiday_names = {
        row[0]: (sget(row[ZHCN_LOCALE_FIELD]) or sget(row[1])) for row in rows
    }
    hrows, _ = read_dbc(archive.read_file(r"DBFilesClient\Holidays.dbc"))
    # Holidays.dbc field 49 = HolidayNames ID (3.3.5)
    return {row[0]: holiday_names.get(row[49], "") for row in hrows}


MANUAL = {
    16: "古拉巴什竞技场夺宝",
    27: "疯狂之缘，格里雷克",
    28: "疯狂之缘，哈扎拉尔",
    29: "疯狂之缘，雷纳塔基",
    30: "疯狂之缘，乌苏雷",
    34: "本月美酒（十月）",
    35: "本月美酒（十一月）",
    36: "本月美酒（十二月）",
    37: "本月美酒（一月）",
    38: "本月美酒（二月）",
    39: "本月美酒（三月）",
    40: "本月美酒（四月）",
    41: "本月美酒（五月）",
    42: "本月美酒（六月）",
    43: "本月美酒（七月）",
    44: "本月美酒（八月）",
    45: "本月美酒（九月）",
    55: "竞技场第三赛季",
    56: "竞技场第四赛季",
    57: "竞技场第五赛季",
    58: "竞技场第六赛季",
    59: "竞技场第七赛季",
    60: "竞技场第八赛季",
    73: "整点钟声",
    75: "竞技场第一赛季",
    76: "竞技场第二赛季",
    78: "夏季季节鱼类",
    79: "日间钓鱼事件",
    80: "夜间钓鱼事件",
    88: "傍晚",
    90: "荆棘谷钓鱼大赛 - 交任务",
    101: "夺日岛收复 阶段1",
    102: "夺日岛收复 阶段2（仅此阶段）",
    103: "夺日岛收复 阶段2（永久）",
    104: "夺日岛收复（无传送门）",
    105: "夺日岛收复（传送门）",
    106: "夺日岛收复 阶段3（仅此阶段）",
    107: "夺日岛收复 阶段3（永久）",
    108: "夺日岛收复（无铁砧）",
    109: "夺日岛收复（铁砧）",
    110: "夺日岛收复 阶段4",
    111: "夺日岛收复（无纪念碑）",
    112: "夺日岛收复（纪念碑）",
    113: "夺日岛收复（无炼金实验室）",
    114: "夺日岛收复（炼金实验室）",
    115: "夺日岛收复（基鲁）",
    116: "夺日岛收复（无基鲁）",
    117: "太阳井高地 - 第一道门开启",
    118: "太阳井高地 - 第二道门开启",
    119: "太阳井高地 - 全部门开启",
}

LOC_MAP = {
    "Elwynn Forest": "艾尔文森林",
    "Mulgore": "莫高雷",
    "Terokkar Forest": "泰罗卡森林",
    "Ironforge": "铁炉堡",
    "Orgrimmar": "奥格瑞玛",
}


def load_community() -> dict[int, str]:
    try:
        import urllib.request

        sql = (
            urllib.request.urlopen(
                "https://raw.githubusercontent.com/amydomi/TrinityCore_Chinese_Locale/master/game_event.sql",
                timeout=30,
            )
            .read()
            .decode("utf-8", "ignore")
        )
    except Exception:
        return {}
    return {
        int(e): n
        for n, e in re.findall(
            r"description`='([^']*)'\s*WHERE\s*\(`?eventEntry`?='?(\d+)'?\)", sql
        )
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True, help="zhCN Data 目录（含 locale-zhCN.MPQ）")
    ap.add_argument("--mysql-host", default="127.0.0.1")
    ap.add_argument("--mysql-port", type=int, default=3306)
    ap.add_argument("--mysql-user", default="root")
    ap.add_argument("--mysql-password", default="")
    ap.add_argument("--mysql-db", default="acore_world")
    ap.add_argument(
        "--out",
        default="",
        help="输出 JSON（默认写入 api/internal/gamelocale/game_event_zhCN.json）",
    )
    args = ap.parse_args()

    try:
        import pymysql
    except ImportError as e:
        raise SystemExit("需要 pymysql：pip3 install pymysql") from e

    client_dir = Path(args.client)
    holiday_zh = load_holiday_zh(client_dir)
    community = load_community()

    conn = pymysql.connect(
        host=args.mysql_host,
        port=args.mysql_port,
        user=args.mysql_user,
        password=args.mysql_password,
        database=args.mysql_db,
        charset="utf8mb4",
    )
    cur = conn.cursor()
    cur.execute("SELECT eventEntry, holiday, description FROM game_event ORDER BY eventEntry")
    events = cur.fetchall()
    conn.close()

    out: dict[str, dict] = {}
    for entry, holiday, desc in events:
        desc = desc or ""
        zh = None
        if entry in MANUAL:
            zh = MANUAL[entry]
        elif has_cjk(community.get(entry, "")):
            zh = community[entry]
        elif holiday and holiday_zh.get(holiday):
            base = holiday_zh[holiday]
            suffix = ""
            for en, cn in LOC_MAP.items():
                if en in desc:
                    suffix = f"（{cn}）"
                    break
            zh = base + ("搭建" if "Building" in desc else "") + suffix
        else:
            zh = desc
        out[str(entry)] = {"en": desc, "zh": zh, "holiday": int(holiday)}

    root = Path(__file__).resolve().parents[1]
    out_path = Path(args.out) if args.out else root / "api/internal/gamelocale/game_event_zhCN.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    # keep mirror under api/data/locale for reference
    mirror = root / "api/data/locale/game_event_zhCN.json"
    mirror.parent.mkdir(parents=True, exist_ok=True)
    mirror.write_text(out_path.read_text(encoding="utf-8"), encoding="utf-8")

    # Also refresh Map / Area names from the same client
    rows, sget = None, None
    try:
        import struct as _struct

        def _read_dbc(data: bytes):
            rec_count, _fc, rec_size, _ss = _struct.unpack_from("<IIII", data, 4)
            records = data[20 : 20 + rec_count * rec_size]
            strings = data[20 + rec_count * rec_size :]

            def _sget(off: int) -> str:
                if off <= 0 or off >= len(strings):
                    return ""
                end = strings.find(b"\x00", off)
                if end < 0:
                    end = len(strings)
                return strings[off:end].decode("utf-8", "replace")

            rows = [
                _struct.unpack_from("<" + "I" * (rec_size // 4), records, i * rec_size)
                for i in range(rec_count)
            ]
            return rows, _sget

        import mpyq as _mpyq

        arch = _mpyq.MPQArchive(str(Path(args.client) / "locale-zhCN.MPQ"))
        arows, asget = _read_dbc(arch.read_file(r"DBFilesClient\AreaTable.dbc"))
        areas = {str(r[0]): asget(r[15]) for r in arows if asget(r[15])}
        mrows, msget = _read_dbc(arch.read_file(r"DBFilesClient\Map.dbc"))
        maps = {str(r[0]): msget(r[8]) for r in mrows if msget(r[8])}
        for name, payload in (("area_zhCN.json", areas), ("map_zhCN.json", maps)):
            for dest in (
                root / "api/internal/gamelocale" / name,
                root / "api/data/locale" / name,
            ):
                dest.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
        print(f"also wrote area({len(areas)}) map({len(maps)})")
    except Exception as e:
        print("warn: map/area extract skipped:", e)

    cjk = sum(1 for v in out.values() if has_cjk(v["zh"]))
    print(f"wrote {out_path} ({len(out)} events, {cjk} with CJK)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
