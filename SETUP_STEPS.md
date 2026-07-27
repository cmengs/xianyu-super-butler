# 项目初始化和启动步骤

本文档记录本机对 `xianyu-super-butler` 项目的 Python 环境创建、依赖安装和启动验证过程。

## 1. Python 版本

项目声明的 Python 版本要求：

- `README.md` 徽章和技术栈写明：Python 3.11+
- `requirements.txt` 注释写明：Python 3.11+
- `Dockerfile` 使用：`python:3.11-slim-bookworm`

本机当前用于创建虚拟环境的解释器：

```powershell
C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe --version
```

实际版本为：

```text
Python 3.12.13
```

说明：Python 3.12.13 满足项目的 `3.11+` 要求。如果后续想更贴近 Dockerfile，可以单独安装 Python 3.11 后重新创建 `.venv`。

## 2. 创建虚拟环境

在项目根目录执行：

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m venv .venv
```

检查虚拟环境版本：

```powershell
& '.\.venv\Scripts\python.exe' --version
```

本次创建出的项目虚拟环境版本为：

```text
Python 3.12.13
```

如果要在 PowerShell 中激活环境：

```powershell
.\.venv\Scripts\Activate.ps1
```

也可以不激活，直接使用：

```powershell
.\.venv\Scripts\python.exe
```

## 3. 安装 Python 依赖

在项目根目录执行：

```powershell
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
```

本次安装中遇到过一次网络沙箱限制，授权网络访问后完成安装。若安装中断，再执行同一条命令即可，pip 会跳过已经满足的依赖。

## 4. 安装 Playwright Chromium

项目依赖 Playwright，`requirements.txt` 也提示需要安装 Chromium：

```powershell
& '.\.venv\Scripts\python.exe' -m playwright install chromium
```

本次已安装 Chromium 浏览器运行时。`Start.py` 启动时也会自动检查 Playwright 浏览器是否存在。

## 5. 启动项目

前台启动方式：

```powershell
& '.\.venv\Scripts\python.exe' Start.py
```

项目默认监听：

```text
http://localhost:8080
```

健康检查地址：

```text
http://localhost:8080/health
```

本次已启动成功，并验证：

```text
GET http://localhost:8080/health -> 200 OK
status: healthy
services.cookie_manager: ok
services.database: ok
```

## 6. 常用检查命令

查看 8080 端口占用：

```powershell
cmd /c netstat -ano -p tcp | findstr ":8080"
```

停止占用 8080 的项目进程：

```powershell
Stop-Process -Id <PID> -Force
```

查看本次后台启动日志：

```powershell
Get-Content .\logs\codex-start.out.log -Tail 100
Get-Content .\logs\codex-start.err.log -Tail 100
```

## 7. 本次初始化产生的本地文件

- `.venv/`：项目 Python 虚拟环境
- `data/xianyu_data.db`：首次启动自动创建的 SQLite 数据库
- `logs/codex-start.out.log`：本次后台启动标准输出日志
- `logs/codex-start.err.log`：本次后台启动错误输出日志

## 8. 备注

当前终端中 `python` 和 `py` 命令不在 PATH，所以本文档使用了完整 Python 路径。若你本机已安装 Python 3.11+ 并配置到 PATH，可以把命令简化为：

```powershell
python -m venv .venv
python -m pip install -r requirements.txt
python -m playwright install chromium
python Start.py
```
