# SQLite 数据导入 MySQL

项目当前使用 SQLite。SQLite 的 `.dump` 文件不能直接交给 MySQL 执行，其中的
`PRAGMA`、`AUTOINCREMENT`、`TEXT PRIMARY KEY` 和条件索引都不是兼容的 MySQL
语法。

## 生成 MySQL SQL

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe scripts\sqlite_to_mysql.py `
  --input data\xianyu_data.db `
  --output data\xianyu_mysql.sql `
  --database xianyu_super_butler
```

导出工具会：

- 使用 SQLite 在线快照，避免导出期间的数据不一致。
- 将 `PRAGMA foreign_keys = false` 替换为 MySQL 的
  `SET FOREIGN_KEY_CHECKS = 0`。
- 将 SQLite 自增主键转换为 `BIGINT AUTO_INCREMENT`。
- 将参与主键、唯一索引和外键的 `TEXT` 转换为 `VARCHAR(191)`。
- 将 `keywords` 的条件唯一索引转换为 MySQL 可用的复合唯一索引。
- 使用 `utf8mb4` 保存中文和特殊字符。

## 导入

可以在 Navicat 或 MySQL Workbench 中选择“运行 SQL 文件”，执行：

```text
data/xianyu_mysql.sql
```

也可以在 Windows 的 `cmd.exe` 中执行：

```bat
mysql --default-character-set=utf8mb4 -h 127.0.0.1 -P 3306 -u root -p < data\xianyu_mysql.sql
```

生成的 SQL 会创建并使用 `xianyu_super_butler` 数据库。若目标库名称不同，重新运行
导出脚本并修改 `--database`。

## 注意

- SQL 文件包含账号 Cookie、用户数据和配置，请勿公开或提交到 Git。
- 项目通过 `global_config.yml` 的 `DATABASE` 配置选择 MySQL，也可使用
  `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USERNAME`、`DB_PASSWORD` 环境变量覆盖。
- MySQL 模式下不能使用网页中的 SQLite `.db` 文件备份与恢复功能，请使用
  `mysqldump` 和 MySQL 客户端完成备份恢复。
