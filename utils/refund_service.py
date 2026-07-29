"""Read Xianyu refund details through the signed official MTop API."""

import json
import re
import time
from typing import Any, Dict, Optional

import aiohttp

from utils.xianyu_utils import generate_sign, trans_cookies


REFUND_DETAIL_URL = (
    "https://h5.m.goofish.com/wow/moyu/moyu-project/"
    "idle-reverse/pages/refundDetail?kun=true&orderId={order_id}"
)


def _is_success(response: Dict[str, Any]) -> bool:
    return any(str(item).startswith("SUCCESS::") for item in response.get("ret", []))


async def _mtop_request(
    api: str,
    data: Dict[str, Any],
    cookie_string: str,
    version: str = "1.0",
    timeout: int = 30,
) -> Dict[str, Any]:
    data_value = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    timestamp = str(int(time.time() * 1000))
    cookies = trans_cookies(cookie_string)
    token = str(cookies.get("_m_h5_tk") or "").split("_")[0]
    if not token:
        raise RuntimeError("账号 Cookie 缺少 _m_h5_tk，请先更新登录状态")

    params = {
        "jsv": "2.7.2",
        "appKey": "34839810",
        "t": timestamp,
        "sign": generate_sign(timestamp, token, data_value),
        "v": version,
        "type": "originaljson",
        "accountSite": "xianyu",
        "dataType": "json",
        "timeout": str(timeout * 1000),
        "api": api,
        "sessionOption": "AutoLoginOnly",
    }
    headers = {
        "accept": "application/json",
        "accept-language": "zh-CN,zh;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "origin": "https://h5.m.goofish.com",
        "referer": "https://h5.m.goofish.com/",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/138.0.0.0 Safari/537.36"
        ),
        "cookie": cookie_string,
    }
    url = f"https://h5api.m.goofish.com/h5/{api}/{version}/"

    client_timeout = aiohttp.ClientTimeout(total=timeout)
    async with aiohttp.ClientSession(timeout=client_timeout) as session:
        async with session.post(
            url,
            params=params,
            data={"data": data_value},
            headers=headers,
        ) as response:
            response_text = await response.text()

    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("闲鱼退款接口返回了无法解析的数据") from exc

    if not _is_success(payload):
        error_text = "；".join(str(item) for item in payload.get("ret", []))
        if "TOKEN" in error_text.upper():
            raise RuntimeError("闲鱼登录凭证已过期，请先更新账号 Cookie")
        raise RuntimeError(error_text or "闲鱼退款接口调用失败")
    return payload


def _component_data(components: list[Dict[str, Any]], render: str) -> Any:
    for component in components:
        if component.get("render") == render:
            return component.get("data")
    return None


def _rich_text_content(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    lines = []
    for block in value:
        content = "".join(
            str(piece.get("content") or "")
            for piece in (block.get("data") or [])
            if piece.get("type") == "TEXT"
        ).strip()
        if content:
            lines.append(content)
    return "\n".join(lines)


async def _fetch_reject_options(
    refund_id: str,
    cookie_string: str,
    timeout: int,
) -> list[Dict[str, str]]:
    if not refund_id:
        return []
    payload = await _mtop_request(
        "mtop.taobao.idle.refund.refuse.render",
        {"refundId": refund_id},
        cookie_string,
        timeout=timeout,
    )
    data = ((payload.get("data") or {}).get("data") or {})
    return [
        {
            "id": str(item.get("refuseReasonId") or item.get("reasonId") or ""),
            "name": str(item.get("reasonName") or ""),
        }
        for item in data.get("refuseReasonList", [])
        if item.get("reasonName")
    ]


async def fetch_refund_detail(
    order_id: str,
    cookie_id: str,
    cookie_string: str,
    timeout: int = 30,
) -> Dict[str, Any]:
    """Fetch refund reason, progress and seller actions."""
    del cookie_id
    if not re.fullmatch(r"\d{10,}", str(order_id or "")):
        raise ValueError("订单号格式无效")

    payload = await _mtop_request(
        "mtop.taobao.idle.refund.detail",
        {"orderId": str(order_id), "refundId": ""},
        cookie_string,
        timeout=timeout,
    )
    data = ((payload.get("data") or {}).get("data") or {})
    components = data.get("components") or []
    refund_info = _component_data(components, "refundInfo") or {}
    status_info = _component_data(components, "refundStatusInfo") or {}
    bottom_bar = _component_data(components, "bottomBar") or []
    refund_id = str(refund_info.get("refundId") or data.get("refundId") or "")
    action_codes = {
        str(button.get("code") or ""): button
        for button in bottom_bar
        if isinstance(button, dict)
    }
    can_approve = "agreeRefundApply" in action_codes
    can_reject = "rejectApply" in action_codes
    reject_options = (
        await _fetch_reject_options(refund_id, cookie_string, timeout)
        if can_reject
        else []
    )
    return {
        "order_id": str(order_id),
        "refund_id": refund_id,
        "refund_reason": str(refund_info.get("refundReason") or ""),
        "refund_description": "",
        "refund_amount": str(refund_info.get("refundAmount") or ""),
        "refund_type": str(refund_info.get("refundType") or ""),
        "refund_requested_at": str(refund_info.get("refundApplyTime") or ""),
        "page_status": str(status_info.get("title") or ""),
        "page_status_description": _rich_text_content(status_info.get("descRichText")),
        "detail_url": REFUND_DETAIL_URL.format(order_id=order_id),
        "can_approve": can_approve,
        "can_reject": can_reject,
        "reject_options": reject_options,
        "requires_app_action": True,
    }


async def execute_refund_action(
    order_id: str,
    cookie_id: str,
    cookie_string: str,
    action: str,
    reject_reason: Optional[str] = None,
    reject_description: Optional[str] = None,
    timeout: int = 30,
) -> Dict[str, Any]:
    """Submit a rejection or hand approval off to Xianyu's security flow."""
    detail = await fetch_refund_detail(
        order_id=order_id,
        cookie_id=cookie_id,
        cookie_string=cookie_string,
        timeout=timeout,
    )
    refund_id = str(detail.get("refund_id") or "")
    if not refund_id:
        raise RuntimeError("未获取到退款单号，请刷新退款详情后重试")

    if action == "approve":
        if not detail.get("can_approve"):
            raise RuntimeError("该退款申请当前不能确认退款，请刷新后重试")
        return {
            "success": False,
            "requires_app": True,
            "message": "确认退款需要闲鱼 App 的支付宝密码验证，已打开官方处理页。",
            "detail_url": detail.get("detail_url"),
        }

    if not detail.get("can_reject"):
        raise RuntimeError("该退款申请当前不能拒绝，请刷新后重试")

    reason_id = str(reject_reason or "").strip()
    options = detail.get("reject_options") or []
    selected = next(
        (option for option in options if str(option.get("id") or "") == reason_id),
        None,
    )
    if not selected:
        raise ValueError("请选择有效的拒绝退款原因")

    proof = {
        "desc": str(reject_description or "").strip(),
        "proofMultiMediaList": [],
    }
    payload = await _mtop_request(
        "mtop.taobao.idle.refund.refuse",
        {
            "refundId": refund_id,
            "refuseReasonId": reason_id,
            "refuseProof": json.dumps(
                proof,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        },
        cookie_string,
        timeout=timeout,
    )
    result_data = ((payload.get("data") or {}).get("data") or {})
    if isinstance(result_data, dict) and result_data.get("success") is False:
        raise RuntimeError(str(result_data.get("message") or "闲鱼拒绝退款失败"))

    return {
        "success": True,
        "confirmed": True,
        "requires_app": False,
        "message": f"已拒绝退款：{selected.get('name')}",
        "detail_url": detail.get("detail_url"),
    }
