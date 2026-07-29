
// API Response Bases
export interface ApiResponse {
  success?: boolean;
  message?: string;
  msg?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Auth
export interface LoginResponse {
  success: boolean;
  token?: string;
  message?: string;
  user_id?: number;
  username?: string;
  is_admin?: boolean;
}

// Accounts
export interface AccountDetail {
  id: string;
  value?: string; // cookie value from backend
  cookie?: string; // alias for value
  enabled: boolean;
  connected?: boolean;
  connection_state?: string;
  connection_reason?: string;
  login_required?: boolean;
  auto_confirm: boolean;
  remark?: string;
  note?: string; // alias for remark
  pause_duration?: number;
  // 登录信息
  username?: string;
  login_password?: string;
  show_browser?: boolean;
  // Frontend helpers
  nickname?: string;
  avatar_url?: string;
  // AI设置
  ai_enabled?: boolean;
  max_discount_percent?: number;
  max_discount_amount?: number;
  max_bargain_rounds?: number;
  custom_prompts?: string;
}

// Orders
export type OrderStatus = 
  | 'processing'      
  | 'pending_payment'
  | 'pending_ship'    
  | 'shipped'         
  | 'completed'       
  | 'cancelled'       
  | 'refunding';

export interface Order {
  id: string;
  order_id: string;
  cookie_id: string;
  item_id: string;
  item_title?: string;
  item_image?: string;
  item_price?: string;
  buyer_id: string;
  buyer_nick?: string;
  quantity: number;
  amount: string;
  status: OrderStatus;
  status_text?: string;
  review_status?: 'pending_review' | 'reviewed' | '';
  seller_review_status?: 'reviewed' | '';
  buyer_review_status?: 'reviewed' | '';
  refund_reason?: string;
  refund_description?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  receiver_city?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RefundDetail {
  order_id: string;
  refund_id?: string;
  refund_reason?: string;
  refund_description?: string;
  refund_amount?: string;
  refund_type?: string;
  refund_requested_at?: string;
  page_status?: string;
  page_status_description?: string;
  detail_url?: string;
  can_approve: boolean;
  can_reject: boolean;
  reject_options?: Array<{ id: string; name: string }>;
  requires_app_action?: boolean;
}

export interface ChatConversation {
  cookie_id: string;
  account_name: string;
  chat_id: string;
  user_id: string;
  user_name: string;
  item_id?: string;
  item_title?: string;
  item_image?: string;
  last_message: string;
  last_role: 'buyer' | 'seller' | 'system';
  last_message_at: string;
  last_message_id: number;
  unread_count: number;
}

export interface ChatMessage {
  id: number;
  cookie_id: string;
  chat_id: string;
  user_id: string;
  user_name?: string;
  item_id?: string;
  role: 'buyer' | 'seller' | 'system';
  content: string;
  message_type: string;
  payload?: {
    item_card?: {
      item_id?: string;
      title?: string;
      image_url?: string;
      price?: string;
      tip?: string;
    };
  };
  source: string;
  created_at: string;
}

// Cards
export interface Card {
  id: number;
  name: string;
  type: 'api' | 'text' | 'data' | 'image';
  description?: string;
  enabled: boolean;
  // 文本类型
  text_content?: string;
  // 批量数据类型
  data_content?: string;
  // API 类型配置
  api_config?: {
    url: string;
    method: 'GET' | 'POST';
    timeout?: number;
    headers?: string;
    params?: string;
  };
  // 图片类型
  image_url?: string;
  // 通用配置
  delay_seconds?: number;
  // 多规格配置
  is_multi_spec?: boolean;
  spec_name?: string;
  spec_value?: string;
  created_at: string;
  updated_at: string;
}

// Items
export interface Item {
  id: string | number;
  cookie_id: string;
  item_id: string;
  item_title?: string;
  item_price?: string;
  item_image?: string; // Inferred from common usage, though not explicitly in list model sometimes
  item_description?: string;
  item_detail?: string;
  item_detail_text?: string;
  item_detail_parsed?: {
    pic_info?: {
      picUrl?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  item_category?: string;
  is_multi_spec?: number | boolean;
  is_multi_qty_ship?: number | boolean;
  multi_quantity_delivery?: number | boolean;
  created_at?: string;
}

// Rules
export interface ShippingRule {
  id: string;
  name: string;
  item_keyword: string; // Matches item title
  card_group_id: number; // ID from Card list
  card_group_name?: string; // UI helper
  priority: number;
  enabled: boolean;
}

export interface ReplyRule {
  id: string;
  keyword: string;
  reply_content: string;
  match_type: 'exact' | 'fuzzy';
  enabled: boolean;
}

// Stats
export interface AdminStats {
  total_users: number;
  total_cookies: number;
  active_cookies: number;
  total_cards: number;
  total_keywords: number;
  total_orders: number;
}

export interface OrderAnalytics {
  revenue_stats: {
    total_amount: number;
    total_orders: number;
  };
  daily_stats: Array<{ date: string; amount: number }>;
  item_stats?: Array<{
    item_id: string;
    order_count: number;
    total_amount: number;
    avg_amount: number;
  }>;
}

export interface ShopDataMetric {
  type: string;
  name: string;
  value: number;
  value_type: string;
  change?: number | null;
  change_type?: string;
  tips?: string;
  tab_type?: string;
  trend?: Array<{ name: string; value: number }>;
}

export interface ShopDistribution {
  label: string;
  items: Array<{
    name: string;
    value: number;
    value_type: string;
  }>;
}

export interface ShopDataPeriod {
  days: number;
  data_date: string;
  server_time: string;
  overview: ShopDataMetric[];
  distributions: Partial<Record<'source' | 'item' | 'time' | 'region', ShopDistribution>>;
  repurchase: {
    tips: string;
    metrics: ShopDataMetric[];
  };
  conversion?: {
    steps: ShopDataMetric[];
    rates: ShopDataMetric[];
    result?: ShopDataMetric | null;
  };
}

export interface ShopProductExposureItem {
  item_id: string;
  title: string;
  main_pic?: string;
  price?: string;
  exposure: number;
  browse: number;
  want: number;
  sales?: number;
  deal_amount?: number;
  item_status?: number;
  item_type?: string;
  created_at?: string;
}

export interface ShopProductExposure {
  source: 'official_data_center' | string;
  rank_type: 'EXPOSURE' | string;
  period_days: number;
  data_date: string;
  server_time?: string;
  has_next_page?: boolean;
  items: ShopProductExposureItem[];
}

export interface ShopAccountMetrics {
  cookie_id: string;
  metric_date: string;
  nickname: string;
  account_label?: string;
  avatar?: string;
  shop_name?: string;
  is_shop: boolean;
  followers: number;
  following: number;
  sold_count: number;
  item_count: number;
  first_browse_total: number;
  browse_total: number;
  today_browse: number;
  collect_total: number;
  want_total: number;
  today_exposure?: number | null;
  exposure_source?: string;
  shop_data?: {
    source: 'official_data_center' | string;
    supported_days: number[];
    periods: Record<string, ShopDataPeriod>;
    product_exposure?: ShopProductExposure | null;
    product_exposure_periods?: Record<string, ShopProductExposure>;
    product_exposure_supported_days?: number[];
    product_exposure_requested_days?: number;
    product_exposure_message?: string;
  };
  updated_at?: string;
  status: 'ready' | 'not_synced' | 'error';
  error?: string;
}

export interface ShopOverview {
  success?: boolean;
  metric_date: string;
  accounts: ShopAccountMetrics[];
  totals: {
    today_exposure?: number | null;
    today_browse: number;
    browse_total: number;
    collect_total: number;
    want_total: number;
    followers: number;
    sold_count: number;
    item_count: number;
  };
  errors?: Array<{ cookie_id: string; message: string }>;
}

// Settings
export interface SystemSettings {
  ai_model?: string;
  ai_api_key?: string;
  ai_base_url?: string;
  default_reply?: string;
  registration_enabled?: boolean;
  smtp_server?: string;
  [key: string]: any;
}

export interface AIReplySettings {
  ai_enabled: boolean;
  model_name: string;
  api_key: string;
  base_url: string;
  max_discount_percent: number;
  max_discount_amount?: number;
  max_bargain_rounds: number;
  custom_prompts: string;
}

// Default Reply
export interface DefaultReply {
  cookie_id: string;
  enabled: boolean;
  reply_content: string;
  reply_once: boolean;
  reply_image_url?: string;
}
