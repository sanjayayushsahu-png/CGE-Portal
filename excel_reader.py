import sys
import os
import json
import csv
import datetime

def fmt_val(v):
    if v is None:
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip()

def read_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.active
    rows = []
    for row in ws.iter_rows(values_only=True):
        rows.append([fmt_val(c) for c in row])
    wb.close()
    return rows

def read_xls(path):
    import xlrd
    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_index(0)
    rows = []
    for r in range(ws.nrows):
        out = []
        for c in range(ws.ncols):
            cell = ws.cell(r, c)
            if cell.ctype == xlrd.XL_CELL_DATE:
                try:
                    dt = xlrd.xldate_as_datetime(cell.value, wb.datemode)
                    out.append(dt.strftime("%Y-%m-%d"))
                except Exception:
                    out.append(fmt_val(cell.value))
            elif cell.ctype == xlrd.XL_CELL_NUMBER:
                v = cell.value
                out.append(str(int(v)) if float(v).is_integer() else str(v))
            else:
                out.append(fmt_val(cell.value))
        rows.append(out)
    return rows

def read_csv_file(path):
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                return [[c.strip() for c in row] for row in csv.reader(f)]
        except UnicodeDecodeError:
            continue
    raise ValueError("Unable to decode CSV file")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    path = sys.argv[1]
    ext = os.path.splitext(path)[1].lower()

    with open(path, "rb") as f:
        magic = f.read(8)

    try:
        if magic[:2] == b"PK" or ext == ".xlsx":
            rows = read_xlsx(path)
        elif magic[:4] == b"\xd0\xcf\x11\xe0" or ext == ".xls":
            try:
                rows = read_xls(path)
            except Exception:
                # Some .xls files are actually CSV/TSV or XLSX renamed to .xls
                if magic[:2] == b"PK":
                    rows = read_xlsx(path)
                else:
                    rows = read_csv_file(path)
        else:
            rows = read_csv_file(path)

        sys.stdout.buffer.write(json.dumps({"rows": rows}, ensure_ascii=False).encode("utf-8"))
    except Exception as e:
        sys.stdout.buffer.write(json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8"))
        sys.exit(1)

if __name__ == "__main__":
    main()
