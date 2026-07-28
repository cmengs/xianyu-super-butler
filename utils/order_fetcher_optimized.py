"""
订单获取优化模块
合并订单状态查询和订单详情获取，减少浏览器启动次数
"""
import asyncio
import time
import json
import re
from typing import Dict, Any, Optional, List
from playwright.async_api import Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError
from loguru import logger
from collections import defaultdict

from utils.browser_pool import get_browser_pool


class OrderFetcherOptimized:
    """
    优化的订单获取器

    特性:
    - 一次浏览器访问同时获取订单状态和订单详情
    - 使用浏览器池复用实例
    - 同时监听API响应和解析DOM
    """

    # 类级别的锁字典，为每个order_id维护一个锁
    _order_locks = defaultdict(lambda: asyncio.Lock())

    def __init__(self, cookie_id: str, cookie_string: str, use_pool: bool = True):
        """
        初始化订单获取器

        Args:
            cookie_id: Cookie ID
            cookie_string: Cookie字符串
            use_pool: 是否使用浏览器池（默认True）
        """
        self.cookie_id = cookie_id
        self.cookie_string = cookie_string
        self.use_pool = use_pool
        self.api_responses = []

        # 浏览器实例
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    async def fetch_order_complete(
        self,
        order_id: str,
        timeout: int = 30,
        headless: bool = True,
        force_refresh: bool = False  # 强制刷新，跳过缓存检查
    ) -> Optional[Dict[str, Any]]:
        """
        获取完整的订单信息（优化版：一次浏览器访问）

        在一次浏览器访问中同时：
        1. 拦截API获取订单状态、买家ID、商品ID
        2. 解析DOM获取收货人信息、金额、规格

        Args:
            order_id: 订单ID
            timeout: 超时时间（秒）
            headless: 是否无头模式

        Returns:
            完整的订单信息字典，失败返回None
        """
        # 获取该订单ID的锁
        order_lock = self._order_locks[order_id]

        async with order_lock:
            logger.info(f"获取订单 {order_id} 的锁，开始处理...")

            try:
                # 首先查询数据库中是否已存在该订单
                from db_manager import db_manager
                existing_order = db_manager.get_order_by_id(order_id)

                if existing_order:
                    # 检查金额字段是否有效
                    amount = existing_order.get('amount', '')
                    amount_valid = False

                    if amount:
                        amount_clean = str(amount).replace('¥', '').replace('￥', '').replace('$', '').strip()
                        try:
                            amount_value = float(amount_clean)
                            amount_valid = amount_value > 0
                        except (ValueError, TypeError):
                            amount_valid = False

                    # 获取收货人信息（不作为判断是否刷新的条件）
                    receiver_name = existing_order.get('receiver_name', '')
                    receiver_phone = existing_order.get('receiver_phone', '')
                    receiver_address = existing_order.get('receiver_address', '')

                    current_status = existing_order.get('order_status') or existing_order.get('status') or ''
                    cache_safe_statuses = {'completed'}

                    # 已取消可能是中间事件误判，后续同单消息仍需重新读取状态。
                    if amount_valid and not force_refresh and current_status in cache_safe_statuses:
                        logger.info(f"[CLIPBOARD] 订单 {order_id} 已存在于数据库中且金额有效，状态为{current_status}，直接返回缓存数据")
                        print(f"[OK] 订单 {order_id} 使用缓存数据")

                        result = {
                            'order_id': existing_order['order_id'],
                            'url': f"https://www.goofish.com/order-detail?orderId={order_id}&role=seller",
                            'title': f"订单详情 - {order_id}",
                            'order_status': existing_order.get('order_status', 'unknown'),
                            'status_text': existing_order.get('status_text', ''),
                            'item_title': existing_order.get('item_title', ''),
                            'spec_name': existing_order.get('spec_name', ''),
                            'spec_value': existing_order.get('spec_value', ''),
                            'quantity': existing_order.get('quantity', ''),
                            'amount': existing_order.get('amount', ''),
                            'order_time': existing_order.get('created_at', ''),
                            'receiver_name': receiver_name,
                            'receiver_phone': receiver_phone,
                            'receiver_address': receiver_address,
                            'receiver_city': existing_order.get('receiver_city', ''),
                            'buyer_id': existing_order.get('buyer_id', ''),
                            'item_id': existing_order.get('item_id', ''),
                            'can_rate': existing_order.get('can_rate', False),
                            'timestamp': time.time(),
                            'from_cache': True
                        }
                        return result
                    else:
                        if not amount_valid:
                            logger.info(f"[CLIPBOARD] 订单 {order_id} 金额无效({amount})，需要重新获取")
                            print(f"[WARNING] Order {order_id} amount invalid, refetching...")
                        elif force_refresh:
                            logger.info(f"[CLIPBOARD] 订单 {order_id} 强制刷新，跳过缓存")
                        else:
                            logger.info(f"[CLIPBOARD] 订单 {order_id} 金额有效但状态为{current_status or 'unknown'}，需要重新获取最新状态")

                # 获取浏览器实例（使用浏览器池或创建新实例）
                if self.use_pool:
                    logger.info(f"从浏览器池获取浏览器实例...")
                    browser_pool = get_browser_pool()
                    result = await browser_pool.get_browser(self.cookie_id, self.cookie_string, headless)

                    if not result:
                        logger.error("从浏览器池获取浏览器失败")
                        return None

                    self.browser, self.context, self.page = result
                else:
                    logger.error("非池模式暂未实现")
                    return None

                # 访问订单详情页面
                url = f"https://www.goofish.com/order-detail?orderId={order_id}&role=seller"
                logger.info(f"访问订单详情页面: {url}")
                # print(f"[BROWSER] Accessing page: {url}")  # 已移除

                self.api_responses = []
                api_response_future = asyncio.get_running_loop().create_future()

                async def capture_order_detail_response(api_response):
                    if 'mtop.idle.web.trade.order.detail' not in api_response.url:
                        return

                    try:
                        api_body = await api_response.text()
                        parsed_response = self._parse_mtop_response_text(api_body)
                        self.api_responses.append(parsed_response)
                        if not api_response_future.done():
                            api_response_future.set_result(parsed_response)
                        logger.info("[ORDER_FETCH] order detail API response captured")
                    except Exception as e:
                        logger.warning(f"[ORDER_FETCH] failed to read order detail API response, fallback to DOM: {e}")
                        if not api_response_future.done():
                            api_response_future.set_result(None)

                def on_response(api_response):
                    asyncio.create_task(capture_order_detail_response(api_response))

                self.page.on('response', on_response)

                response = await self.page.goto(url, wait_until='domcontentloaded', timeout=timeout * 1000)

                if not response or response.status != 200:
                    logger.error(f"页面访问失败，状态码: {response.status if response else 'None'}")
                    return None

                logger.info(f"页面访问成功，状态码: {response.status}")

                # 等待API响应和页面渲染
                logger.info("等待API响应和页面渲染...")
                try:
                    await asyncio.wait_for(asyncio.shield(api_response_future), timeout=max(timeout, 30))
                    logger.info("[拦截] 订单详情API响应已保存")
                except asyncio.TimeoutError:
                    logger.warning("等待订单详情API响应超时，仅使用DOM解析数据")
                except Exception as e:
                    logger.warning(f"读取订单详情API响应失败，仅使用DOM解析数据: {e}")

                await asyncio.sleep(1)

                # 快速滚动，触发延迟加载的内容
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(0.5)
                await self.page.evaluate('window.scrollTo(0, 0)')
                await asyncio.sleep(1)

                if not self.api_responses and not api_response_future.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(api_response_future), timeout=5)
                        logger.info("[拦截] 滚动后订单详情API响应已保存")
                    except asyncio.TimeoutError:
                        logger.warning("滚动后仍未等到订单详情API响应，仅使用DOM解析数据")
                    except Exception as e:
                        logger.warning(f"滚动后读取订单详情API响应失败，仅使用DOM解析数据: {e}")

                try:
                    self.page.remove_listener('response', on_response)
                except Exception:
                    pass

                # 解析API响应数据
                api_data = {}
                if self.api_responses:
                    logger.info(f"拦截到 {len(self.api_responses)} 个API响应")
                    api_result = self.api_responses[0]

                    if api_result.get('ret') and api_result['ret'][0].startswith('SUCCESS'):
                        order_data = api_result.get('data', {})
                        api_data = self._parse_api_response(order_data)
                        logger.info(f"API数据解析成功: {api_data.keys()}")
                    else:
                        logger.warning(f"API响应失败: {api_result.get('ret', ['未知错误'])[0]}")
                else:
                    logger.warning("未拦截到API响应，仅使用DOM解析数据")

                # 解析DOM数据
                dom_data = await self._parse_dom_content()
                logger.info(f"DOM数据解析成功: {dom_data.keys()}")

                # 合并数据（API数据优先，DOM数据补充）
                result = {
                    'order_id': order_id,
                    'url': url,
                    'title': await self.page.title() if self.page else f"订单详情 - {order_id}",
                    'timestamp': time.time(),
                    'from_cache': False
                }

                # 从API获取的数据
                # 优先使用DOM检测的状态，API状态作为fallback
                api_status = api_data.get('order_status', 'unknown')
                dom_status = dom_data.get('order_status_dom', None)

                # 添加调试信息
                result['api_status'] = api_status
                result['dom_status'] = dom_status if dom_status else 'not_detected'

                if dom_status and dom_status != 'unknown':
                    result['order_status'] = dom_status
                    logger.info(f"使用DOM检测的订单状态: {dom_status}")
                else:
                    result['order_status'] = api_status
                    logger.info(f"使用API的订单状态: {api_status}")
                result['status_text'] = api_data.get('status_text', '')
                result['item_title'] = api_data.get('item_title', '')
                result['buyer_id'] = api_data.get('buyer_id', '')
                result['buyer_nick'] = api_data.get('buyer_nick', '')
                result['item_id'] = api_data.get('item_id', '')
                result['can_rate'] = api_data.get('can_rate', False)

                # 从DOM获取的数据（更可靠）
                result['spec_name'] = dom_data.get('spec_name', '')
                result['spec_value'] = dom_data.get('spec_value', '')
                result['quantity'] = dom_data.get('quantity', api_data.get('quantity', '1'))
                result['amount'] = dom_data.get('amount', api_data.get('amount') or api_data.get('price', ''))
                result['order_time'] = dom_data.get('order_time', api_data.get('order_time', ''))
                result['receiver_name'] = dom_data.get('receiver_name', api_data.get('receiver_name', ''))
                result['receiver_phone'] = dom_data.get('receiver_phone', api_data.get('receiver_phone', ''))
                result['receiver_address'] = dom_data.get('receiver_address', api_data.get('receiver_address', ''))
                result['receiver_city'] = api_data.get('receiver_city', '')

                logger.info(f"订单 {order_id} 完整信息获取成功")
                # print(f"[OK] 订单 {order_id} 信息获取成功")  # 已移除

                return result

            except Exception as e:
                logger.error(f"获取订单完整信息失败: {e}")
                # print(f"[FAIL] 获取订单 {order_id} 失败: {e}")  # 已移除
                return None
            finally:
                # 清理：关闭页面（因为浏览器池为每个请求创建新页面）
                if self.page and self.use_pool:
                    try:
                        await self.page.close()
                        logger.debug(f"已关闭页面: {order_id}")
                    except Exception as e:
                        logger.debug(f"关闭页面失败: {e}")
                    self.page = None

    def _parse_mtop_response_text(self, response_text: str) -> Dict[str, Any]:
        """Parse JSON or JSONP returned by Xianyu mtop endpoints."""
        text = (response_text or '').strip()
        if text.startswith('mtopjsonp'):
            start = text.find('(')
            end = text.rfind(')')
            if start != -1 and end != -1 and end > start:
                text = text[start + 1:end]
        return json.loads(text)

    def _parse_api_response(self, order_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        解析API响应数据

        Args:
            order_data: API返回的订单数据

        Returns:
            解析后的数据字典
        """
        result = {}

        try:
            # 定义状态码映射（与 reply_server.py 保持一致）
            STATUS_CODE_MAP = {
                '1': 'pending_payment',
                '2': 'pending_ship',
                '3': 'shipped',
                '4': 'completed',
                '5': 'refunding',
                '6': 'cancelled',
                '7': 'refunding',
                '8': 'cancelled',
                '9': 'refunding',
                '10': 'cancelled',
                '11': 'completed',  # 交易完成
                '12': 'cancelled',  # 交易关闭
            }

            # 提取订单状态
            status_code = order_data.get('status', 'unknown')
            # 如果是字符串状态，直接使用；如果是数字，映射到字符串
            if isinstance(status_code, str):
                if status_code in ['processing', 'pending_ship', 'shipped', 'completed', 'cancelled', 'refunding', 'unknown']:
                    result['order_status'] = status_code
                elif status_code.isdigit():
                    result['order_status'] = STATUS_CODE_MAP.get(status_code, 'unknown')
                else:
                    result['order_status'] = status_code
            else:
                # 是数字，需要映射
                result['order_status'] = STATUS_CODE_MAP.get(str(status_code), 'unknown')

            ut_args = order_data.get('utArgs', {}) or {}
            result['status_text'] = (
                ut_args.get('orderMainTitle')
                or ut_args.get('orderStatusName')
                or ''
            )
            clean_status_text = re.sub(r'\s+', '', result['status_text'])
            if clean_status_text:
                if any(keyword in clean_status_text for keyword in ('退款成功', '钱款已原路退返', '已原路退返', '交易关闭')):
                    result['order_status'] = 'cancelled'
                elif (
                    '退款' in clean_status_text
                    and any(keyword in clean_status_text for keyword in ('申请', '发起', '处理中', '协商', '售后', '待处理'))
                    and not any(keyword in clean_status_text for keyword in ('撤销', '取消申请', '关闭', '拒绝', '成功'))
                ):
                    result['order_status'] = 'refunding'
                elif '退款' in clean_status_text and any(keyword in clean_status_text for keyword in ('撤销', '取消申请', '关闭', '拒绝')):
                    result['order_status'] = 'shipped'
                elif any(keyword in clean_status_text for keyword in ('关闭', '取消')):
                    result['order_status'] = 'cancelled'
            result['buyer_id'] = str(order_data.get('peerUserId') or '')
            result['item_id'] = str(order_data.get('itemId') or '')

            # 提取商品信息
            components = order_data.get('components', [])
            for component in components:
                render = component.get('render')
                data = component.get('data', {}) or {}

                if render == 'orderStatusVO':
                    status_info = data.get('orderStatusInfo', {}) or {}
                    status_title = status_info.get('title') or ''
                    if status_title:
                        result['status_text'] = status_title
                        clean_status_title = re.sub(r'\s+', '', status_title)
                        if any(keyword in clean_status_title for keyword in ('退款成功', '钱款已原路退返', '已原路退返', '交易关闭')):
                            result['order_status'] = 'cancelled'
                        elif (
                            '退款' in clean_status_title
                            and any(keyword in clean_status_title for keyword in ('申请', '发起', '处理中', '协商', '售后', '待处理'))
                            and not any(keyword in clean_status_title for keyword in ('撤销', '取消申请', '关闭', '拒绝', '成功'))
                        ):
                            result['order_status'] = 'refunding'
                        elif '退款' in clean_status_title and any(keyword in clean_status_title for keyword in ('撤销', '取消申请', '关闭', '拒绝')):
                            result['order_status'] = 'shipped'
                        elif '关闭' in status_title or '取消' in status_title:
                            result['order_status'] = 'cancelled'
                        elif '待付款' in status_title or '等待买家付款' in status_title:
                            result['order_status'] = 'pending_payment'
                        elif '待发货' in status_title or '买家已付款' in status_title:
                            result['order_status'] = 'pending_ship'
                        elif '待收货' in status_title or '已发货' in status_title:
                            result['order_status'] = 'shipped'
                        elif '退款' in status_title:
                            result['order_status'] = 'refunding'
                        elif '完成' in status_title or '成功' in status_title:
                            result['order_status'] = 'completed'

                elif render == 'addressInfoVO':
                    result['receiver_name'] = data.get('name', '') or ''
                    result['receiver_phone'] = data.get('phoneNumber', '') or ''
                    result['receiver_address'] = data.get('address', '') or ''

                elif render == 'orderInfoVO':
                    # 商品信息
                    item_info = data.get('itemInfo', {}) or {}
                    result['item_title'] = item_info.get('title', '') or ''
                    result['item_id'] = str(item_info.get('itemId') or result.get('item_id') or '')
                    result['quantity'] = item_info.get('buyAmount') or result.get('quantity') or '1'

                    # 价格信息
                    price_info = data.get('priceInfo', {}) or {}
                    amount = price_info.get('amount', {}) or {}
                    result['amount'] = amount.get('value') or item_info.get('price') or ''
                    result['price'] = result['amount']

                    for bill in price_info.get('billList', []) or []:
                        if bill.get('code') == 'ITEM_TOTAL_FEE' and not result.get('amount'):
                            result['amount'] = bill.get('value', '')
                            result['price'] = result['amount']

                    for info in data.get('orderInfoList', []) or []:
                        title = info.get('title', '')
                        value = info.get('value', '')
                        if title == '买家昵称':
                            result['buyer_nick'] = value or ''
                        elif title == '下单时间':
                            result['order_time'] = value or ''

                    # 收货地址信息
                    address_info = data.get('addressInfo', {})
                    if address_info:
                        result['receiver_name'] = address_info.get('receiverName', '')
                        result['receiver_phone'] = address_info.get('receiverMobile', '')

                        # 构建完整地址
                        province = address_info.get('province', '')
                        city = address_info.get('city', '')
                        district = address_info.get('district', '')
                        detail_address = address_info.get('detailAddress', '')
                        full_address = address_info.get('fullAddress', '')

                        result['receiver_city'] = city

                        if full_address:
                            result['receiver_address'] = full_address
                        elif province or city or district or detail_address:
                            address_parts = [p for p in [province, city, district, detail_address] if p]
                            result['receiver_address'] = ' '.join(address_parts)

                    # 买家ID
                    buyer_info = data.get('buyerInfo', {})
                    result['buyer_id'] = str(buyer_info.get('userId') or result.get('buyer_id') or '')

            # 检查是否可评价
            bottom_bar = order_data.get('bottomBarVO', {})
            button_list = bottom_bar.get('buttonList', [])
            result['can_rate'] = any(btn.get('tradeAction') == 'RATE' for btn in button_list)

        except Exception as e:
            logger.error(f"解析API响应失败: {e}")

        return result

    async def _parse_dom_content(self) -> Dict[str, Any]:
        """
        解析页面DOM内容

        Returns:
            解析后的数据字典
        """
        result = {}

        try:
            # 获取金额
            amount_selector = '.boldNum--JgEOXfA3'
            amount_element = await self.page.query_selector(amount_selector)
            if amount_element:
                amount_text = await amount_element.text_content()
                if amount_text:
                    result['amount'] = amount_text.strip()
                    logger.info(f"找到金额: {result['amount']}")

            # 获取订单时间
            await self._get_order_time(result)

            # 获取收货人信息
            await self._get_receiver_info(result)

            # 获取SKU信息
            sku_selector = '.sku--u_ddZval'
            sku_elements = await self.page.query_selector_all(sku_selector)
            logger.info(f"找到 {len(sku_elements)} 个sku元素")

            if len(sku_elements) >= 1:
                # 第一个元素是规格
                spec_content = await sku_elements[0].text_content()
                if spec_content and ':' in spec_content:
                    parts = spec_content.split(':', 1)
                    result['spec_name'] = parts[0].strip()
                    result['spec_value'] = parts[1].strip()
                    logger.info(f"规格: {result['spec_name']} = {result['spec_value']}")

            if len(sku_elements) >= 2:
                # 第二个元素是数量
                quantity_content = await sku_elements[1].text_content()
                if quantity_content:
                    if ':' in quantity_content:
                        quantity_value = quantity_content.split(':', 1)[1].strip()
                    else:
                        quantity_value = quantity_content.strip()

                    # 去掉 'x' 符号
                    if quantity_value.startswith('x'):
                        quantity_value = quantity_value[1:]

                    result['quantity'] = quantity_value
                    logger.info(f"数量: {result['quantity']}")

            # 确保数量字段存在
            if 'quantity' not in result:
                result['quantity'] = '1'

            # 获取订单状态（使用JavaScript分析页面）
            result['order_status_dom'] = await self._get_order_status()
            await self._parse_body_text_fallback(result)
            logger.info(f"DOM检测到的订单状态: {result['order_status_dom']}")

        except Exception as e:
            logger.error(f"解析DOM内容失败: {e}")

        return result

    async def _parse_body_text_fallback(self, result: Dict[str, str]) -> None:
        """从新版闲鱼订单详情页的可见文本中兜底提取字段。"""
        try:
            body_text = await self.page.inner_text('body')
            lines = [line.strip() for line in body_text.splitlines() if line.strip()]

            def set_if_missing(key: str, value: str) -> None:
                value = (value or '').strip()
                if value and not result.get(key):
                    result[key] = value

            def next_value(label: str) -> str:
                for i, line in enumerate(lines):
                    if line == label or label in line:
                        for candidate in lines[i + 1:i + 5]:
                            if candidate not in {'复制', '查看', '修改价格', '取消订单', '联系卖家'}:
                                return candidate
                return ''

            status_candidates = [
                ('退款成功，钱款已原路退返', 'cancelled'),
                ('钱款已原路退返', 'cancelled'),
                ('未付款，买家关闭了订单', 'cancelled'),
                ('未付款，买家关闭订单', 'cancelled'),
                ('买家关闭了订单', 'cancelled'),
                ('买家关闭订单', 'cancelled'),
                ('交易关闭', 'cancelled'),
                ('订单已关闭', 'cancelled'),
                ('买家取消', 'cancelled'),
                ('卖家取消', 'cancelled'),
                ('买家撤销退款申请', 'shipped'),
                ('撤销退款申请', 'shipped'),
                ('我发起了退款申请', 'refunding'),
                ('退款申请', 'refunding'),
                ('申请退款', 'refunding'),
                ('退款中', 'refunding'),
                ('退款协商', 'refunding'),
                ('等待买家付款', 'pending_payment'),
                ('买家拍下了宝贝', 'pending_payment'),
                ('买家已付款', 'pending_ship'),
                ('等待卖家发货', 'pending_ship'),
                ('卖家已发货', 'shipped'),
                ('待买家确认收货', 'shipped'),
                ('交易成功', 'completed'),
                ('订单完成', 'completed'),
                ('交易完成', 'completed'),
            ]
            if result.get('order_status_dom') in (None, '', 'unknown'):
                for text, status in status_candidates:
                    if text in body_text:
                        result['order_status_dom'] = status
                        set_if_missing('status_text', text)
                        break

            buyer_nick = next_value('买家昵称')
            set_if_missing('buyer_nick', buyer_nick)

            order_time = next_value('下单时间')
            time_match = re.search(r'\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?', order_time)
            if time_match:
                set_if_missing('order_time', time_match.group(0).replace('/', '-'))

            for amount_label in ('成交价', '实付金额', '商品总价'):
                amount_text = next_value(amount_label)
                amount_match = re.search(r'¥?\s*\d+(?:\.\d+)?', amount_text)
                if amount_match:
                    set_if_missing('amount', amount_match.group(0).replace(' ', ''))
                    break

            for i, line in enumerate(lines):
                if '收货信息' not in line and '收货地址' not in line:
                    continue

                window = lines[i + 1:i + 10]
                for idx, candidate in enumerate(window):
                    phone_match = re.search(r'1[3-9]\d[\d\*]{8}', candidate)
                    if phone_match:
                        before_phone = candidate[:phone_match.start()].strip()
                        after_phone = candidate[phone_match.end():].strip()
                        if before_phone:
                            set_if_missing('receiver_name', before_phone)
                        elif idx > 0:
                            set_if_missing('receiver_name', window[idx - 1])

                        set_if_missing('receiver_phone', phone_match.group(0))

                        if after_phone:
                            set_if_missing('receiver_address', after_phone)
                        elif idx + 1 < len(window):
                            set_if_missing('receiver_address', window[idx + 1])
                        return

        except Exception as e:
            logger.debug(f"页面文本兜底解析失败: {e}")

    async def _get_order_time(self, result: Dict[str, str]) -> None:
        """获取订单创建时间"""
        try:
            time_selectors = [
                'text=/下单时间/',
                'text=/订单创建时间/',
                'text=/创建时间/',
            ]

            for selector in time_selectors:
                try:
                    time_element = await self.page.query_selector(selector)
                    if time_element:
                        time_text = await time_element.text_content()
                        if time_text:
                            time_match = re.search(r'(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)', time_text)
                            if time_match:
                                result['order_time'] = time_match.group(1).replace('/', '-')
                                logger.info(f"订单时间: {result['order_time']}")
                                return
                except Exception:
                    continue

            # 从页面源码查找
            page_content = await self.page.content()
            time_match = re.search(r'(?:下单时间|订单创建时间|创建时间).*?(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)', page_content)
            if time_match:
                result['order_time'] = time_match.group(1).replace('/', '-')
                logger.info(f"订单时间: {result['order_time']}")

        except Exception as e:
            logger.error(f"获取订单时间失败: {e}")

    async def _get_receiver_info(self, result: Dict[str, str]) -> None:
        """获取收货人信息"""
        try:
            # 方法1: 查找"收货地址/收货信息"标签
            address_label = await self.page.query_selector('text=/收货地址|收货信息/')
            if address_label:
                parent_handle = await address_label.evaluate_handle('el => el.closest("li")')
                parent_li = parent_handle.as_element() if parent_handle else None
                if parent_li:
                    address_span = await parent_li.query_selector('span.textItemValue--w9qCWO1o')
                    if not address_span:
                        address_span = await parent_li.query_selector('[class*="textItemValue"]')

                    if address_span:
                        address_text = await address_span.text_content()
                        if address_text:
                            address_text = address_text.strip()
                            logger.info(f"收货地址文本: {address_text}")

                            # 提取手机号
                            phone_match = re.search(r'1[3-9]\d[\d\*]{8}', address_text)
                            if phone_match:
                                result['receiver_phone'] = phone_match.group(0)

                                # 提取姓名
                                name_part = address_text[:phone_match.start()].strip()
                                if name_part:
                                    result['receiver_name'] = name_part

                                # 提取地址
                                address_part = address_text[phone_match.end():].strip()
                                if address_part:
                                    result['receiver_address'] = address_part

                            if 'receiver_name' in result and 'receiver_phone' in result:
                                return

            # 方法2: 从页面文本查找
            body_text = await self.page.inner_text('body')
            lines = body_text.split('\n')
            for i, line in enumerate(lines):
                if ('收货地址' in line or '收货信息' in line) and i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    phone_match = re.search(r'1[3-9]\d[\d\*]{8}', next_line)
                    if phone_match:
                        result['receiver_phone'] = phone_match.group(0)
                        result['receiver_name'] = next_line[:phone_match.start()].strip()
                        result['receiver_address'] = next_line[phone_match.end():].strip()
                        result['receiver_address'] = re.sub(r'复制$', '', result['receiver_address']).strip()
                    break

        except Exception as e:
            logger.error(f"获取收货人信息失败: {e}")

    async def _get_order_status(self) -> str:
        """使用JavaScript分析页面获取订单状态"""
        try:
            status_info = await self.page.evaluate('''() => {
                // 定义状态关键词映射 - 优先级高的放前面
                const statusMap = [
                    // 退款最终态
                    {text: '退款成功，钱款已原路退返', status: 'cancelled', priority: 140},
                    {text: '钱款已原路退返', status: 'cancelled', priority: 138},
                    // 待付款
                    {text: '等待买家付款', status: 'pending_payment', priority: 95},
                    {text: '买家拍下了宝贝', status: 'pending_payment', priority: 92},
                    // 交易关闭 - 最长最具体的优先
                    {text: '未付款，买家关闭了订单', status: 'cancelled', priority: 135},
                    {text: '未付款，买家关闭订单', status: 'cancelled', priority: 135},
                    {text: '买家关闭了订单', status: 'cancelled', priority: 132},
                    {text: '买家关闭订单', status: 'cancelled', priority: 132},
                    {text: '买家取消了订单', status: 'cancelled', priority: 130},
                    {text: '卖家取消了订单', status: 'cancelled', priority: 130},
                    {text: '交易关闭', status: 'cancelled', priority: 125},
                    {text: '订单已关闭', status: 'cancelled', priority: 125},
                    // 退款处理中 - 必须高于已发货，否则售后页会被旧发货节点覆盖
                    {text: '买家撤销退款申请', status: 'shipped', priority: 122},
                    {text: '撤销退款申请', status: 'shipped', priority: 122},
                    {text: '我发起了退款申请', status: 'refunding', priority: 120},
                    {text: '退款申请', status: 'refunding', priority: 118},
                    {text: '申请退款', status: 'refunding', priority: 116},
                    {text: '退款中', status: 'refunding', priority: 114},
                    {text: '退款协商', status: 'refunding', priority: 112},
                    // 已发货
                    {text: '卖家已发货，待买家确认收货', status: 'shipped', priority: 85},
                    {text: '已发货，待买家确认收货', status: 'shipped', priority: 80},
                    {text: '卖家已发货', status: 'shipped', priority: 75},
                    {text: '已发货', status: 'shipped', priority: 70},
                    {text: '待买家确认收货', status: 'shipped', priority: 65},
                    // 待发货
                    {text: '买家已付款，请尽快发货', status: 'pending_ship', priority: 60},
                    {text: '买家已付款', status: 'pending_ship', priority: 55},
                    {text: '待发货', status: 'pending_ship', priority: 50},
                    {text: '等待卖家发货', status: 'pending_ship', priority: 45},
                    // 已完成
                    {text: '交易成功', status: 'completed', priority: 40},
                    {text: '订单完成', status: 'completed', priority: 35},
                    {text: '交易完成', status: 'completed', priority: 30},
                    // 处理中
                    {text: '处理中', status: 'processing', priority: 10},
                ];

                // 查找所有文本节点
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null
                );

                let bestMatch = null;
                let bestScore = -1;
                let nodeCount = 0;
                const maxNodes = 5000;

                let node;
                while((node = walker.nextNode()) && nodeCount < maxNodes) {
                    nodeCount++;
                    const text = node.textContent?.trim();
                    if(!text || text.length < 2 || text.length > 100) continue;

                    // 检查每个状态关键词
                    for(const item of statusMap) {
                        if(text.includes(item.text)) {
                            const parent = node.parentElement;
                            if(parent) {
                                const style = window.getComputedStyle(parent);
                                const fontSize = parseInt(style.fontSize) || 0;
                                const fontWeight = parseInt(style.fontWeight) || 0;

                                // 计算分数：关键词优先级 + 字体大小加分 + 字体粗细加分
                                const score = item.priority + fontSize + (fontWeight > 500 ? 5 : 0);

                                if(score > bestScore) {
                                    bestMatch = {
                                        text: text,
                                        status: item.status,
                                        fontSize: fontSize,
                                        fontWeight: fontWeight,
                                        class: parent.className,
                                        score: score
                                    };
                                    bestScore = score;
                                }
                            }
                            break;
                        }
                    }
                }

                return {
                    match: bestMatch,
                    nodesScanned: nodeCount
                };
            }''')

            logger.info(f"订单状态分析结果: {status_info}")

            match_info = status_info.get('match')
            if match_info:
                match_text = match_info.get('text', '').encode('utf-8', errors='ignore').decode('utf-8')
                logger.info(f"找到订单状态: {match_info['status']} (文本: {match_text}, 分数: {match_info.get('score', 0)})")
                return match_info['status']
            else:
                logger.warning(f"未能找到订单状态，扫描了 {status_info.get('nodesScanned', 0)} 个节点")
                return 'unknown'

        except Exception as e:
            logger.error(f"获取订单状态失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return 'unknown'


async def fetch_order_complete(
    order_id: str,
    cookie_id: str,
    cookie_string: str,
    timeout: int = 30,
    headless: bool = True,
    use_pool: bool = True,
    force_refresh: bool = False
) -> Optional[Dict[str, Any]]:
    """
    获取完整的订单信息（便捷函数）

    Args:
        order_id: 订单ID
        cookie_id: Cookie ID
        cookie_string: Cookie字符串
        timeout: 超时时间（秒）
        headless: 是否无头模式
        use_pool: 是否使用浏览器池

    Returns:
        完整的订单信息字典，失败返回None
    """
    fetcher = OrderFetcherOptimized(cookie_id, cookie_string, use_pool)
    return await fetcher.fetch_order_complete(order_id, timeout, headless, force_refresh)


async def process_orders_batch(
    order_ids: List[str],
    cookie_id: str,
    cookie_string: str,
    max_concurrent: int = 5,
    timeout: int = 30,
    headless: bool = True,
    use_pool: bool = True,
    force_refresh: bool = False
) -> List[Dict[str, Any]]:
    """
    并发批量处理订单

    使用asyncio.gather()并发处理多个订单，控制并发数避免被封

    Args:
        order_ids: 订单ID列表
        cookie_id: Cookie ID
        cookie_string: Cookie字符串
        max_concurrent: 最大并发数（默认5）
        timeout: 超时时间（秒）
        headless: 是否无头模式
        use_pool: 是否使用浏览器池
        force_refresh: 是否强制刷新（跳过缓存检查）

    Returns:
        订单信息字典列表（包含成功和失败的结果）
    """
    logger.info(f"开始批量处理 {len(order_ids)} 个订单，最大并发数: {max_concurrent}")
    # print(f"[BATCH] Processing {len(order_ids)} orders (concurrent: {max_concurrent})")  # 已移除

    # 创建信号量控制并发数
    semaphore = asyncio.Semaphore(max_concurrent)

    async def process_single_order(order_id: str, index: int) -> Dict[str, Any]:
        """
        处理单个订单（带并发控制）

        Args:
            order_id: 订单ID
            index: 订单索引

        Returns:
            订单信息字典（成功或失败）
        """
        async with semaphore:
            try:
                logger.info(f"[{index + 1}/{len(order_ids)}] 开始处理订单: {order_id}")
                # print(f"[{index + 1}/{len(order_ids)}] 处理订单: {order_id}")  # 已移除

                result = await fetch_order_complete(
                    order_id=order_id,
                    cookie_id=cookie_id,
                    cookie_string=cookie_string,
                    timeout=timeout,
                    headless=headless,
                    use_pool=use_pool,
                    force_refresh=force_refresh
                )

                if result:
                    logger.info(f"[{index + 1}/{len(order_ids)}] 订单 {order_id} 处理成功")
                    # print(f"[OK] [{index + 1}/{len(order_ids)}] 订单 {order_id} 成功")  # 已移除
                    return result
                else:
                    logger.warning(f"[{index + 1}/{len(order_ids)}] 订单 {order_id} 处理失败")
                    # print(f"[FAIL] [{index + 1}/{len(order_ids)}] 订单 {order_id} 失败")  # 已移除
                    return {
                        'order_id': order_id,
                        'success': False,
                        'error': '获取订单信息失败'
                    }

            except Exception as e:
                logger.error(f"[{index + 1}/{len(order_ids)}] 订单 {order_id} 处理异常: {e}")
                # print(f"[FAIL] [{index + 1}/{len(order_ids)}] 订单 {order_id} 异常: {e}")  # 已移除
                return {
                    'order_id': order_id,
                    'success': False,
                    'error': str(e)
                }

    # 创建所有任务
    tasks = [
        process_single_order(order_id, index)
        for index, order_id in enumerate(order_ids)
    ]

    # 并发执行所有任务（asyncio.gather会等待所有任务完成）
    logger.info(f"开始并发执行 {len(tasks)} 个任务...")
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 处理异常结果
    processed_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(f"任务 {i} 抛出异常: {result}")
            processed_results.append({
                'order_id': order_ids[i],
                'success': False,
                'error': str(result)
            })
        else:
            processed_results.append(result)

    # 统计结果
    success_count = sum(1 for r in processed_results if r and not r.get('error'))
    fail_count = len(processed_results) - success_count

    logger.info(f"批量处理完成: 成功 {success_count}，失败 {fail_count}")
    # print(f"\n[CHART] 批量处理完成:")  # 已移除
    # print(f"   [OK] 成功: {success_count}")  # 已移除
    # print(f"   [FAIL] 失败: {fail_count}")  # 已移除

    return processed_results


async def process_orders_in_batches(
    order_ids: List[str],
    cookie_id: str,
    cookie_string: str,
    batch_size: int = 10,
    max_concurrent: int = 5,
    timeout: int = 30,
    headless: bool = True,
    use_pool: bool = True,
    batch_delay: float = 2.0
) -> List[Dict[str, Any]]:
    """
    分批并发处理订单（适合大量订单）

    将订单分成多个批次，每批次内部并发处理，批次之间串行执行并延迟

    Args:
        order_ids: 订单ID列表
        cookie_id: Cookie ID
        cookie_string: Cookie字符串
        batch_size: 每批次的订单数（默认10）
        max_concurrent: 每批次内的最大并发数（默认5）
        timeout: 超时时间（秒）
        headless: 是否无头模式
        use_pool: 是否使用浏览器池
        batch_delay: 批次之间的延迟时间（秒，默认2秒）

    Returns:
        所有订单的信息字典列表
    """
    total_orders = len(order_ids)
    total_batches = (total_orders + batch_size - 1) // batch_size

    logger.info(f"开始分批处理 {total_orders} 个订单，分为 {total_batches} 批，每批 {batch_size} 个，批内并发 {max_concurrent}")
    print(f"[REFRESH] 分批处理 {total_orders} 个订单:")
    print(f"   [BOX] 总批次: {total_batches}")
    print(f"   [CHART] 每批: {batch_size} 个")
    print(f"   [BOLT] 批内并发: {max_concurrent}")

    all_results = []

    for batch_index in range(total_batches):
        start_idx = batch_index * batch_size
        end_idx = min((batch_index + 1) * batch_size, total_orders)
        batch_order_ids = order_ids[start_idx:end_idx]

        logger.info(f"\n批次 {batch_index + 1}/{total_batches}: 处理订单 {start_idx + 1}-{end_idx}")
        print(f"\n[BOX] 批次 {batch_index + 1}/{total_batches} ({len(batch_order_ids)} 个订单)")

        # 处理当前批次
        batch_results = await process_orders_batch(
            order_ids=batch_order_ids,
            cookie_id=cookie_id,
            cookie_string=cookie_string,
            max_concurrent=max_concurrent,
            timeout=timeout,
            headless=headless,
            use_pool=use_pool
        )

        all_results.extend(batch_results)

        # 批次之间延迟（最后一批不需要延迟）
        if batch_index < total_batches - 1:
            logger.info(f"批次 {batch_index + 1} 完成，等待 {batch_delay} 秒后开始下一批...")
            print(f"[WAIT] 等待 {batch_delay} 秒...")
            await asyncio.sleep(batch_delay)

    # 总体统计
    success_count = sum(1 for r in all_results if r and not r.get('error'))
    fail_count = len(all_results) - success_count

    logger.info(f"\n所有批次处理完成: 成功 {success_count}，失败 {fail_count}")
    print(f"\n[PARTY] 所有批次处理完成:")
    print(f"   [OK] 成功: {success_count}/{total_orders}")
    print(f"   [FAIL] 失败: {fail_count}/{total_orders}")

    return all_results
