import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  MessageCircle,
  Package,
  RefreshCw,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { AccountDetail, ChatConversation, ChatMessage } from '../types';
import {
  getAccountDetails,
  getChatMessages,
  getChats,
  sendChatMessage,
} from '../services/api';

const ChatManager: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchText, setSearchText] = useState('');
  const [draft, setDraft] = useState('');
  const [conversationLoading, setConversationLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const formatTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    const today = new Date();
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    return sameDay
      ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };

  const normalizeImageUrl = (url?: string) => {
    if (!url) return '';
    return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
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

  const loadConversations = async (silent = false) => {
    if (!silent) setConversationLoading(true);
    try {
      const response = await getChats(selectedAccount || undefined);
      const next = response.data || [];
      setConversations(next);
      setSelectedChat((current) => {
        if (!current) return next[0] || null;
        return next.find(
          (item) => item.cookie_id === current.cookie_id && item.chat_id === current.chat_id
        ) || next[0] || null;
      });
    } catch (requestError: any) {
      if (!silent) setError(requestError?.message || '会话加载失败');
    } finally {
      if (!silent) setConversationLoading(false);
    }
  };

  const loadMessages = async (conversation: ChatConversation, silent = false) => {
    if (!silent) setMessageLoading(true);
    try {
      const response = await getChatMessages(
        conversation.cookie_id,
        conversation.chat_id,
        300
      );
      setMessages(response.data || []);
      setConversations((current) => current.map((item) => (
        item.cookie_id === conversation.cookie_id && item.chat_id === conversation.chat_id
          ? { ...item, unread_count: 0 }
          : item
      )));
    } catch (requestError: any) {
      if (!silent) setError(requestError?.message || '聊天记录加载失败');
    } finally {
      if (!silent) setMessageLoading(false);
    }
  };

  useEffect(() => {
    getAccountDetails()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    setSelectedChat(null);
    setMessages([]);
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(true), 5000);
    return () => window.clearInterval(timer);
  }, [selectedAccount]);

  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    setError('');
    void loadMessages(selectedChat);
    const timer = window.setInterval(() => void loadMessages(selectedChat, true), 3000);
    return () => window.clearInterval(timer);
  }, [selectedChat?.cookie_id, selectedChat?.chat_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id]);

  const filteredConversations = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => [
      conversation.user_name,
      conversation.user_id,
      conversation.item_title,
      conversation.item_id,
      conversation.last_message,
    ].filter(Boolean).join(' ').toLowerCase().includes(keyword));
  }, [conversations, searchText]);

  const handleSelectChat = (conversation: ChatConversation) => {
    setSelectedChat(conversation);
    setConversations((current) => current.map((item) => (
      item.cookie_id === conversation.cookie_id && item.chat_id === conversation.chat_id
        ? { ...item, unread_count: 0 }
        : item
    )));
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!selectedChat || !content || sending) return;

    const optimisticId = -Date.now();
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      cookie_id: selectedChat.cookie_id,
      chat_id: selectedChat.chat_id,
      user_id: selectedChat.user_id,
      role: 'seller',
      content,
      message_type: 'text',
      source: 'local',
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    setDraft('');
    setSending(true);
    setError('');
    try {
      await sendChatMessage(selectedChat.cookie_id, selectedChat.chat_id, content);
      await Promise.all([
        loadMessages(selectedChat, true),
        loadConversations(true),
      ]);
    } catch (requestError: any) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setDraft(content);
      setError(requestError?.message || '消息发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-3xl font-extrabold text-gray-900">聊天管理</h2>
        <div className="flex w-full gap-2 md:w-auto">
          <select
            value={selectedAccount}
            onChange={(event) => setSelectedAccount(event.target.value)}
            className="h-11 min-w-44 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 outline-none focus:border-gray-400"
          >
            <option value="">全部账号</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.remark || account.nickname || account.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="刷新聊天"
            onClick={() => void loadConversations()}
            disabled={conversationLoading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${conversationLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid h-[calc(100vh-9.5rem)] min-h-[560px] overflow-hidden rounded-lg border border-gray-200 bg-white lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索买家、商品或消息"
                className="h-10 w-full rounded-lg bg-gray-50 pl-9 pr-3 text-sm outline-none ring-1 ring-transparent focus:bg-white focus:ring-gray-200"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversationLoading && conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-gray-400">
                <MessageCircle className="h-10 w-10" />
                <div className="text-sm font-medium">暂无聊天记录</div>
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const active =
                  selectedChat?.cookie_id === conversation.cookie_id &&
                  selectedChat?.chat_id === conversation.chat_id;
                return (
                  <button
                    type="button"
                    key={`${conversation.cookie_id}:${conversation.chat_id}`}
                    onClick={() => handleSelectChat(conversation)}
                    className={`grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                      active ? 'bg-yellow-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                      {conversation.item_image ? (
                        <img
                          src={normalizeImageUrl(conversation.item_image)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UserRound className="h-6 w-6 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">
                          {conversation.user_name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatTime(conversation.last_message_at)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                          {conversation.last_role === 'seller' ? '我：' : ''}
                          {conversation.last_message || '暂无消息'}
                        </span>
                        {conversation.unread_count > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                            {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-gray-400">
                        {conversation.account_name}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {selectedChat ? (
            <>
              <header className="flex min-h-16 items-center justify-between gap-4 border-b border-gray-100 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-gray-900">{selectedChat.user_name}</div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    ID: {selectedChat.user_id}
                  </div>
                </div>
                {(selectedChat.item_title || selectedChat.item_id) && (
                  <div className="flex min-w-0 max-w-[45%] items-center gap-2 text-xs text-gray-500">
                    <Package className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {selectedChat.item_title || selectedChat.item_id}
                    </span>
                  </div>
                )}
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto bg-[#F6F7F9] px-4 py-5 md:px-7">
                {messageLoading && messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-3xl flex-col gap-3">
                    {messages.map((message) => {
                      const outgoing = message.role === 'seller';
                      const itemCard = message.message_type === 'item_card'
                        ? message.payload?.item_card
                        : undefined;
                      const itemUrl = itemCard?.item_id
                        ? `https://www.goofish.com/item?id=${encodeURIComponent(itemCard.item_id)}`
                        : '';
                      return (
                        <div
                          key={message.id}
                          className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[78%] ${outgoing ? 'text-right' : 'text-left'}`}>
                            {itemCard ? (
                              <a
                                href={itemUrl || undefined}
                                target={itemUrl ? '_blank' : undefined}
                                rel={itemUrl ? 'noreferrer' : undefined}
                                className="block w-[320px] max-w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left shadow-sm transition-colors hover:border-gray-300"
                              >
                                <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 p-2.5">
                                  <div className="h-[76px] w-[76px] overflow-hidden rounded-md bg-gray-100">
                                    {itemCard.image_url ? (
                                      <img
                                        src={normalizeImageUrl(itemCard.image_url)}
                                        alt=""
                                        onError={handleImageError}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <Package className="m-auto h-full w-7 text-gray-400" />
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-col justify-between py-0.5">
                                    <div
                                      className="text-sm font-medium leading-5 text-gray-900"
                                      style={{
                                        display: '-webkit-box',
                                        WebkitBoxOrient: 'vertical',
                                        WebkitLineClamp: 2,
                                        overflow: 'hidden',
                                      }}
                                    >
                                      {itemCard.title || '闲鱼商品'}
                                    </div>
                                    <div className="flex items-end justify-between gap-2">
                                      <span className="text-base font-bold text-red-500">
                                        {itemCard.price || '价格待获取'}
                                      </span>
                                      <span className="text-[11px] text-gray-400">查看商品</span>
                                    </div>
                                  </div>
                                </div>
                                {itemCard.tip && (
                                  <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
                                    {itemCard.tip}
                                  </div>
                                )}
                              </a>
                            ) : (
                              <div
                                className={`inline-block whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 text-left text-sm leading-6 ${
                                  outgoing
                                    ? 'bg-[#FFE815] text-gray-950'
                                    : message.role === 'system'
                                      ? 'border border-gray-200 bg-white text-gray-500'
                                      : 'bg-white text-gray-900 shadow-sm'
                                }`}
                              >
                                {message.content}
                              </div>
                            )}
                            <div className="mt-1 px-1 text-[11px] text-gray-400">
                              {formatTime(message.created_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <footer className="border-t border-gray-100 bg-white p-3">
                {error && (
                  <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                    {error}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={2}
                    placeholder="输入消息"
                    className="min-h-12 flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-6 outline-none focus:border-gray-300 focus:bg-white"
                  />
                  <button
                    type="button"
                    title="发送"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#FFE815] text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
              <MessageCircle className="h-12 w-12" />
              <div className="text-sm font-medium">选择一个会话</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ChatManager;
