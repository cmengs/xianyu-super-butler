"""从本地日志迁移最近一次成功的消息 Token，不发起任何网络请求。"""

import re
from pathlib import Path

from db_manager import db_manager
from utils.xianyu_utils import generate_device_id, trans_cookies


def main() -> None:
    log_path = Path("logs/xianyu_2026-07-29.log")
    text = log_path.read_text(encoding="utf-8", errors="ignore")
    matches = re.findall(
        r'【(\d+)】\s+响应内容:\s*\{[\s\S]{0,500}?"accessToken"\s*:\s*"([^"]+)"',
        text,
    )
    latest_tokens = {
        cookie_id: token
        for cookie_id, token in matches
    }
    saved = []
    for cookie_id, cookie_value in db_manager.get_all_cookies().items():
        token = latest_tokens.get(str(cookie_id))
        if not token:
            continue
        account_id = trans_cookies(cookie_value).get("unb", cookie_id)
        if db_manager.save_account_ws_token(
            str(cookie_id),
            token,
            generate_device_id(str(account_id)),
        ):
            saved.append(str(cookie_id))

    print(
        "已迁移消息Token缓存账号: "
        + (", ".join(sorted(saved)) if saved else "无")
    )


if __name__ == "__main__":
    main()
