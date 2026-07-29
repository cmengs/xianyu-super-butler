#!/usr/bin/env python3
"""Export the project's SQLite database as MySQL-compatible SQL."""

from __future__ import annotations

import argparse
import math
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple


MYSQL_INDEX_TEXT_LENGTH = 191
LONG_TEXT_COLUMNS = {
    "api_config",
    "config",
    "content",
    "custom_prompts",
    "data",
    "data_content",
    "description",
    "error_message",
    "event_description",
    "image_url",
    "item_description",
    "item_detail",
    "last_message",
    "message_payload",
    "processing_result",
    "receiver_address",
    "reply",
    "reply_content",
    "reply_image_url",
    "text_content",
}
BOOLEAN_COLUMN_PREFIXES = ("is_", "can_", "has_", "requires_")
BOOLEAN_COLUMN_NAMES = {
    "enabled",
    "used",
    "auto_confirm",
    "show_browser",
    "system_shipped",
    "multi_quantity_delivery",
}


@dataclass(frozen=True)
class Column:
    cid: int
    name: str
    declared_type: str
    not_null: bool
    default: Any
    pk_position: int


@dataclass(frozen=True)
class Index:
    name: str
    unique: bool
    origin: str
    partial: bool
    columns: Tuple[str, ...]


@dataclass(frozen=True)
class ForeignKey:
    referenced_table: str
    from_column: str
    to_column: str
    on_update: str
    on_delete: str


def quote_identifier(value: str) -> str:
    return f"`{value.replace('`', '``')}`"


def mysql_name(prefix: str, table: str, columns: Sequence[str]) -> str:
    raw = "_".join((prefix, table, *columns))
    return raw[:64]


def load_columns(conn: sqlite3.Connection, table: str) -> List[Column]:
    return [
        Column(
            cid=int(row[0]),
            name=str(row[1]),
            declared_type=str(row[2] or "").upper(),
            not_null=bool(row[3]),
            default=row[4],
            pk_position=int(row[5] or 0),
        )
        for row in conn.execute(f"PRAGMA table_info({quote_identifier(table)})")
    ]


def load_indexes(conn: sqlite3.Connection, table: str) -> List[Index]:
    indexes: List[Index] = []
    for row in conn.execute(f"PRAGMA index_list({quote_identifier(table)})"):
        name = str(row[1])
        columns = tuple(
            str(item[2])
            for item in conn.execute(f"PRAGMA index_info({quote_identifier(name)})")
            if int(item[1]) >= 0 and item[2] is not None
        )
        if columns:
            indexes.append(
                Index(
                    name=name,
                    unique=bool(row[2]),
                    origin=str(row[3] or ""),
                    partial=bool(row[4]),
                    columns=columns,
                )
            )
    return indexes


def load_foreign_keys(conn: sqlite3.Connection, table: str) -> List[ForeignKey]:
    return [
        ForeignKey(
            referenced_table=str(row[2]),
            from_column=str(row[3]),
            to_column=str(row[4]),
            on_update=str(row[5] or "NO ACTION").upper(),
            on_delete=str(row[6] or "NO ACTION").upper(),
        )
        for row in conn.execute(f"PRAGMA foreign_key_list({quote_identifier(table)})")
    ]


def table_order(conn: sqlite3.Connection, tables: Sequence[str]) -> List[str]:
    remaining = set(tables)
    ordered: List[str] = []
    while remaining:
        ready = sorted(
            table
            for table in remaining
            if {
                foreign_key.referenced_table
                for foreign_key in load_foreign_keys(conn, table)
                if foreign_key.referenced_table in remaining
            }.issubset(set(ordered))
        )
        if not ready:
            ordered.extend(sorted(remaining))
            break
        ordered.extend(ready)
        remaining.difference_update(ready)
    return ordered


def indexed_columns(
    conn: sqlite3.Connection,
    tables: Sequence[str],
) -> Dict[str, Set[str]]:
    result: Dict[str, Set[str]] = {table: set() for table in tables}
    for table in tables:
        for column in load_columns(conn, table):
            if column.pk_position:
                result[table].add(column.name)
        for index in load_indexes(conn, table):
            result[table].update(index.columns)
        for foreign_key in load_foreign_keys(conn, table):
            result[table].add(foreign_key.from_column)
            if foreign_key.referenced_table in result:
                result[foreign_key.referenced_table].add(foreign_key.to_column)
    return result


def max_text_length(conn: sqlite3.Connection, table: str, column: str) -> int:
    row = conn.execute(
        f"SELECT MAX(LENGTH({quote_identifier(column)})) "
        f"FROM {quote_identifier(table)}"
    ).fetchone()
    return int(row[0] or 0)


def is_boolean_column(column: Column) -> bool:
    name = column.name.lower()
    return (
        "BOOL" in column.declared_type
        or name in BOOLEAN_COLUMN_NAMES
        or name.startswith(BOOLEAN_COLUMN_PREFIXES)
    )


def mysql_column_type(
    conn: sqlite3.Connection,
    table: str,
    column: Column,
    key_columns: Set[str],
) -> str:
    declared = column.declared_type
    if is_boolean_column(column):
        return "TINYINT(1)"
    if "INT" in declared:
        return "BIGINT"
    if any(token in declared for token in ("REAL", "FLOA", "DOUB")):
        return "DOUBLE"
    if any(token in declared for token in ("BLOB", "BINARY")):
        return "LONGBLOB"
    if any(token in declared for token in ("DATE", "TIME")):
        return "DATETIME"

    if column.name in key_columns:
        return f"VARCHAR({MYSQL_INDEX_TEXT_LENGTH})"

    name = column.name.lower()
    if (
        name in LONG_TEXT_COLUMNS
        or name.endswith("_url")
        or (table == "cookies" and name == "value")
    ):
        return "LONGTEXT"

    actual_length = max_text_length(conn, table, column.name)
    if actual_length <= 255:
        return "VARCHAR(255)"
    if actual_length <= 65535:
        return "TEXT"
    return "LONGTEXT"


def mysql_default(default: Any, mysql_type: str) -> str:
    if default is None or mysql_type in {"TEXT", "LONGTEXT", "LONGBLOB"}:
        return ""
    text = str(default).strip()
    upper = text.upper()
    if upper == "TRUE":
        return " DEFAULT 1"
    if upper == "FALSE":
        return " DEFAULT 0"
    if upper in {"CURRENT_TIMESTAMP", "(CURRENT_TIMESTAMP)"}:
        return " DEFAULT CURRENT_TIMESTAMP"
    return f" DEFAULT {text}"


def table_ddl(
    conn: sqlite3.Connection,
    table: str,
    key_columns_by_table: Dict[str, Set[str]],
) -> str:
    columns = load_columns(conn, table)
    indexes = load_indexes(conn, table)
    foreign_keys = load_foreign_keys(conn, table)
    primary_key = [
        column.name
        for column in sorted(columns, key=lambda item: item.pk_position or 9999)
        if column.pk_position
    ]
    table_sql_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    table_sql = str(table_sql_row[0] or "") if table_sql_row else ""
    sqlite_autoincrement = "AUTOINCREMENT" in table_sql.upper()

    definitions: List[str] = []
    for column in columns:
        mysql_type = mysql_column_type(
            conn,
            table,
            column,
            key_columns_by_table[table],
        )
        auto_increment = (
            sqlite_autoincrement
            and len(primary_key) == 1
            and column.name == primary_key[0]
            and "INT" in column.declared_type
        )
        force_not_null = bool(column.pk_position)
        if table == "keywords" and column.name in {"cookie_id", "keyword", "item_id"}:
            force_not_null = True

        definition = f"  {quote_identifier(column.name)} {mysql_type}"
        if force_not_null or column.not_null or auto_increment:
            definition += " NOT NULL"
        if table == "keywords" and column.name == "item_id":
            definition += " DEFAULT ''"
        else:
            definition += mysql_default(column.default, mysql_type)
        if auto_increment:
            definition += " AUTO_INCREMENT"
        definitions.append(definition)

    if primary_key:
        definitions.append(
            "  PRIMARY KEY ("
            + ", ".join(quote_identifier(column) for column in primary_key)
            + ")"
        )

    seen_unique: Set[Tuple[str, ...]] = set()
    for index in indexes:
        if index.origin == "pk" or index.partial:
            continue
        if index.unique:
            seen_unique.add(index.columns)
        kind = "UNIQUE KEY" if index.unique else "KEY"
        name = index.name
        if name.startswith("sqlite_autoindex_"):
            name = mysql_name("uq" if index.unique else "idx", table, index.columns)
        definitions.append(
            f"  {kind} {quote_identifier(name)} ("
            + ", ".join(quote_identifier(column) for column in index.columns)
            + ")"
        )

    if table == "keywords":
        keyword_scope = ("cookie_id", "keyword", "item_id")
        if keyword_scope not in seen_unique:
            definitions.append(
                "  UNIQUE KEY `uq_keywords_scope` "
                "(`cookie_id`, `keyword`, `item_id`)"
            )

    for position, foreign_key in enumerate(foreign_keys, start=1):
        constraint = mysql_name(
            "fk",
            table,
            (foreign_key.from_column, str(position)),
        )
        definition = (
            f"  CONSTRAINT {quote_identifier(constraint)} "
            f"FOREIGN KEY ({quote_identifier(foreign_key.from_column)}) "
            f"REFERENCES {quote_identifier(foreign_key.referenced_table)} "
            f"({quote_identifier(foreign_key.to_column)})"
        )
        if foreign_key.on_delete not in {"", "NO ACTION"}:
            definition += f" ON DELETE {foreign_key.on_delete}"
        if foreign_key.on_update not in {"", "NO ACTION"}:
            definition += f" ON UPDATE {foreign_key.on_update}"
        definitions.append(definition)

    return (
        f"CREATE TABLE {quote_identifier(table)} (\n"
        + ",\n".join(definitions)
        + "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;"
    )


def mysql_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return f"0x{value.hex()}"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "NULL" if not math.isfinite(value) else repr(value)
    text = str(value)
    if not text:
        return "''"
    return f"CONVERT(0x{text.encode('utf-8').hex()} USING utf8mb4)"


def batched(values: Sequence[Tuple[Any, ...]], size: int) -> Iterable[Sequence[Tuple[Any, ...]]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


def table_data_sql(
    conn: sqlite3.Connection,
    table: str,
    batch_size: int,
) -> List[str]:
    columns = [column.name for column in load_columns(conn, table)]
    rows = list(conn.execute(f"SELECT * FROM {quote_identifier(table)}"))
    statements = [f"-- {table}: {len(rows)} rows"]
    if not rows:
        return statements

    item_id_index = columns.index("item_id") if table == "keywords" else -1
    for batch in batched(rows, batch_size):
        value_rows = []
        for source_row in batch:
            row = list(source_row)
            if item_id_index >= 0 and row[item_id_index] is None:
                row[item_id_index] = ""
            value_rows.append(
                "(" + ", ".join(mysql_value(value) for value in row) + ")"
            )
        statements.append(
            f"INSERT INTO {quote_identifier(table)} ("
            + ", ".join(quote_identifier(column) for column in columns)
            + ") VALUES\n"
            + ",\n".join(value_rows)
            + ";"
        )
    return statements


def export_mysql(
    input_path: Path,
    output_path: Path,
    database: str,
    batch_size: int,
) -> Dict[str, int]:
    source = sqlite3.connect(input_path)
    source.row_factory = sqlite3.Row
    snapshot = sqlite3.connect(":memory:")
    source.backup(snapshot)
    source.close()

    tables = [
        str(row[0])
        for row in snapshot.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name"
        )
    ]
    tables_without_primary_key = [
        table
        for table in tables
        if not any(column.pk_position for column in load_columns(snapshot, table))
    ]
    if tables_without_primary_key:
        snapshot.close()
        raise RuntimeError(
            "MySQL export requires a primary key on every table; missing: "
            + ", ".join(tables_without_primary_key)
        )

    ordered_tables = table_order(snapshot, tables)
    key_columns_by_table = indexed_columns(snapshot, tables)
    row_counts = {
        table: int(
            snapshot.execute(
                f"SELECT COUNT(*) FROM {quote_identifier(table)}"
            ).fetchone()[0]
        )
        for table in ordered_tables
    }

    lines = [
        "-- MySQL export generated from xianyu_data.db",
        "-- Do not import the original SQLite .dump into MySQL.",
        "SET NAMES utf8mb4;",
        "SET FOREIGN_KEY_CHECKS = 0;",
        "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
        f"CREATE DATABASE IF NOT EXISTS {quote_identifier(database)} "
        "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
        f"USE {quote_identifier(database)};",
        "",
    ]
    for table in reversed(ordered_tables):
        lines.append(f"DROP TABLE IF EXISTS {quote_identifier(table)};")
    lines.append("")

    for table in ordered_tables:
        lines.append(table_ddl(snapshot, table, key_columns_by_table))
        lines.append("")

    for table in ordered_tables:
        lines.extend(table_data_sql(snapshot, table, batch_size))
        lines.append("")

    lines.extend(
        [
            "SET FOREIGN_KEY_CHECKS = 1;",
            "",
            "-- Export summary",
            *[
                f"-- {table}: {row_counts[table]} rows"
                for table in ordered_tables
            ],
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    snapshot.close()
    return row_counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export SQLite data as MySQL-compatible SQL."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/xianyu_data.db"),
        help="SQLite database path",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/xianyu_mysql.sql"),
        help="Output SQL path",
    )
    parser.add_argument(
        "--database",
        default="xianyu_super_butler",
        help="Target MySQL database name",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="Rows per INSERT statement",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f"SQLite database does not exist: {args.input}")
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be at least 1")

    row_counts = export_mysql(
        input_path=args.input,
        output_path=args.output,
        database=args.database,
        batch_size=args.batch_size,
    )
    print(f"Generated: {args.output.resolve()}")
    print(f"Tables: {len(row_counts)}, rows: {sum(row_counts.values())}")


if __name__ == "__main__":
    main()
