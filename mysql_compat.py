"""Small DB-API compatibility layer for running the SQLite-oriented queries on MySQL."""

from __future__ import annotations

import re
from typing import Any, Optional, Sequence


_INSERT_REPLACE_RE = re.compile(
    r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+([`\w]+)\s*"
    r"\((.*?)\)\s*VALUES\s*\((.*)\)\s*;?\s*$",
    re.IGNORECASE | re.DOTALL,
)
_LIKE_CONCAT_RE = re.compile(
    r"(\?|[`\w.]+)\s+LIKE\s+'%'\s*\|\|\s*(\?|[`\w.]+)\s*\|\|\s*'%'",
    re.IGNORECASE,
)


def _replace_qmark_placeholders(sql: str) -> str:
    """Replace SQLite qmark placeholders outside quoted SQL literals."""
    output = []
    quote: Optional[str] = None
    index = 0

    while index < len(sql):
        char = sql[index]
        if quote:
            output.append(char)
            if char == "\\" and index + 1 < len(sql):
                index += 1
                output.append(sql[index])
            elif char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    index += 1
                    output.append(sql[index])
                else:
                    quote = None
        else:
            if char in {"'", '"', "`"}:
                quote = char
                output.append(char)
            elif char == "?":
                output.append("%s")
            else:
                output.append(char)
        index += 1

    return "".join(output)


def _translate_insert_or_replace(sql: str) -> str:
    match = _INSERT_REPLACE_RE.match(sql)
    if not match:
        return sql

    table, column_sql, value_sql = match.groups()
    columns = [column.strip() for column in column_sql.split(",")]
    assignments = ", ".join(
        f"{column}=VALUES({column})"
        for column in columns
    )
    return (
        f"INSERT INTO {table} ({column_sql}) VALUES ({value_sql}) "
        f"ON DUPLICATE KEY UPDATE {assignments}"
    )


def translate_sqlite_sql(sql: str) -> str:
    """Translate the SQLite syntax still used by the application to MySQL."""
    translated = _translate_insert_or_replace(sql)
    translated = re.sub(
        r"^\s*BEGIN\s+TRANSACTION\s*;?\s*$",
        "START TRANSACTION",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"\bINSERT\s+OR\s+IGNORE\s+INTO\b",
        "INSERT IGNORE INTO",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"\bON\s+CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET\b",
        "ON DUPLICATE KEY UPDATE",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"\bexcluded\.([`\w]+)",
        r"VALUES(\1)",
        translated,
        flags=re.IGNORECASE,
    )
    translated = _LIKE_CONCAT_RE.sub(
        lambda match: (
            f"{match.group(1)} LIKE CONCAT('%', {match.group(2)}, '%')"
        ),
        translated,
    )

    translated = re.sub(
        r"datetime\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*days'\s*\)",
        "DATE_SUB(NOW(), INTERVAL ? DAY)",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"datetime\(\s*'now'\s*,\s*'-(\d+)\s+seconds?'\s*\)",
        r"DATE_SUB(NOW(), INTERVAL \1 SECOND)",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"datetime\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)",
        r"DATE_SUB(NOW(), INTERVAL \1 DAY)",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"\(\s*julianday\(\s*'now'\s*\)\s*-\s*"
        r"julianday\(\s*created_at\s*\)\s*\)\s*\*\s*86400(?:\.0)?",
        "TIMESTAMPDIFF(SECOND, created_at, NOW())",
        translated,
        flags=re.IGNORECASE,
    )
    translated = re.sub(
        r"julianday\(\s*'now'\s*\)\s*-\s*julianday\(\s*created_at\s*\)",
        "(TIMESTAMPDIFF(SECOND, created_at, NOW()) / 86400.0)",
        translated,
        flags=re.IGNORECASE,
    )
    return _replace_qmark_placeholders(translated)


class MySQLCursorAdapter:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    def execute(self, sql: str, params: Optional[Sequence[Any]] = None):
        translated = translate_sqlite_sql(sql)
        return self._cursor.execute(translated, params)

    def executemany(self, sql: str, params: Sequence[Sequence[Any]]):
        translated = translate_sqlite_sql(sql)
        return self._cursor.executemany(translated, params)

    def __iter__(self):
        return iter(self._cursor)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def __getattr__(self, name: str):
        return getattr(self._cursor, name)


class MySQLConnectionAdapter:
    def __init__(self, connection: Any):
        self._connection = connection

    def cursor(self, *args, **kwargs) -> MySQLCursorAdapter:
        self._connection.ping(reconnect=True)
        return MySQLCursorAdapter(self._connection.cursor(*args, **kwargs))

    def commit(self):
        return self._connection.commit()

    def rollback(self):
        return self._connection.rollback()

    def close(self):
        return self._connection.close()

    def __getattr__(self, name: str):
        return getattr(self._connection, name)


def connect_mysql(database_config: dict) -> MySQLConnectionAdapter:
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError(
            "MySQL 模式需要 PyMySQL，请执行 pip install -r requirements.txt"
        ) from exc

    host = str(database_config.get("host", "127.0.0.1"))
    port = int(database_config.get("port", 3306))
    user = str(database_config.get("username", "root"))
    password = str(database_config.get("password", "") or "")
    database = str(database_config.get("database", "xianyu_super_butler"))
    charset = str(database_config.get("charset", "utf8mb4"))
    timezone = str(database_config.get("timezone", "+08:00"))

    common = {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "charset": charset,
        "connect_timeout": int(database_config.get("connect_timeout", 10)),
        "read_timeout": int(database_config.get("read_timeout", 30)),
        "write_timeout": int(database_config.get("write_timeout", 30)),
        "autocommit": False,
    }

    bootstrap = pymysql.connect(**common)
    try:
        safe_database = database.replace("`", "``")
        with bootstrap.cursor() as cursor:
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{safe_database}` "
                f"DEFAULT CHARACTER SET {charset} COLLATE utf8mb4_unicode_ci"
            )
        bootstrap.commit()
    finally:
        bootstrap.close()

    connection = pymysql.connect(
        database=database,
        init_command=f"SET time_zone = '{timezone}'",
        **common,
    )
    return MySQLConnectionAdapter(connection)
