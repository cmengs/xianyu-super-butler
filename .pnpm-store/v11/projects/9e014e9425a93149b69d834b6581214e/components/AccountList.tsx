import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AccountDetail, AIReplySettings } from '../types';
import {
  getAccountDetails,
  updateAccountStatus,
  deleteAccount,
  generateQRLogin,
  checkQRLoginStatus,
  updateAccountRemark,
  updateAccountAutoConfirm,
  updateAccountPauseDuration,
  updateAccountCookie,
  updateAccountLoginInfo,
  updateAccountAISettings,
  getAllAISettings,
  getAccountAISettings,
  checkAccountOnlineStatus
} from '../services/api';
import {
  Plus, Power, Edit2, Trash2, QrCode, X, Check, Loader2,
  MessageSquare, RefreshCw, Save, User, Clock, MessageCircle,
  Upload, Key, Eye, EyeOff, Bot, Settings, Activity, Wifi,
  SendHorizontal, AlertTriangle, Fingerprint
} from 'lucide-react';

type ModalType = 'edit' | 'ai-settings' | null;

const AccountList: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [qrStatus, setQrStatus] = useState<string>('pending');
  const [qrMessage, setQrMessage] = useState<string>('');
  const [qrTargetAccount, setQrTargetAccount] = useState<AccountDetail | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [editingAccount, setEditingAccount] = useState<AccountDetail | null>(null);
  const [checkingAccountId, setCheckingAccountId] = useState<string | null>(null);

  // 编辑表单状态
  const [editForm, setEditForm] = useState({
    remark: '',
    cookie: '',
    auto_confirm: false,
    pause_duration: 0,
    username: '',
    login_password: '',
    show_browser: false,
    device_id: '',
    showLoginPassword: false,
  });

  // AI设置表单状态
  const [aiSettings, setAiSettings] = useState<AIReplySettings>({
    ai_enabled: false,
    max_discount_percent: 10,
    max_discount_amount: 100,
    max_bargain_rounds: 3,
    custom_prompts: '',
  });
  const [saving, setSaving] = useState(false);

  const loadAccounts = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await getAccountDetails();

      // 获取所有账号的AI设置
      let allAISettings: Record<string, AIReplySettings> = {};
      if (!silent) {
        try {
          allAISettings = await getAllAISettings();
        } catch (e) {
          console.error('Failed to load AI settings:', e);
        }
      }

      // 合并AI设置到账号数据
      setAccounts(currentAccounts => data.map(account => {
        const currentAccount = currentAccounts.find(item => item.id === account.id);
        const settings = silent ? currentAccount : allAISettings[account.id];
        return {
          ...account,
          ai_enabled: settings?.ai_enabled ?? false,
          max_discount_percent: settings?.max_discount_percent ?? 10,
          max_discount_amount: settings?.max_discount_amount ?? 100,
          max_bargain_rounds: settings?.max_bargain_rounds ?? 3,
          custom_prompts: settings?.custom_prompts ?? '',
        };
      }));
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadAccounts();
    const statusTimer = window.setInterval(() => {
      loadAccounts(true);
    }, 3000);
    return () => window.clearInterval(statusTimer);
  }, []);

  const handleToggle = async (id: string, currentStatus: boolean) => {
    await updateAccountStatus(id, !currentStatus);
    loadAccounts();
  };

  const handleDelete = async (id: string) => {
    if (confirm('确认删除该账号吗？')) {
      await deleteAccount(id);
      loadAccounts();
    }
  };

  const handleCheckOnline = async (account: AccountDetail) => {
    setCheckingAccountId(account.id);
    try {
      const checked = await checkAccountOnlineStatus(account.id);
      setAccounts(current => current.map(item => {
        if (item.id !== account.id) return item;
        return {
          ...item,
          ...checked,
          value: checked.value ?? item.value,
          cookie: checked.cookie ?? item.cookie,
          auto_confirm: item.auto_confirm,
          ai_enabled: item.ai_enabled,
          max_discount_percent: item.max_discount_percent,
          max_discount_amount: item.max_discount_amount,
          max_bargain_rounds: item.max_bargain_rounds,
          custom_prompts: item.custom_prompts,
        };
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : '在线状态检测失败');
    } finally {
      setCheckingAccountId(null);
    }
  };

  const renderConnectionBadge = (account: AccountDetail) => {
    if (!account.enabled) {
      return <span className="px-2.5 py-0.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-bold">暂停</span>;
    }
    if (account.online_check_status === 'send_blocked') {
      return (
        <span
          className="px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold"
          title={account.online_check_message || account.last_send_error || '心跳在线，但发信被闲鱼拒绝'}
        >
          在线/发信异常
        </span>
      );
    }
    if (account.online_check_status === 'needs_verification' || account.connection_state === 'verifying') {
      return (
        <span
          className="px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold"
          title={account.online_check_message || account.connection_reason || '请在弹出的浏览器中完成验证'}
        >
          需验证
        </span>
      );
    }
    if (account.connected) {
      return (
        <span
          className="px-2.5 py-0.5 rounded-lg bg-green-100 text-green-700 text-xs font-bold"
          title={account.online_check_message || 'WS 心跳在线'}
        >
          在线
        </span>
      );
    }
    if (account.connection_state === 'connecting' || account.connection_state === 'reconnecting') {
      return <span className="px-2.5 py-0.5 rounded-lg bg-blue-100 text-blue-700 text-xs font-bold">连接中</span>;
    }
    return (
      <span
        className="px-2.5 py-0.5 rounded-lg bg-red-50 text-red-600 text-xs font-bold"
        title={account.online_check_message || account.connection_reason || '账号连接已停止'}
      >
        需重登
      </span>
    );
  };

  const renderRuntimeBadges = (account: AccountDetail) => {
    const sendFailed = account.last_send_status === 'failed' || account.last_send_status === 'timeout';
    const tokenIssueStatuses = ['failed', 'exception', 'needs_verification', 'captcha_failed', 'captcha_exception', 'captcha_max_retries'];
    const tokenIssue = Boolean(account.token_issue || tokenIssueStatuses.includes(account.last_token_refresh_status || ''));
    const tokenText = tokenIssue
      ? 'Token/风控异常'
      : account.token_ready
        ? 'WS Token可用'
        : 'WS Token待刷新';
    const heartbeatText = account.heartbeat_status === 'ok'
      ? `心跳${account.heartbeat_age_seconds ?? 0}s`
      : account.heartbeat_status === 'waiting'
        ? '心跳等待'
        : account.ws_connected
          ? '心跳异常'
          : 'WS离线';

    return (
      <>
        <span className={`text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 ${
          account.heartbeat_ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <Wifi className="w-3 h-3" /> {heartbeatText}
        </span>
        <span className={`text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 ${
          tokenIssue ? 'bg-amber-50 text-amber-700' : account.token_ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}
          title={account.last_token_refresh_error || account.last_risk_control_message || account.last_token_refresh_status || ''}
        >
          {tokenIssue ? <AlertTriangle className="w-3 h-3" /> : <Key className="w-3 h-3" />} {tokenText}
        </span>
        {sendFailed && (
          <span
            className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
            title={account.last_send_error || account.online_check_message || '最近一次发信失败'}
          >
            <SendHorizontal className="w-3 h-3" /> 发信异常{account.last_send_code ? ` ${account.last_send_code}` : ''}
          </span>
        )}
        {account.last_send_status === 'ok' && (
          <span className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5">
            <SendHorizontal className="w-3 h-3" /> 发信正常
          </span>
        )}
      </>
    );
  };

  const openEditModal = (account: AccountDetail) => {
    setEditingAccount(account);
    setEditForm({
      remark: account.remark || account.note || '',
      cookie: account.cookie || account.value || '',
      auto_confirm: account.auto_confirm || false,
      pause_duration: account.pause_duration || 0,
      username: account.username || '',
      login_password: account.login_password || '',
      show_browser: account.show_browser || false,
      device_id: account.device_id || '',
      showLoginPassword: false,
    });
    setActiveModal('edit');
  };

  const openAIModal = async (account: AccountDetail) => {
    setEditingAccount(account);
    setSaving(true);
    try {
      const settings = await getAccountAISettings(account.id);
      setAiSettings({
        ai_enabled: settings.ai_enabled ?? false,
        max_discount_percent: settings.max_discount_percent ?? 10,
        max_discount_amount: settings.max_discount_amount ?? 100,
        max_bargain_rounds: settings.max_bargain_rounds ?? 3,
        custom_prompts: settings.custom_prompts ?? '',
      });
    } catch (e) {
      console.error('Failed to load AI settings:', e);
    } finally {
      setSaving(false);
    }
    setActiveModal('ai-settings');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    setSaving(true);

    try {
      const promises: Promise<any>[] = [];

      // 更新备注
      if (editForm.remark !== (editingAccount.remark || editingAccount.note || '')) {
        promises.push(updateAccountRemark(editingAccount.id, editForm.remark));
      }

      // 更新Cookie
      if (editForm.cookie && editForm.cookie !== (editingAccount.cookie || editingAccount.value || '')) {
        promises.push(updateAccountCookie(editingAccount.id, editForm.cookie));
      }

      // 更新自动确认
      if (editForm.auto_confirm !== editingAccount.auto_confirm) {
        promises.push(updateAccountAutoConfirm(editingAccount.id, editForm.auto_confirm));
      }

      // 更新暂停时长
      if (editForm.pause_duration !== (editingAccount.pause_duration || 0)) {
        promises.push(updateAccountPauseDuration(editingAccount.id, editForm.pause_duration));
      }

      // 更新登录信息
      if (
        editForm.username !== (editingAccount.username || '') ||
        editForm.login_password !== (editingAccount.login_password || '') ||
        editForm.show_browser !== (editingAccount.show_browser || false) ||
        editForm.device_id !== (editingAccount.device_id || '')
      ) {
        promises.push(updateAccountLoginInfo(editingAccount.id, {
          username: editForm.username,
          login_password: editForm.login_password,
          show_browser: editForm.show_browser,
          device_id: editForm.device_id,
        }));
      }

      await Promise.all(promises);
      setActiveModal(null);
      loadAccounts();
    } catch (error) {
      console.error('更新账号失败:', error);
      alert('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAISettings = async () => {
    if (!editingAccount) return;
    setSaving(true);

    try {
      await updateAccountAISettings(editingAccount.id, aiSettings);
      setActiveModal(null);
      loadAccounts();
    } catch (error) {
      console.error('更新AI设置失败:', error);
      alert('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const closeQRModal = () => {
    setShowQRModal(false);
    setQrTargetAccount(null);
    setQrMessage('');
  };

  const startQRLogin = async (targetAccount?: AccountDetail) => {
    const target = targetAccount || null;
    setQrTargetAccount(target);
    setShowQRModal(true);
    setQrStatus('loading');
    setQrMessage('');
    try {
      const res = await generateQRLogin();
      if (res.success && res.qr_code_url && res.session_id) {
        setQrCodeUrl(res.qr_code_url);
        setQrStatus('waiting');

        const interval = setInterval(async () => {
          const statusRes = await checkQRLoginStatus(res.session_id!);
          if (statusRes.status === 'success') {
            clearInterval(interval);
            const actualAccountId = statusRes.account_info?.account_id;
            if (target && actualAccountId && actualAccountId !== target.id) {
              setQrStatus('error');
              setQrMessage(`扫码账号不匹配，实际登录账号为 ${actualAccountId}`);
              loadAccounts();
              return;
            }
            setQrStatus('success');
            setQrMessage(target ? '账号凭证已更新，实时任务正在恢复' : '登录成功');
            setTimeout(() => {
              closeQRModal();
              loadAccounts();
            }, 1500);
          } else if (statusRes.status === 'expired' || statusRes.status === 'error') {
            clearInterval(interval);
            setQrStatus('error');
            setQrMessage(statusRes.message || '二维码已失效，请重试');
          }
        }, 2000);
      } else {
        setQrStatus('error');
        setQrMessage(res.message || '二维码生成失败');
      }
    } catch (e) {
      setQrStatus('error');
      setQrMessage(e instanceof Error ? e.message : '二维码生成失败');
    }
  };

  if (loading) return <div className="p-20 flex justify-center"><Loader2 className="w-8 h-8 text-[#FFE815] animate-spin"/></div>;

  return (
    <div className="space-y-8 animate-fade-in relative">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">账号管理</h2>
          <p className="text-gray-500 mt-2 font-medium">管理您的闲鱼授权账号及设置。</p>
        </div>
        <button
            onClick={() => startQRLogin()}
            className="ios-btn-primary flex items-center gap-2 px-6 py-3 rounded-2xl font-bold shadow-lg shadow-yellow-200 transition-transform hover:scale-105 active:scale-95"
        >
          <QrCode className="w-5 h-5" />
          扫码登录
        </button>
      </div>

      {/* Account Grid */}
      <div className="grid grid-cols-1 gap-6">
        {accounts.map((account) => (
          <div key={account.id} className="ios-card p-6 rounded-[2rem] flex items-center justify-between group hover:border-[#FFE815] transition-all duration-300">
            <div className="flex items-center gap-8">
              <div className="relative">
                <img
                  src={account.avatar_url}
                  alt="avatar"
                  className="w-20 h-20 rounded-3xl object-cover shadow-md ring-4 ring-white"
                />
                <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-4 border-white flex items-center justify-center ${
                  account.online_check_status === 'send_blocked' ? 'bg-amber-500' : account.connected ? 'bg-green-500' : account.enabled ? 'bg-red-400' : 'bg-gray-300'
                }`}>
                    {account.online_check_status === 'send_blocked' ? (
                      <AlertTriangle className="w-3 h-3 text-white" />
                    ) : account.connected && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-xl font-extrabold text-gray-900">{account.nickname || account.remark || `账号 ${account.id.substring(0,6)}...`}</h3>
                    {renderConnectionBadge(account)}
                    {account.ai_enabled && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-purple-100 text-purple-700 text-xs font-bold flex items-center gap-1">
                          <Bot className="w-3 h-3" /> AI
                        </span>
                    )}
                </div>
                <p className="text-sm text-gray-500 font-medium mb-3">{account.remark || account.note || '暂无备注'}</p>
                <div className="flex flex-wrap gap-2">
                   {renderRuntimeBadges(account)}
                   {account.device_id && (
                     <span
                       className="text-xs bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
                       title={account.device_id}
                     >
                       <Fingerprint className="w-3 h-3" /> 设备 {account.device_id.slice(0, 8)}...
                     </span>
                   )}
                   {account.auto_confirm && <span className="text-xs bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"><MessageSquare className="w-3 h-3"/> 自动回复</span>}
                   {account.pause_duration > 0 && <span className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"><Clock className="w-3 h-3"/> 暂停{account.pause_duration}分钟</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={() => startQRLogin(account)}
                    className="px-3 py-2.5 rounded-xl hover:bg-yellow-50 transition-colors text-amber-700 font-bold text-sm flex items-center gap-2"
                    title="使用该闲鱼账号扫码更新登录凭证"
                >
                    <QrCode className="w-4 h-4" />
                    扫码重登
                </button>
                <button
                    onClick={() => handleCheckOnline(account)}
                    disabled={checkingAccountId === account.id}
                    className="px-3 py-2.5 rounded-xl hover:bg-green-50 transition-colors text-green-700 font-bold text-sm flex items-center gap-2 disabled:opacity-60"
                    title={account.online_check_message || '检测该闲鱼账号当前在线状态'}
                >
                    {checkingAccountId === account.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                    检测在线
                </button>
                <button
                    onClick={() => openEditModal(account)}
                    className="p-3 rounded-xl hover:bg-gray-100 transition-colors text-gray-600"
                    title="编辑账号"
                >
                    <Edit2 className="w-5 h-5" />
                </button>
                <button
                    onClick={() => openAIModal(account)}
                    className="p-3 rounded-xl hover:bg-purple-100 transition-colors text-purple-600"
                    title="AI设置"
                >
                    <Bot className="w-5 h-5" />
                </button>
                <button
                    onClick={() => handleToggle(account.id, account.enabled)}
                    className={`p-3 rounded-xl transition-colors ${account.enabled ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                >
                    <Power className="w-5 h-5" />
                </button>
                <button
                    onClick={() => handleDelete(account.id)}
                    className="p-3 rounded-xl hover:bg-red-100 transition-colors text-red-500"
                >
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
          </div>
        ))}

        {accounts.length === 0 && (
            <div className="ios-card p-12 text-center">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <User className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">暂无账号</h3>
                <p className="text-gray-500 mt-1">请点击右上角扫码添加您的闲鱼账号</p>
            </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQRModal && createPortal(
          <div className="modal-overlay-centered">
              <div className="modal-container" style={{maxWidth: '24rem'}}>
                  <button
                    onClick={closeQRModal}
                    className="self-end p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors mb-6"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>

                  <div className="modal-body">
                      <div className="text-center">
                          <h3 className="text-2xl font-extrabold text-gray-900 mb-2">
                            {qrTargetAccount ? '扫码重新登录' : '扫码登录'}
                          </h3>
                          <p className="text-gray-500 mb-8 font-medium">
                            {qrTargetAccount
                              ? `请使用「${qrTargetAccount.nickname || qrTargetAccount.remark || qrTargetAccount.id}」对应的闲鱼账号扫描`
                              : '请打开闲鱼APP扫描下方二维码'}
                          </p>

                          <div className="w-64 h-64 bg-[#F7F8FA] rounded-[2rem] mx-auto flex items-center justify-center overflow-hidden border-4 border-white shadow-inner mb-8 relative">
                              {qrStatus === 'loading' && <Loader2 className="w-10 h-10 text-[#FFE815] animate-spin" />}
                              {qrStatus === 'waiting' && <img src={qrCodeUrl} alt="QR Code" className="w-full h-full p-2" />}
                              {qrStatus === 'success' && (
                                  <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-green-600 animate-fade-in">
                                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                         <Check className="w-8 h-8" />
                                      </div>
                                      <span className="font-bold text-lg">{qrMessage || '登录成功'}</span>
                                  </div>
                              )}
                              {qrStatus === 'error' && (
                                  <div className="flex flex-col items-center">
                                      <span className="text-red-500 font-bold mb-2">{qrMessage || '获取失败'}</span>
                                      <button onClick={() => startQRLogin(qrTargetAccount || undefined)} className="text-xs bg-gray-200 px-3 py-1 rounded-full flex items-center gap-1 hover:bg-gray-300"><RefreshCw className="w-3 h-3"/> 重试</button>
                                  </div>
                              )}
                          </div>

                          <p className="text-xs text-gray-400 font-medium bg-gray-50 py-2 rounded-xl">二维码有效期为5分钟，请尽快扫码。</p>
                      </div>
                  </div>
              </div>
          </div>,
          document.body
      )}

      {/* 编辑账号弹窗 */}
      {activeModal === 'edit' && editingAccount && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{maxWidth: '600px'}}>
            <div className="modal-header">
              <div>
                <h3 className="text-2xl font-extrabold text-gray-900">编辑账号</h3>
                <p className="text-sm text-gray-500 mt-1">{editingAccount.nickname || editingAccount.remark || editingAccount.id}</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-2 rounded-xl hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="modal-body space-y-6">
              {/* 账号ID */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">账号ID</label>
                <input
                  type="text"
                  value={editingAccount.id}
                  disabled
                  className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-slate-500" />
                  设备ID
                </label>
                <input
                  type="text"
                  value={editForm.device_id}
                  onChange={(e) => setEditForm({ ...editForm, device_id: e.target.value.trim() })}
                  placeholder="设备ID"
                  className="w-full ios-input px-4 py-3 rounded-xl font-mono text-xs"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">备注</label>
                <input
                  type="text"
                  value={editForm.remark}
                  onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })}
                  placeholder="为账号添加备注"
                  className="w-full ios-input px-4 py-3 rounded-xl"
                />
              </div>

              {/* Cookie */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Cookie</label>
                <textarea
                  value={editForm.cookie}
                  onChange={(e) => setEditForm({ ...editForm, cookie: e.target.value })}
                  placeholder="更新账号Cookie"
                  className="w-full ios-input px-4 py-3 rounded-xl h-32 resize-none font-mono text-xs"
                />
                <p className="text-xs text-gray-500 mt-1">当前Cookie长度: {editForm.cookie.length} 字符</p>
              </div>

              {/* 自动确认收货 */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <div className="font-bold text-gray-900 flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    自动确认收货
                  </div>
                  <div className="text-xs text-gray-500">自动点击确认收货按钮</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditForm({ ...editForm, auto_confirm: !editForm.auto_confirm })}
                  className={`w-14 h-8 rounded-full transition-colors duration-300 relative ${
                    editForm.auto_confirm ? 'bg-[#FFE815]' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${
                      editForm.auto_confirm ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 暂停时长 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  暂停处理时长（分钟）
                </label>
                <input
                  type="number"
                  value={editForm.pause_duration}
                  onChange={(e) => setEditForm({ ...editForm, pause_duration: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                  min="0"
                  max="1440"
                  className="w-full ios-input px-4 py-3 rounded-xl"
                />
                <p className="text-xs text-gray-500 mt-1">设置后会暂停处理该账号的订单，到时间后自动恢复</p>
              </div>

              {/* 登录信息 */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Key className="w-5 h-5 text-amber-500" />
                  登录信息
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">用户名</label>
                    <input
                      type="text"
                      value={editForm.username}
                      onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                      placeholder="闲鱼账号/手机号"
                      className="w-full ios-input px-4 py-3 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">登录密码</label>
                    <div className="relative">
                      <input
                        type={editForm.showLoginPassword ? 'text' : 'password'}
                        value={editForm.login_password}
                        onChange={(e) => setEditForm({ ...editForm, login_password: e.target.value })}
                        placeholder="用于自动登录"
                        className="w-full ios-input px-4 py-3 rounded-xl pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, showLoginPassword: !editForm.showLoginPassword })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {editForm.showLoginPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-gray-900">登录时显示浏览器</div>
                      <div className="text-xs text-gray-500">调试时可开启查看登录过程</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, show_browser: !editForm.show_browser })}
                      className={`w-14 h-8 rounded-full transition-colors duration-300 relative ${
                        editForm.show_browser ? 'bg-[#FFE815]' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${
                          editForm.show_browser ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 ios-btn-primary px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                  disabled={saving}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* AI设置弹窗 */}
      {activeModal === 'ai-settings' && editingAccount && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{maxWidth: '600px'}}>
            <div className="modal-header">
              <div>
                <h3 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
                  <Bot className="w-6 h-6 text-purple-500" />
                  AI助手设置
                </h3>
                <p className="text-sm text-gray-500 mt-1">{editingAccount.nickname || editingAccount.remark || editingAccount.id}</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-2 rounded-xl hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="modal-body space-y-6">
              {/* 启用AI */}
              <div className="flex items-center justify-between p-4 bg-purple-50 rounded-xl">
                <div>
                  <div className="font-bold text-gray-900 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-500" />
                    启用AI自动回复
                  </div>
                  <div className="text-xs text-gray-500">AI将自动处理买家的砍价消息</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAiSettings({ ...aiSettings, ai_enabled: !aiSettings.ai_enabled })}
                  className={`w-14 h-8 rounded-full transition-colors duration-300 relative ${
                    aiSettings.ai_enabled ? 'bg-[#FFE815]' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${
                      aiSettings.ai_enabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 砍价策略 */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">砍价策略</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">最大折扣比例 (%)</label>
                    <input
                      type="number"
                      value={aiSettings.max_discount_percent}
                      onChange={(e) => setAiSettings({ ...aiSettings, max_discount_percent: parseInt(e.target.value) || 0 })}
                      className="w-full ios-input px-4 py-3 rounded-xl"
                      min="0"
                      max="100"
                    />
                    <p className="text-xs text-gray-500 mt-1">例如：10表示最多降价10%</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">最大折扣金额 (元)</label>
                    <input
                      type="number"
                      value={aiSettings.max_discount_amount}
                      onChange={(e) => setAiSettings({ ...aiSettings, max_discount_amount: parseInt(e.target.value) || 0 })}
                      className="w-full ios-input px-4 py-3 rounded-xl"
                      min="0"
                    />
                    <p className="text-xs text-gray-500 mt-1">例如：100表示最多降价100元</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">最大砍价轮次</label>
                    <input
                      type="number"
                      value={aiSettings.max_bargain_rounds}
                      onChange={(e) => setAiSettings({ ...aiSettings, max_bargain_rounds: parseInt(e.target.value) || 1 })}
                      className="w-full ios-input px-4 py-3 rounded-xl"
                      min="1"
                      max="10"
                    />
                    <p className="text-xs text-gray-500 mt-1">买家最多可以砍价的次数</p>
                  </div>
                </div>
              </div>

              {/* 自定义提示词 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">自定义提示词（可选）</label>
                <textarea
                  value={aiSettings.custom_prompts}
                  onChange={(e) => setAiSettings({ ...aiSettings, custom_prompts: e.target.value })}
                  placeholder="输入自定义的AI回复规则或风格指引...&#10;&#10;例如：回复时保持礼貌专业、使用简洁的语言、强调产品质量等"
                  className="w-full ios-input px-4 py-3 rounded-xl h-40 resize-none"
                />
              </div>

              {/* AI如何工作 */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  AI如何工作
                </h4>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li>• 自动识别买家的砍价请求</li>
                  <li>• 根据设定的策略智能回复</li>
                  <li>• 在合理范围内同意降价或礼貌拒绝</li>
                  <li>• 保持专业友好的沟通风格</li>
                </ul>
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveAISettings}
                  className="flex-1 ios-btn-primary px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                  disabled={saving}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? '保存中...' : '保存'}
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

export default AccountList;
