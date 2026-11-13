# -*- coding: utf-8 -*-
"""อ่านชีต "Master MC" จากไฟล์ Master MC ของโปรเจกต์ Knit Plan แล้วพิมพ์ออกมาเป็น JSON

ไม่ได้เขียนอะไรลงที่ไหน ตัวที่บันทึกลงฐานข้อมูลคือ sync-master-mc.js ซึ่งเรียกไฟล์นี้อีกที
ใช้:  python scripts/read-master-mc.py [path ของไฟล์ .xlsx]
ต้องมี pandas กับ openpyxl (ชุดเดียวกับที่โปรเจกต์ Knit Plan ใช้)
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

SHEET = "Master MC"
FOLDER = Path(os.path.expandvars(r"%USERPROFILE%\Nan Yang Textile\SCM_Cloud - Knit Plan (AI)"))
# โฟลเดอร์จริงใช้ชื่อ Master_MC.xlsx ส่วน config.ini ของ Knit Plan เขียนว่า MasterMC.xlsx จึงลองทั้งสองชื่อ
CANDIDATES = [FOLDER / "Master_MC.xlsx", FOLDER / "MasterMC.xlsx"]

# ชื่อคอลัมน์ในไฟล์ -> ชื่อที่หน้าเว็บใช้
COLUMNS = {
    "Factory": "factory",
    "Type": "type",
    "MC_CAT": "cat",
    "MC": "mc",
    "Guage": "gauge",
    "Group": "group",
    "SUBGroup": "subgroup",
    "Total MC": "total",
    "วัน/สัปดาห์": "days",
    "ชม./วัน": "hours",
}
NUMBERS = {"total", "days", "hours"}


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def text(value) -> str:
    s = "" if value is None else str(value).strip()
    return "" if s.lower() in ("nan", "none") else s


def number(value):
    """ตัวเลข หรือ None ถ้าช่องนั้นไม่ใช่ตัวเลข (เช่น "-" ของกลุ่มจ้างทอ)"""
    try:
        n = float(text(value))
    except ValueError:
        return None
    return int(n) if n.is_integer() else n


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    given = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MASTER_MC_FILE")
    paths = [Path(os.path.expandvars(given))] if given else CANDIDATES
    path = next((p for p in paths if p.exists()), None)
    if path is None:
        fail("ไม่พบไฟล์ Master MC ที่ " + " หรือ ".join(str(p) for p in paths))

    try:
        df = pd.read_excel(path, sheet_name=SHEET, dtype=str)
    except ValueError as err:
        fail(f'อ่านชีต "{SHEET}" จาก {path.name} ไม่ได้: {err}')
    df.columns = df.columns.str.strip()

    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        fail(f'ชีต "{SHEET}" ไม่มีคอลัมน์ {", ".join(missing)} (มี: {", ".join(df.columns)})')

    rows = []
    for record in df.to_dict("records"):
        row = {key: (number(record[col]) if key in NUMBERS else text(record[col])) for col, key in COLUMNS.items()}
        if row["mc"]:
            rows.append(row)

    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    json.dump(
        {"file": path.name, "sheet": SHEET, "fileModified": modified.isoformat(), "rows": rows},
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
