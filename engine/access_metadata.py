"""Read-only metadata for a Microsoft Access database: table names, field names and types, and row counts.

Run this inside the client's environment, on a copy or on the live file, with Microsoft's Access driver installed.
It opens the database read-only, lists the tables and their fields, counts the rows of each table, and writes one
JSON file. It never reads a value from a row, and it writes nothing to the database.

    python access_metadata.py --database "C:\\path\\ManageIt.mdb" --out ManageIt.metadata.json

The output is what the Cutover engine reads (cutover_discover.py --db-metadata). It holds names, types and counts only.
"""
import argparse
import json
import sys

FORMAT = "cutover-db-metadata/1"
DRIVER = "Microsoft Access Driver (*.mdb, *.accdb)"
SYSTEM_PREFIX = "MSys"


def connection_string(database_path: str) -> str:
    """An ODBC connection string that opens the file read-only."""
    return f"Driver={{{DRIVER}}};DBQ={database_path};ReadOnly=1;"


def quote_name(name: str) -> str:
    """A table name in square brackets, with any closing bracket doubled."""
    return "[" + name.replace("]", "]]") + "]"


def summarize(tables: list[tuple[str, str]], columns_for, count_for, database: str) -> dict:
    """The metadata document. `tables` is (name, type) pairs from the catalog; `columns_for(name)` returns
    (name, type, nullable) tuples; `count_for(name)` returns the row count or None."""
    out_tables = []
    for name, kind in sorted(tables, key=lambda t: t[0].lower()):
        if kind != "TABLE" or name.startswith(SYSTEM_PREFIX):
            continue
        columns = [
            {"name": col, "type": typ, "nullable": bool(nullable)}
            for col, typ, nullable in columns_for(name)
        ]
        out_tables.append({"name": name, "columns": columns, "row_count": count_for(name)})
    return {"format": FORMAT, "database": database, "engine": "Microsoft Access", "tables": out_tables}


def collect(connection, database: str) -> dict:
    """Reads the catalog through an open DB-API style connection. Only COUNT(*) is run against table data."""
    cursor = connection.cursor()
    tables = [(row[2], row[3]) for row in cursor.tables()]
    columns_cache: dict[str, list] = {}

    def columns_for(name):
        cur = connection.cursor()
        columns_cache[name] = [(row[3], row[5], row[10] == 1) for row in cur.columns(table=name)]
        return columns_cache[name]

    def count_for(name):
        try:
            cur = connection.cursor()
            cur.execute(f"SELECT COUNT(*) FROM {quote_name(name)}")
            return int(cur.fetchone()[0])
        except Exception:
            return None

    return summarize(tables, columns_for, count_for, database)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="access_metadata",
                                 description="Write table, field and row-count metadata for an Access database. Read-only.")
    ap.add_argument("--database", required=True, help="Path to the .mdb or .accdb file")
    ap.add_argument("--out", required=True, help="JSON file to write")
    args = ap.parse_args(argv)
    try:
        import pyodbc  # imported here so the rest of this module works without the driver
    except ImportError:
        print("This script needs pyodbc and the Microsoft Access driver. Install them, then run it again.", file=sys.stderr)
        return 2
    conn = pyodbc.connect(connection_string(args.database), readonly=True)
    try:
        document = collect(conn, database=args.database.replace("\\", "/").rsplit("/", 1)[-1])
    finally:
        conn.close()
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(document, fh, indent=2)
    total = len(document["tables"])
    print(f"Wrote {args.out}: {total} tables. Names, types and row counts only; no row values were read.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
