import asyncio
import json
import random
import time
from typing import Any

from loguru import logger

from utils.xianyu_utils import generate_sign, trans_cookies


class ItemPolishModule:
    """闲鱼在售商品手动擦亮。"""

    def __init__(self, runtime: Any):
        self.runtime = runtime

    async def _sync_cookies_from_response(self, response: Any) -> None:
        if 'set-cookie' not in response.headers:
            return

        new_cookies = {}
        for cookie in response.headers.getall('set-cookie', []):
            if '=' not in cookie:
                continue
            name, value = cookie.split(';')[0].split('=', 1)
            new_cookies[name.strip()] = value.strip()

        if not new_cookies:
            return

        self.runtime.cookies.update(new_cookies)
        self.runtime.cookies_str = '; '.join(
            f"{key}={value}"
            for key, value in self.runtime.cookies.items()
        )
        if self.runtime.session:
            self.runtime.session.headers['cookie'] = self.runtime.cookies_str
        await self.runtime.update_config_cookies()

    def _build_polish_request(
        self,
        api_name: str,
        item_id: Any,
    ) -> tuple[dict[str, str], dict[str, str]]:
        params = {
            'jsv': '2.7.2',
            'appKey': '34839810',
            't': str(int(time.time()) * 1000),
            'sign': '',
            'v': '1.0',
            'type': 'originaljson',
            'accountSite': 'xianyu',
            'dataType': 'json',
            'timeout': '20000',
            'api': api_name,
            'sessionOption': 'AutoLoginOnly',
            'spm_cnt': 'a21ybx.im.0.0',
            'spm_pre': 'a21ybx.collection.menu.1.272b5141NafCNK',
        }
        cookies = trans_cookies(self.runtime.cookies_str)
        token_cookie = cookies.get('_m_h5_tk', '')
        token = token_cookie.split('_')[0] if token_cookie else ''
        data_value = json.dumps(
            {'itemId': str(item_id)},
            separators=(',', ':'),
        )
        params['sign'] = generate_sign(params['t'], token, data_value)
        return params, {'data': data_value}

    async def _request_polish(
        self,
        api_name: str,
        item_id: Any,
    ) -> dict[str, Any]:
        if not self.runtime.session:
            await self.runtime.create_session()

        params, payload = self._build_polish_request(api_name, item_id)
        endpoint = f"https://h5api.m.goofish.com/h5/{api_name}/1.0/"
        async with self.runtime.session.post(
            endpoint,
            params=params,
            data=payload,
        ) as response:
            result = await response.json()
            await self._sync_cookies_from_response(response)
            ret_list = result.get('ret') or []
            ret_message = str(ret_list[0] if ret_list else '')
            already_polished = (
                'FAIL_BIZ_IDLEITEM_POLISH_AGAIN' in ret_message
                or '已经擦亮过' in ret_message
                or '已擦亮' in ret_message
            )
            return {
                'success': 'SUCCESS' in ret_message or '调用成功' in ret_message,
                'already_polished': already_polished,
                'item_id': str(item_id),
                'ret': ret_message,
            }

    async def polish_item(
        self,
        item_id: Any,
        retry_count: int = 0,
    ) -> dict[str, Any]:
        """擦亮单个商品，主接口失败后尝试备用接口。"""
        if retry_count >= 3:
            return {
                'success': False,
                'item_id': str(item_id),
                'error': '重试次数过多',
            }

        try:
            result = await self._request_polish(
                'mtop.taobao.idle.item.polish',
                item_id,
            )
            if result['success']:
                logger.info(f"【{self.runtime.cookie_id}】擦亮商品 {item_id} 成功")
                return result
            if result.get('already_polished'):
                logger.info(
                    f"【{self.runtime.cookie_id}】商品 {item_id} 今日已经擦亮"
                )
                return result

            ret_message = result.get('ret', '')
            token_expired = (
                'FAIL_SYS_TOKEN_EXOIRED' in ret_message
                or 'FAIL_SYS_TOKEN_EXPIRED' in ret_message
                or 'token' in ret_message.lower()
            )
            if token_expired:
                await asyncio.sleep(0.5)
                return await self.polish_item(item_id, retry_count + 1)

            backup = await self._request_polish(
                'mtop.idle.item.polish',
                item_id,
            )
            if backup['success']:
                logger.info(f"【{self.runtime.cookie_id}】备用接口擦亮商品 {item_id} 成功")
                return backup

            return {
                'success': False,
                'item_id': str(item_id),
                'error': backup.get('ret') or ret_message or '擦亮失败',
            }
        except Exception as exc:
            logger.warning(
                f"【{self.runtime.cookie_id}】擦亮商品 {item_id} 异常: "
                f"{self.runtime._safe_str(exc)}"
            )
            await asyncio.sleep(0.5)
            return await self.polish_item(item_id, retry_count + 1)

    async def polish_all_items(self) -> dict[str, Any]:
        """获取当前账号全部在售商品并逐个擦亮。"""
        all_items_result = await self.runtime.get_all_items()
        if not all_items_result.get('success'):
            return {
                'success': False,
                'message': (
                    f"获取商品列表失败: "
                    f"{all_items_result.get('error', '未知错误')}"
                ),
                'total': 0,
                'polished': 0,
                'already_polished': 0,
                'failed': 0,
                'results': [],
            }

        items = all_items_result.get('items') or []
        results = []
        polished = 0
        already_polished = 0
        failed = 0

        for index, item in enumerate(items):
            item_id = item.get('id') or item.get('item_id')
            if not item_id:
                continue
            result = await self.polish_item(item_id)
            results.append(result)
            if result.get('success'):
                polished += 1
            elif result.get('already_polished'):
                already_polished += 1
            else:
                failed += 1
            if index < len(items) - 1:
                await asyncio.sleep(random.uniform(1, 3))

        total = len(results)
        message = (
            f"一键擦亮完成：本次成功 {polished}，"
            f"今日已擦亮 {already_polished}，失败 {failed}"
        )
        logger.info(f"【{self.runtime.cookie_id}】{message}")
        return {
            'success': failed == 0,
            'message': message,
            'total': total,
            'polished': polished,
            'already_polished': already_polished,
            'failed': failed,
            'results': results,
        }
