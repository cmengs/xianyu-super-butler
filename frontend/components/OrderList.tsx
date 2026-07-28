import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Order, OrderStatus, Item, RefundDetail } from '../types';
import { getOrders, syncOrders, syncSingleOrder, manualShipOrder, updateOrder, deleteOrder, importOrders, getItems, getRefundDetail, handleRefundAction } from '../services/api';
import { Search, MoreHorizontal, Truck, RefreshCw, Copy, ChevronLeft, ChevronRight, PackageCheck, Edit, Eye, Plus, Save, X, User as UserIcon, Phone, MapPin, Upload, ExternalLink, Trash2, XCircle } from 'lucide-react';

const StatusBadge: React.FC<{ status: OrderStatus | string; statusText?: string }> = ({ status, statusText }) => {
  const styles = {
    processing: 'bg-yellow-100 text-yellow-800',
    pending_payment: 'bg-orange-100 text-orange-700',
    pending_ship: 'bg-[#FFE815] text-black',
    shipped: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
    refunding: 'bg-red-100 text-red-600',
  };

  const labels = {
    processing: '处理中',
    pending_payment: '待付款',
    pending_ship: '待发货',
    shipped: '已发货',
    completed: '已完成',
    cancelled: '已取消',
    refunding: '退款中',
  };

  const label =
    status === 'pending_payment'
      ? '待付款'
      : labels[status as OrderStatus] || (statusText?.includes('付款') ? '待付款' : status);

  return (
    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${styles[status as keyof typeof styles] || styles.cancelled}`}>
      {label}
    </span>
  );
};

const OrderList: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]); // 保存所有订单用于搜索
  const [items, setItems] = useState<Item[]>([]);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('all');
  const [searchText, setSearchText] = useState(''); // 搜索文本
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Partial<Order> | null>(null);
  const [editForm, setEditForm] = useState<Partial<Order>>({});
  const [importText, setImportText] = useState('');
  const [showShipModal, setShowShipModal] = useState(false);
  const [shipOrderId, setShipOrderId] = useState<string>('');
  const [shipRemark, setShipRemark] = useState('');
  const [shipLoading, setShipLoading] = useState(false);
  const [shipResult, setShipResult] = useState<{success: boolean; message: string} | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFormData, setImportFormData] = useState({
    order_id: '',
    item_id: '',
    buyer_id: '',
    receiver_name: '',
    receiver_phone: '',
    receiver_address: '',
    status: 'pending_ship' as OrderStatus,
    quantity: 1,
    amount: ''
  });
  const [syncingOrderId, setSyncingOrderId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [refundDetail, setRefundDetail] = useState<RefundDetail | null>(null);
  const [refundDetailLoading, setRefundDetailLoading] = useState(false);
  const [refundDetailError, setRefundDetailError] = useState('');
  const [refundActionLoading, setRefundActionLoading] = useState<'approve' | 'reject' | null>(null);
  const [refundActionMessage, setRefundActionMessage] = useState('');
  const [showRefundRejectForm, setShowRefundRejectForm] = useState(false);
  const [refundRejectReasonId, setRefundRejectReasonId] = useState('');
  const [refundRejectDescription, setRefundRejectDescription] = useState('');

  // 搜索过滤订单
  const filterOrders = (ordersToFilter: Order[]): Order[] => {
    if (!searchText.trim()) {
      return ordersToFilter;
    }

    const searchLower = searchText.toLowerCase().trim();
    return ordersToFilter.filter(order =>
      order.order_id?.toLowerCase().includes(searchLower) ||
      order.item_id?.toLowerCase().includes(searchLower) ||
      order.buyer_id?.toLowerCase().includes(searchLower) ||
      order.item_title?.toLowerCase().includes(searchLower) ||
      order.receiver_name?.toLowerCase().includes(searchLower) ||
      order.receiver_phone?.toLowerCase().includes(searchLower)
    );
  };

  const getOrderTimeValue = (order: Order): number => {
      const rawTime = order.created_at || order.updated_at || '';
      const normalized = String(rawTime).trim().replace(' ', 'T');
      const parsed = Date.parse(normalized);
      return Number.isNaN(parsed) ? 0 : parsed;
  };

  const sortOrdersByTimeDesc = (ordersToSort: Order[]): Order[] => {
      return [...ordersToSort].sort((a, b) => getOrderTimeValue(b) - getOrderTimeValue(a));
  };

  const getOrderTimeParts = (order: Order) => {
      const rawTime = String(order.created_at || order.updated_at || '').trim();
      if (!rawTime) {
          return { date: '-', time: '' };
      }
      const [date, ...rest] = rawTime.replace('T', ' ').split(/\s+/);
      return { date, time: rest.join(' ') };
  };

  const loadOrders = async () => {
      setLoading(true);

      try {
          // 如果有搜索文本，加载所有页的数据；否则只加载当前页
          if (searchText.trim()) {
              // 搜索模式：循环加载所有页
              let allOrdersData: Order[] = [];
              let currentPage = 1;
              let hasMore = true;

              while (hasMore) {
                  const res = await getOrders(undefined, filter, currentPage, 100);
                  allOrdersData = [...allOrdersData, ...res.data];
                  hasMore = currentPage < res.total_pages;
                  currentPage++;
              }

              const sortedOrders = sortOrdersByTimeDesc(allOrdersData);
              setAllOrders(sortedOrders);
              setOrders(sortOrdersByTimeDesc(filterOrders(sortedOrders)));
              setTotalPages(1); // 搜索时不分页
          } else {
              // 普通模式：只加载当前页
              const res = await getOrders(undefined, filter, page, 20);
              const sortedOrders = sortOrdersByTimeDesc(res.data);
              setAllOrders(sortedOrders);
              setOrders(sortOrdersByTimeDesc(filterOrders(sortedOrders)));
              setTotalPages(res.total_pages);
          }
      } catch (e) {
          console.error('加载订单失败:', e);
      } finally {
          setLoading(false);
      }
  };

  // 当订单数据改变时，重新过滤订单
  useEffect(() => {
    setOrders(sortOrdersByTimeDesc(filterOrders(allOrders)));
  }, [allOrders, searchText]);

  // 从订单的 item_id 查找对应的商品名称（通过标题匹配）
  const getItemNameById = (orderId: string, orderItemTitle?: string): string => {
      // 如果订单有 item_title，优先使用
      if (orderItemTitle && orderItemTitle.trim()) {
          return orderItemTitle;
      }

      // 尝试通过 item_id 直接匹配
      if (itemNames[orderId]) {
          return itemNames[orderId];
      }

      // 尝试在商品列表中查找相似标题的商品
      const matchingItem = items.find(item => {
          // 如果订单有标题，尝试匹配商品标题
          if (orderItemTitle && item.item_title) {
              // 检查是否包含关键词
              const orderTitleLower = orderItemTitle.toLowerCase();
              const itemTitleLower = item.item_title.toLowerCase();
              return itemTitleLower.includes(orderTitleLower) || orderTitleLower.includes(itemTitleLower);
          }
          return false;
      });

      if (matchingItem?.item_title) {
          return matchingItem.item_title;
      }

      return '未知商品';
  };

  const normalizeImageUrl = (url?: string) => {
      if (!url) return '';
      return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
  };

  const formatMoney = (value?: string | number) => {
      if (value === undefined || value === null || value === '') return '';
      const text = String(value).trim();
      return text.startsWith('¥') ? text : `¥${text}`;
  };

  const getOrderAmount = (order: Order) => {
      return formatMoney(order.amount) || '待获取';
  };

  const getBuyerDisplay = (order: Order) => {
      return order.buyer_nick || order.buyer_id || '未知买家';
  };

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      if (image.dataset.fallbackApplied !== 'true' && image.src.toLowerCase().includes('.heic')) {
          image.dataset.fallbackApplied = 'true';
          image.src = `${image.src}_320x320q90.jpg`;
          return;
      }
      image.style.display = 'none';
  };

  // 从商品列表构建商品ID到商品名的映射
  const buildItemNamesMap = () => {
      const namesMap: Record<string, string> = {};
      items.forEach(item => {
          // 使用 item_id 作为键，商品标题作为值
          if (item.item_id) {
              namesMap[item.item_id] = item.item_title || item.item_id;
          }
      });
      setItemNames(namesMap);
  };

  useEffect(() => {
    loadOrders();
    // 加载商品列表
    getItems().then((itemsList) => {
      setItems(itemsList);
      buildItemNamesMap();
    }).catch((e) => {
      console.error('加载商品列表失败:', e);
    });
  }, [filter, page, searchText]);

  const handleSync = async () => {
      setLoading(true);
      await syncOrders();
      loadOrders();
  };

  const handleShip = (id: string) => {
      setShipOrderId(id);
      setShipRemark('');
      setShipResult(null);
      setShowShipModal(true);
  };

  const executeShip = async (mode: 'status_only' | 'full_delivery') => {
      setShipLoading(true);
      setShipResult(null);
      try {
          const content = mode === 'status_only' ? shipRemark.trim() : undefined;
          const res = await manualShipOrder([shipOrderId], mode, content);
          const result = res?.results?.[0];
          if (result?.success) {
              setShipResult({ success: true, message: result.message });
              loadOrders();
          } else {
              setShipResult({ success: false, message: result?.message || '发货失败' });
          }
      } catch (e: any) {
          setShipResult({ success: false, message: e?.message || '请求失败' });
      } finally {
          setShipLoading(false);
      }
  };

  const loadRefundDetail = async (order: Order) => {
    setRefundDetailLoading(true);
    setRefundDetailError('');
    try {
      const detail = await getRefundDetail(order.order_id);
      setRefundDetail(detail);
      setRefundRejectReasonId((current) => (
        detail.reject_options?.some((option) => option.id === current)
          ? current
          : detail.reject_options?.[0]?.id || ''
      ));
    } catch (error: any) {
      setRefundDetailError(error?.message || '退款详情读取失败');
    } finally {
      setRefundDetailLoading(false);
    }
  };

  const handleViewDetail = (order: Order) => {
    setSelectedOrder(order);
    setRefundDetail(null);
    setRefundDetailError('');
    setRefundActionMessage('');
    setShowRefundRejectForm(false);
    setRefundRejectReasonId('');
    setRefundRejectDescription('');
    setShowDetailModal(true);
    if (order.status === 'refunding') {
      void loadRefundDetail(order);
    }
  };

  const executeRefundAction = async (action: 'approve' | 'reject') => {
    if (!selectedOrder) return;

    if (action === 'approve') {
      const detailUrl = refundDetail?.detail_url;
      if (!detailUrl) {
        setRefundActionMessage('未获取到闲鱼退款处理地址，请先刷新退款详情');
        return;
      }
      window.open(detailUrl, '_blank', 'noopener,noreferrer');
      setRefundActionMessage('已打开闲鱼官方退款页，请在闲鱼 App 中完成支付宝密码验证');
      return;
    } else {
      if (!refundRejectReasonId) {
        setRefundActionMessage('请先选择拒绝退款原因');
        return;
      }
      const reasonName = refundDetail?.reject_options?.find(
        (option) => option.id === refundRejectReasonId
      )?.name;
      if (!window.confirm(`确认以“${reasonName || '所选原因'}”拒绝这笔退款申请吗？`)) return;
    }

    setRefundActionLoading(action);
    setRefundActionMessage('');
    try {
      const result = await handleRefundAction(
        selectedOrder.order_id,
        action,
        refundRejectReasonId,
        refundRejectDescription.trim()
      );
      setRefundActionMessage(result.message || '操作已提交');
      if (result.success) {
        setShowRefundRejectForm(false);
      }
      if (result.data) {
        setSelectedOrder({
          ...selectedOrder,
          ...result.data,
          status: result.data.status || selectedOrder.status,
        });
      }
      await loadOrders();
    } catch (error: any) {
      setRefundActionMessage(error?.message || '退款操作失败，请重试');
    } finally {
      setRefundActionLoading(null);
    }
  };

  const handleEdit = (order: Order) => {
    setEditingOrder({ ...order });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingOrder || !editingOrder.order_id) return;
    try {
      // 映射前端字段到后端期望的字段名
      const updateData: Record<string, any> = {};

      if (editingOrder.status !== undefined) {
        updateData.order_status = editingOrder.status;
      }
      if (editingOrder.buyer_id !== undefined) {
        updateData.buyer_id = editingOrder.buyer_id;
      }
      if (editingOrder.buyer_nick !== undefined) {
        updateData.buyer_nick = editingOrder.buyer_nick;
      }
      if (editingOrder.status_text !== undefined) {
        updateData.status_text = editingOrder.status_text;
      }
      if (editingOrder.amount !== undefined) {
        updateData.amount = editingOrder.amount;
      }
      if (editingOrder.receiver_name !== undefined) {
        updateData.receiver_name = editingOrder.receiver_name;
      }
      if (editingOrder.receiver_phone !== undefined) {
        updateData.receiver_phone = editingOrder.receiver_phone;
      }
      if (editingOrder.receiver_address !== undefined) {
        updateData.receiver_address = editingOrder.receiver_address;
      }
      if (editingOrder.receiver_city !== undefined) {
        updateData.receiver_city = editingOrder.receiver_city;
      }
      if (editingOrder.item_id !== undefined) {
        updateData.item_id = editingOrder.item_id;
      }
      if (editingOrder.quantity !== undefined) {
        updateData.quantity = editingOrder.quantity;
      }

      await updateOrder(editingOrder.order_id, updateData);
      setShowEditModal(false);
      setEditingOrder(null);
      loadOrders();
    } catch (error) {
      console.error('更新订单失败:', error);
      alert('更新失败，请重试');
    }
  };

  const handleImportOrders = async () => {
    try {
      const orders = JSON.parse(importText);
      await importOrders(Array.isArray(orders) ? orders : [orders]);
      setShowImportModal(false);
      setImportText('');
      loadOrders();
      alert('订单导入成功');
    } catch (error) {
      alert('导入失败，请检查JSON格式');
    }
  };

  const handleSyncSingle = async (orderId: string) => {
    setSyncingOrderId(orderId);
    try {
      const result = await syncSingleOrder(orderId);
      if (result.success) {
        await loadOrders();
      } else {
        alert(result.message || '同步失败');
      }
    } catch (error: any) {
      console.error('同步订单失败:', error);
      alert(error?.message || '同步失败，请重试');
    } finally {
      setSyncingOrderId(null);
    }
  };

  const handleDelete = async (orderId: string) => {
    if (!confirm('确认删除该订单吗？删除后无法恢复。')) return;
    setDeletingOrderId(orderId);
    try {
      await deleteOrder(orderId);
      setAllOrders(prev => prev.filter(o => o.order_id !== orderId));
    } catch (error: any) {
      console.error('删除订单失败:', error);
      alert(error?.message || '删除失败，请重试');
      await loadOrders();
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">订单中心</h2>
          <p className="text-gray-500 mt-2 font-medium">查看所有闲鱼交易记录与状态。</p>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={loadOrders} className="p-3 rounded-2xl bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 hover:text-black transition-colors shadow-sm">
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-5 py-3 rounded-2xl font-bold bg-gray-900 text-white hover:bg-gray-800 transition-colors text-sm flex items-center gap-2 shadow-lg"
            >
              <Plus className="w-4 h-4" />
              插入订单
            </button>
            <button onClick={handleSync} className="ios-btn-primary px-6 py-3 rounded-2xl font-bold shadow-lg shadow-yellow-200 text-sm flex items-center gap-2">
                <Truck className="w-5 h-5" />
                一键同步订单
            </button>
        </div>
      </div>

      <div className="ios-card rounded-[2rem] overflow-hidden shadow-lg border-0 bg-white">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-50 flex flex-col md:flex-row gap-4 justify-between items-center bg-[#FAFAFA]">
          <div className="flex gap-1 p-1 bg-gray-200/50 rounded-xl overflow-x-auto max-w-full">
             {[
                 {k:'all', v:'全部'},
                 {k:'pending_payment', v:'待付款'},
                 {k:'shipped', v:'已发货'},
                 {k:'pending_ship', v:'待发货'},
                 {k:'cancelled', v:'已取消'},
                 {k:'refunding', v:'退款中'}
             ].map(opt => (
                 <button
                    key={opt.k}
                    onClick={() => { setFilter(opt.k); setPage(1); setSearchText(''); }}
                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filter === opt.k ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    {opt.v}
                 </button>
             ))}
          </div>
          <div className="relative w-full md:w-auto group">
             <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#FFE815] transition-colors" />
             <input
                 type="text"
                 placeholder="搜索订单号/商品/买家..."
                 value={searchText}
                 onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
                 className="ios-input pl-10 pr-4 py-2.5 rounded-xl w-64 bg-white border-none shadow-sm focus:ring-0"
             />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-white text-gray-400 text-xs font-bold uppercase tracking-wider border-b border-gray-50">
                <th className="px-6 py-5" style={{width: '25%'}}>订单信息</th>
                <th className="px-6 py-5" style={{width: '23%'}}>买家信息</th>
                <th className="px-6 py-5" style={{width: '12%'}}>下单时间</th>
                <th className="px-6 py-5" style={{width: '10%'}}>实付金额</th>
                <th className="px-6 py-5" style={{width: '12%'}}>当前状态</th>
                <th className="px-4 py-5 text-right" style={{width: '18%'}}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((order) => {
                const timeParts = getOrderTimeParts(order);
                return (
                <tr key={order.id} className="hover:bg-[#FFFDE7]/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shadow-sm border border-gray-100 flex-shrink-0">
                        {order.item_image ? (
                            <img src={normalizeImageUrl(order.item_image)} alt="" onError={handleImageError} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300"><PackageCheck /></div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 line-clamp-1 text-sm">
                          {getItemNameById(order.item_id, order.item_title)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">订单ID: {order.order_id}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          数量: {order.quantity}
                          {order.item_price && <span> • 标价: {formatMoney(order.item_price)}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                      <div className="flex flex-col gap-1.5">
                          <div className="text-xs text-gray-500">买家</div>
                          <div className="text-sm font-bold text-gray-800">{getBuyerDisplay(order)}</div>
                          {order.buyer_nick && order.buyer_id && (
                              <div className="text-xs text-gray-500 font-mono">ID: {order.buyer_id}</div>
                          )}
                          {order.receiver_phone && (
                              <div className="flex items-center gap-2 text-xs">
                                  <span className="w-12 shrink-0 text-gray-400">电话</span>
                                  <span className="min-w-0 font-mono text-gray-600">{order.receiver_phone}</span>
                              </div>
                          )}
                          {order.receiver_name && (
                              <div className="flex items-center gap-2 text-xs">
                                  <span className="w-12 shrink-0 text-gray-400">收货人</span>
                                  <span className="min-w-0 text-gray-600">{order.receiver_name}</span>
                              </div>
                          )}
                          {order.receiver_address && (
                              <div className="flex items-start gap-2 text-xs">
                                  <span className="w-12 shrink-0 text-gray-400">地址</span>
                                  <span className="min-w-0 text-gray-600 line-clamp-1">{order.receiver_address}</span>
                              </div>
                          )}
                      </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-sm font-semibold text-gray-800 tabular-nums">{timeParts.date}</div>
                    {timeParts.time && (
                      <div className="mt-1 text-xs text-gray-400 tabular-nums">{timeParts.time}</div>
                    )}
                  </td>
                  <td className="px-6 py-5 text-base font-extrabold text-gray-900 tabular-nums">{getOrderAmount(order)}</td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col items-start gap-2">
                      <StatusBadge status={order.status} statusText={order.status_text} />
                      {order.status === 'pending_ship' && (
                        <button
                          onClick={() => handleShip(order.order_id)}
                          className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 px-3 text-xs font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-800 hover:shadow-md active:scale-95"
                        >
                          去发货
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <div className="flex items-center justify-end gap-0.5">
                    <a
                      href={`https://www.goofish.com/order-detail?orderId=${order.order_id}&role=seller`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-gray-400 hover:text-amber-600 p-1.5 rounded-xl hover:bg-amber-50 transition-colors"
                      title="查看闲鱼详情"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => handleViewDetail(order)}
                      className="text-gray-400 hover:text-blue-600 p-1.5 rounded-xl hover:bg-blue-50 transition-colors"
                      title="查看详情"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleEdit(order)}
                      className="text-gray-400 hover:text-black p-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                      title="编辑订单"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleSyncSingle(order.order_id)}
                      disabled={syncingOrderId === order.order_id}
                      className="text-gray-400 hover:text-green-600 p-1.5 rounded-xl hover:bg-green-50 transition-colors disabled:opacity-50"
                      title="同步订单"
                    >
                      <RefreshCw className={`w-4 h-4 ${syncingOrderId === order.order_id ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleDelete(order.order_id)}
                      disabled={deletingOrderId === order.order_id}
                      className="text-gray-400 hover:text-red-500 p-1.5 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="删除订单"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-gray-50 flex items-center justify-between bg-white">
            <div className="text-sm text-gray-500 font-medium pl-2">
                第 {page} 页 / 共 {totalPages} 页
            </div>
            <div className="flex gap-2">
                <button
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                    className="p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 transition-colors"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 transition-colors"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
      </div>

      {/* 订单详情弹窗 - 使用 Portal */}
      {showDetailModal && selectedOrder && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container">
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">订单详情</h3>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-6">
              {/* Order Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">订单信息</h4>
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">订单号</div>
                    <div className="font-mono text-sm font-bold text-gray-900">{selectedOrder.order_id}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">状态</div>
                    <StatusBadge status={selectedOrder.status} statusText={selectedOrder.status_text} />
                    {selectedOrder.status_text && (
                      <div className="mt-2 text-xs text-gray-500">{selectedOrder.status_text}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">成交金额</div>
                    <div className="text-lg font-extrabold text-gray-900">{getOrderAmount(selectedOrder)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">数量</div>
                    <div className="font-bold text-gray-900">{selectedOrder.quantity}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500 mb-1">创建时间</div>
                    <div className="text-sm font-medium text-gray-700">{selectedOrder.created_at}</div>
                  </div>
                </div>
              </div>

              {selectedOrder.status === 'refunding' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-lg font-bold text-gray-800">退款申请</h4>
                    <button
                      onClick={() => void loadRefundDetail(selectedOrder)}
                      disabled={refundDetailLoading || refundActionLoading !== null}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refundDetailLoading ? 'animate-spin' : ''}`} />
                      刷新退款详情
                    </button>
                  </div>

                  <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
                    {refundDetailLoading ? (
                      <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        正在读取闲鱼退款详情...
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-xs font-medium text-gray-500">退款原因</div>
                          <div className="text-sm font-bold text-gray-900">
                            {refundDetail?.refund_reason || selectedOrder.refund_reason || '暂未获取到退款原因'}
                          </div>
                        </div>
                        {(refundDetail?.refund_description || selectedOrder.refund_description) && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-gray-500">退款说明</div>
                            <div className="whitespace-pre-wrap text-sm text-gray-700">
                              {refundDetail?.refund_description || selectedOrder.refund_description}
                            </div>
                          </div>
                        )}
                        {refundDetail?.refund_amount && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-gray-500">申请退款金额</div>
                            <div className="text-sm font-bold text-gray-900">{formatMoney(refundDetail.refund_amount)}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {refundDetailError && (
                      <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-red-600">
                        {refundDetailError}
                      </div>
                    )}

                    {showRefundRejectForm && (
                      <div className="mt-4 space-y-3 border-t border-red-100 pt-4">
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-bold text-gray-700">拒绝原因</span>
                          <select
                            value={refundRejectReasonId}
                            onChange={(event) => setRefundRejectReasonId(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-red-300"
                          >
                            <option value="">请选择拒绝原因</option>
                            {(refundDetail?.reject_options || []).map((option) => (
                              <option key={option.id} value={option.id}>{option.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-bold text-gray-700">补充说明（选填）</span>
                          <textarea
                            value={refundRejectDescription}
                            onChange={(event) => setRefundRejectDescription(event.target.value.slice(0, 500))}
                            rows={3}
                            placeholder="填写协商情况或拒绝依据"
                            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-red-300"
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowRefundRejectForm(false)}
                            disabled={refundActionLoading !== null}
                            className="min-h-10 px-4 text-sm font-bold text-gray-600 disabled:opacity-50"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => void executeRefundAction('reject')}
                            disabled={!refundRejectReasonId || refundActionLoading !== null}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {refundActionLoading === 'reject' && <RefreshCw className="h-4 w-4 animate-spin" />}
                            提交拒绝
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          setRefundActionMessage('');
                          setShowRefundRejectForm((visible) => !visible);
                        }}
                        disabled={
                          refundDetailLoading ||
                          refundActionLoading !== null ||
                          !refundDetail?.can_reject
                        }
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        拒绝退款
                      </button>
                      <button
                        onClick={() => void executeRefundAction('approve')}
                        disabled={
                          refundDetailLoading ||
                          refundActionLoading !== null ||
                          !refundDetail?.can_approve
                        }
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#FFE815] px-4 py-2.5 text-sm font-extrabold text-gray-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ExternalLink className="h-4 w-4" />
                        去闲鱼确认退款
                      </button>
                    </div>

                    {refundActionMessage && (
                      <div className="mt-3 rounded-lg bg-white px-3 py-2 text-center text-xs font-medium text-gray-700">
                        {refundActionMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Item Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">商品信息</h4>
                <div className="p-4 bg-gray-50 rounded-xl flex items-center gap-4">
                  {selectedOrder.item_image && (
                    <img src={normalizeImageUrl(selectedOrder.item_image)} alt="" onError={handleImageError} className="w-20 h-20 rounded-xl object-cover border border-gray-200" />
                  )}
                  <div className="flex-1">
                    <div className="font-bold text-gray-900 mb-1">
                      {getItemNameById(selectedOrder.item_id, selectedOrder.item_title)}
                    </div>
                    <div className="text-sm text-gray-500">商品ID: {selectedOrder.item_id}</div>
                    {selectedOrder.item_price && (
                      <div className="text-sm text-gray-500 mt-1">标价: {formatMoney(selectedOrder.item_price)}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Buyer Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">买家信息</h4>
                <div className="p-4 bg-gray-50 rounded-xl space-y-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">买家</div>
                    <div className="font-bold text-gray-900">{getBuyerDisplay(selectedOrder)}</div>
                    {selectedOrder.buyer_nick && selectedOrder.buyer_id && (
                      <div className="mt-1 font-mono text-xs text-gray-500">ID: {selectedOrder.buyer_id}</div>
                    )}
                  </div>
                  {selectedOrder.receiver_name && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">收货人</div>
                      <div className="font-medium text-gray-700">{selectedOrder.receiver_name}</div>
                    </div>
                  )}
                  {selectedOrder.receiver_phone && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">联系电话</div>
                      <div className="font-mono text-sm text-gray-700">{selectedOrder.receiver_phone}</div>
                    </div>
                  )}
                  {selectedOrder.receiver_address && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">收货地址</div>
                      <div className="text-sm text-gray-700">{selectedOrder.receiver_address}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors"
                >
                  关闭
                </button>
                {selectedOrder.status === 'pending_ship' && (
                  <button
                    onClick={() => {
                      setShowDetailModal(false);
                      handleShip(selectedOrder.order_id);
                    }}
                    className="flex-1 rounded-xl border border-yellow-200 bg-[#FFE815] px-6 py-2.5 text-center shadow-sm shadow-yellow-100 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                  >
                    <span className="block text-xs leading-4 font-semibold text-gray-700">待发货</span>
                    <span className="block text-sm leading-5 font-extrabold text-gray-950">去发货</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Import Modal - 使用 Portal */}
      {showImportModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container">
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">插入订单</h3>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">选择Excel文件</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full ios-input px-4 py-3 rounded-xl text-sm"
                />
                <p className="text-xs text-gray-500 mt-2">支持 .xlsx 和 .xls 格式</p>
              </div>

              {importFile && (
                <div className="p-3 bg-blue-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">{importFile.name}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleImportOrders}
                  disabled={!importFile}
                  className="flex-1 px-6 py-3 rounded-xl ios-btn-primary font-bold shadow-lg shadow-yellow-200 disabled:opacity-50"
                >
                  导入订单
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Ship Modal - 发货方式选择 */}
      {showShipModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">立即发货</h3>
                <button
                  onClick={() => { setShowShipModal(false); setShipResult(null); }}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-4">
              <p className="text-sm text-gray-600">请选择发货方式：</p>

              {/* 选项A: 填写发货备注并修改发货状态 */}
              <div className="w-full p-4 rounded-xl border-2 border-gray-200 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Truck className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 text-sm">填写备注并标记发货</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      备注会作为闲鱼发货留言提交，适合填写卡密、链接或发货说明。
                    </div>
                  </div>
                </div>
                <textarea
                  value={shipRemark}
                  onChange={(e) => setShipRemark(e.target.value)}
                  disabled={shipLoading}
                  rows={4}
                  maxLength={500}
                  placeholder="例如：卡密 ABCD-1234-XYZ，或填写发货说明"
                  className="mt-4 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-300 focus:bg-white disabled:opacity-60"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">{shipRemark.length}/500</span>
                  <button
                    onClick={() => executeShip('status_only')}
                    disabled={shipLoading}
                    className="px-5 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    提交发货
                  </button>
                </div>
              </div>

              {/* 选项B: 完整发货流程 */}
              <button
                onClick={() => executeShip('full_delivery')}
                disabled={shipLoading}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-[#FFE815] hover:bg-yellow-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <PackageCheck className="w-5 h-5 text-yellow-700" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">完整发货（匹配卡券并发送）</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      自动匹配发货规则、获取卡券、发送卡券信息给买家，并修改发货状态。
                      适用于订单既没有发送卡券给买家、也没有修改发货状态的情况。
                    </div>
                  </div>
                </div>
              </button>

              {/* 加载状态 */}
              {shipLoading && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />
                  <span className="text-sm text-gray-500">正在处理中...</span>
                </div>
              )}

              {/* 结果显示 */}
              {shipResult && (
                <div className={`p-3 rounded-xl text-sm ${shipResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  {shipResult.success ? '✓ ' : '✗ '}{shipResult.message}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                onClick={() => { setShowShipModal(false); setShipResult(null); }}
                className="w-full px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors"
              >
                {shipResult?.success ? '完成' : '取消'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Modal - 使用 Portal */}
      {showEditModal && editingOrder && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container">
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">编辑订单</h3>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">订单号</label>
                  <input
                    type="text"
                    value={editingOrder.order_id}
                    disabled
                    className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">订单状态</label>
                  <select
                    value={editingOrder.status}
                    onChange={(e) => setEditingOrder({ ...editingOrder, status: e.target.value as OrderStatus })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  >
                    <option value="processing">处理中</option>
                    <option value="pending_payment">待付款</option>
                    <option value="pending_ship">待发货</option>
                    <option value="shipped">已发货</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                    <option value="refunding">退款中</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">买家昵称</label>
                  <input
                    type="text"
                    value={editingOrder.buyer_nick || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, buyer_nick: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">买家ID</label>
                  <input
                    type="text"
                    value={editingOrder.buyer_id}
                    onChange={(e) => setEditingOrder({ ...editingOrder, buyer_id: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">成交金额</label>
                  <input
                    type="text"
                    value={editingOrder.amount || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, amount: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">状态文案</label>
                  <input
                    type="text"
                    value={editingOrder.status_text || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, status_text: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">收货人</label>
                  <input
                    type="text"
                    value={editingOrder.receiver_name || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, receiver_name: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">联系电话</label>
                  <input
                    type="text"
                    value={editingOrder.receiver_phone || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, receiver_phone: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">收货地址</label>
                <textarea
                  value={editingOrder.receiver_address || ''}
                  onChange={(e) => setEditingOrder({ ...editingOrder, receiver_address: e.target.value })}
                  rows={2}
                  className="w-full ios-input px-4 py-3 rounded-xl resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">商品标题</label>
                <input
                  type="text"
                  value={editingOrder.item_title || ''}
                  onChange={(e) => setEditingOrder({ ...editingOrder, item_title: e.target.value })}
                  className="w-full ios-input px-4 py-3 rounded-xl"
                />
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 ios-btn-primary px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  保存更改
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default OrderList;
