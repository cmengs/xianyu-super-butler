import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, PackageCheck, RefreshCw, Search, Star } from 'lucide-react';
import { Order } from '../types';
import { getReviews } from '../services/api';

type ReviewFilter = 'pending_review' | 'reviewed';

const ReviewList: React.FC = () => {
  const [reviews, setReviews] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>('pending_review');
  const [searchText, setSearchText] = useState('');

  const formatMoney = (value?: string | number) => {
    if (value === undefined || value === null || value === '') return '';
    const text = String(value).trim();
    return text.startsWith('¥') ? text : `¥${text}`;
  };

  const normalizeImageUrl = (url?: string) => {
    if (!url) return '';
    return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
  };

  const getReviewProgress = (review: Order) => {
    const statusText = String(review.status_text || '').trim();
    const isReviewed = (value?: string) => value === 'reviewed' || value === '已评价';
    const sellerReviewed =
      isReviewed(review.seller_review_status) ||
      ['卖家已评价', '卖家评价成功', '卖家评价完成', '已评价', '评价成功', '评价完成'].some(keyword => statusText.includes(keyword));
    const buyerReviewed =
      isReviewed(review.buyer_review_status) ||
      ['买家已评价', '买家评价成功', '买家评价完成'].some(keyword => statusText.includes(keyword));

    return {
      sellerDone: sellerReviewed,
      buyerDone: buyerReviewed,
      sellerText: sellerReviewed ? '已评论' : '未评论',
      buyerText: buyerReviewed ? '已评论' : '未评论'
    };
  };

  const loadReviews = async () => {
    setLoading(true);
    try {
      const res = await getReviews(filter, 1, 100);
      setReviews(res.data || []);
    } catch (error) {
      console.error('加载评价列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, [filter]);

  const filteredReviews = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return reviews;
    return reviews.filter(review => {
      const haystack = [
        review.order_id,
        review.item_title,
        review.item_id,
        review.buyer_nick,
        review.buyer_id,
        review.status_text
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [reviews, searchText]);

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.dataset.fallbackApplied !== 'true' && image.src.toLowerCase().includes('.heic')) {
      image.dataset.fallbackApplied = 'true';
      image.src = `${image.src}_320x320q90.jpg`;
      return;
    }
    image.style.display = 'none';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">评价管理</h2>
          <p className="text-gray-500 mt-2 font-medium">查看卖家评价与买家评价的完成情况。</p>
        </div>
        <button onClick={loadReviews} className="p-3 rounded-2xl bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 hover:text-black transition-colors shadow-sm self-start md:self-auto">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="ios-card rounded-[2rem] overflow-hidden shadow-lg border-0 bg-white">
        <div className="p-4 border-b border-gray-50 flex flex-col md:flex-row gap-4 justify-between items-center bg-[#FAFAFA]">
          <div className="flex gap-1 p-1 bg-gray-200/50 rounded-xl">
            {[
              { k: 'pending_review' as ReviewFilter, v: '进行中' },
              { k: 'reviewed' as ReviewFilter, v: '已完成' }
            ].map(opt => (
              <button
                key={opt.k}
                onClick={() => { setFilter(opt.k); setSearchText(''); }}
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
              onChange={(e) => setSearchText(e.target.value)}
              className="ios-input pl-10 pr-4 py-2.5 rounded-xl w-64 bg-white border-none shadow-sm focus:ring-0"
            />
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-white text-gray-400 text-xs font-bold uppercase tracking-wider border-b border-gray-50">
                <th className="px-6 py-5" style={{ width: '34%' }}>商品与订单</th>
                <th className="px-6 py-5" style={{ width: '18%' }}>买家信息</th>
                <th className="px-6 py-5" style={{ width: '18%' }}>实付金额</th>
                <th className="px-6 py-5" style={{ width: '22%' }}>评价进度</th>
                <th className="px-6 py-5 text-right" style={{ width: '8%' }}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredReviews.map(review => {
                const progress = getReviewProgress(review);
                return (
                <tr key={review.order_id} className="hover:bg-[#FFFDE7]/50 transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shadow-sm border border-gray-100 flex-shrink-0">
                        {review.item_image ? (
                          <img src={normalizeImageUrl(review.item_image)} alt="" onError={handleImageError} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300"><PackageCheck /></div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 line-clamp-1 text-sm">{review.item_title || '未知商品'}</div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">订单ID: {review.order_id}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          数量: {review.quantity || 1}
                          {review.created_at && <span> • {review.created_at}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-xs text-gray-500">买家</div>
                    <div className="text-sm font-bold text-gray-800">{review.buyer_nick || review.buyer_id || '待同步'}</div>
                    {review.buyer_nick && review.buyer_id && <div className="text-xs text-gray-500 font-mono">ID: {review.buyer_id}</div>}
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-base font-extrabold text-gray-900">{formatMoney(review.amount) || '待获取'}</div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span className="w-24 shrink-0 text-gray-400">卖家评论状态</span>
                        <span className={`font-bold ${progress.sellerDone ? 'text-green-700' : 'text-orange-700'}`}>
                          {progress.sellerText}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span className="w-24 shrink-0 text-gray-400">买家评论状态</span>
                        <span className={`font-bold ${progress.buyerDone ? 'text-green-700' : 'text-orange-700'}`}>
                          {progress.buyerText}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <a
                      href={`https://www.goofish.com/order-detail?orderId=${review.order_id}&role=seller`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex p-2 text-gray-400 hover:text-black transition-colors"
                      title="打开订单详情"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filteredReviews.length === 0 && (
            <div className="h-[320px] flex flex-col items-center justify-center text-gray-400">
              <Star className="w-12 h-12 mb-4 text-gray-300" />
              <div className="font-medium">{filter === 'pending_review' ? '暂无进行中的评价记录' : '暂无已完成的评价记录'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReviewList;
