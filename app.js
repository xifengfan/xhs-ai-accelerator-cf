/* ================================================
 * 小红书 AI 加速器 · app.js
 * D1 版本：积分管理 + 5 个数据埋点 + 工具交互占位
 * D2 接入 Coze API（由鲁肃负责）
 * D5 部署到 Vercel
 * ================================================ */

(function (global) {
  'use strict';

  // ---- 存储 Key ----
  const KEY_POINTS    = 'xhs.points';          // 积分余额
  const KEY_TRACK     = 'xhs.track';           // 埋点日志（数组）
  const KEY_USER      = 'xhs.user';            // 用户信息（注册/来源）
  const SIGNUP_GIFT   = 10;                    // 初始赠送积分

  // ---- AI 后端配置（D2 by 吕玲绮） ----
  // 走自建路线：Vercel Serverless Function + DeepSeek API
  // 不订阅 Coze，主公月成本 0-20 元
  // 部署到 Vercel 后，相对路径 '/api/generate' 会自动指向 Serverless Function
  const AI_CONFIG = {
    endpoint: '/api/generate',                   // 部署后无需改动
    timeoutMs: 30000,                            // 与服务端 maxDuration 对齐
  };

  // ============================================================
  // 工具：localStorage 安全读写
  // ============================================================
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      console.warn('[lsGet] 解析失败', key, e);
      return fallback;
    }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[lsSet] 写入失败', key, e); }
  }

  // ============================================================
  // 埋点系统
  // ============================================================
  /**
   * 埋点封装
   * @param {string} event   事件名
   * @param {object} payload 事件属性
   * @example App.track('page_view', { page: 'home' })
   */
  function track(event, payload) {
    const entry = {
      event,
      payload: payload || {},
      ts: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 80),
    };
    const log = lsGet(KEY_TRACK, []);
    log.push(entry);
    // 限制单端最多保留 1000 条，避免 localStorage 爆
    if (log.length > 1000) log.splice(0, log.length - 1000);
    lsSet(KEY_TRACK, log);

    // D1 控制台可见，D5 部署后接真实上报通道（如 vercel/log 或自建 ingest）
    if (global.console && console.debug) {
      console.debug('[track]', event, payload);
    }
  }

  function getTrackLog() { return lsGet(KEY_TRACK, []); }
  function clearTrackLog() { lsSet(KEY_TRACK, []); }

  // ============================================================
  // 积分系统
  // ============================================================
  function getPoints() {
    const v = lsGet(KEY_POINTS, null);
    if (v == null) {
      // 首次访问：赠送 10 积分 + 标记用户来源
      lsSet(KEY_POINTS, SIGNUP_GIFT);
      const user = lsGet(KEY_USER, null) || { source: 'direct', signedUpAt: new Date().toISOString() };
      lsSet(KEY_USER, user);
      track('user_signup', { source: user.source });
      return SIGNUP_GIFT;
    }
    return v;
  }

  function addPoints(amount) {
    if (!Number.isInteger(amount) || amount <= 0) return getPoints();
    const cur = getPoints();
    const next = cur + amount;
    lsSet(KEY_POINTS, next);
    track('points_added', { amount, from: cur, to: next });
    refreshPointsBadge();
    return next;
  }

  /**
   * 扣减积分（工具调用前置）
   * @returns {boolean} 是否扣减成功
   */
  function consumePoints(amount) {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    const cur = getPoints();
    if (cur < amount) return false;
    const next = cur - amount;
    lsSet(KEY_POINTS, next);
    track('points_consumed', { amount, from: cur, to: next, tool: (arguments[1] || 'unknown') });
    refreshPointsBadge();
    return true;
  }

  function setPoints(value) {
    if (!Number.isInteger(value) || value < 0) return;
    lsSet(KEY_POINTS, value);
    refreshPointsBadge();
  }

  // 刷新导航栏积分显示（多个页面用）
  function refreshPointsBadge() {
    document.querySelectorAll('#nav-points').forEach(el => {
      el.textContent = getPoints();
    });
  }

  // 积分不足提示
  function showInsufficientPoints() {
    const modal = document.getElementById('points-modal');
    if (modal) modal.classList.remove('hidden');
    else if (global.confirm) global.confirm('积分不足，是否前往充值？') && (location.href = 'pricing.html');
  }

  // ============================================================
  // 购买流程（D1 占位：直接跳 success.html + 加积分）
  // D2/D3 接入真实支付（微信 / 支付宝 / Stripe）
  // D6 吕玲绮：主公 SOP 友好提示 + 错误信息人性化
  // ============================================================
  /**
   * 人类可读的错误提示（D6 新增：所有支付/退款错误统一走这里）
   * 不用英文 error code（用户看不懂），改成中文短句 + 行动建议
   */
  const ERROR_MESSAGES = {
    // 支付
    MISSING_PACKAGE:    { title: '套餐信息缺失',   hint: '刷新页面重试，或联系主公协助。' },
    MISSING_USER:       { title: '用户未识别',     hint: '刷新页面后重试，或联系主公。' },
    UNKNOWN_PACKAGE:    { title: '该套餐已下架',   hint: '回到「定价」页选其他套餐。' },
    ORDER_NOT_FOUND:    { title: '找不到这笔订单', hint: '刷新页面或联系主公查询。' },
    // 退款
    WINDOW_EXPIRED:     { title: '已超过退款期限', hint: '7 天内未使用可退，超期暂不支持。' },
    POINTS_USED:        { title: '积分已使用过',   hint: '已使用的积分暂不支持退款。' },
    NOT_FULFILLED:      { title: '订单未到账',     hint: '请联系主公确认到账后再申请。' },
    REFUND_EXISTS:      { title: '退款已申请过',   hint: '请在「我的订单」查看进度。' },
    INVALID_STATUS:     { title: '订单状态异常',   hint: '请联系主公协助。' },
    NEED_APPROVE:       { title: '需要主公先批准', hint: '退款审核中，请稍候。' },
    INELIGIBLE:         { title: '暂不符合退款条件', hint: '请查看规则或联系主公。' },
    REFUND_NOT_FOUND:   { title: '找不到退款记录', hint: '刷新页面或联系主公。' },
    // 通用
    NETWORK_ERROR:      { title: '网络不太通畅',   hint: '请检查网络后重试。' },
    TIMEOUT:            { title: '请求超时',       hint: '请稍后重试，或联系主公。' },
    BAD_RESPONSE:       { title: '服务暂时异常',   hint: '请稍后重试，或联系主公。' },
    API_ERROR:          { title: '服务暂时异常',   hint: '请稍后重试，或联系主公。' },
    MISSING_PARAMS:     { title: '参数不完整',     hint: '刷新页面后重试。' },
    METHOD_NOT_ALLOWED: { title: '请求方式不支持', hint: '刷新页面后重试。' },
    INTERNAL:           { title: '服务出了点小问题', hint: '主公已知悉，请稍后重试。' },
    INVALID_TOOL:       { title: '工具调用异常',   hint: '请刷新页面后重试。' },
    INVALID_INPUT:      { title: '请输入内容',     hint: '提示词不能为空。' },
  };

  function humanizeError(code, fallback) {
    const e = ERROR_MESSAGES[code];
    if (e) return e.title + '｜' + e.hint;
    return (fallback && fallback.message) || '请求失败，请稍后重试。';
  }

  /**
   * 主公操作 SOP 入口（D6 新增）
   * 用户在支付/退款/AI 工具出错时一键跳转
   * 主公文档位置：范家知识库 / xhs-ai-accelerator / 主公操作SOP.md
   */
  const SOP_URL = 'https://github.com/xifengfan/xhs-ai-accelerator/blob/main/SOP.md';

  function trackAndShowError(scope, errorObj) {
    track(scope + '_error', {
      code: errorObj.error || 'UNKNOWN',
      message: errorObj.message || '',
    });
    const human = humanizeError(errorObj.error, errorObj);
    const sopLine = '\n\n💡 主公操作 SOP：' + SOP_URL;
    if (global.alert) {
      global.alert('😅 ' + human + sopLine);
    } else {
      console.error('[' + scope + ']', human, errorObj);
    }
  }

  // ================================================
  // D7' 重写：真支付链路（调 /api/payment + 弹 QR 模态框）
  // 修复：之前 D1 占位"假装成功"，现在调后端真实创建订单
  // ================================================
  async function purchase(packageId) {
    track('purchase_click', { package: packageId });

    // 1. 取/生成本地 userId（匿名 ID，存 localStorage，跨会话稳定）
    const KEY_UID = 'xhs.userId';
    let userId = lsGet(KEY_UID, null);
    if (!userId) {
      userId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      lsSet(KEY_UID, userId);
    }

    // 2. 调后端创建订单
    let json;
    try {
      const resp = await fetch('/api/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, userId }),
      });
      json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        trackAndShowError('purchase', json);
        return;
      }
    } catch (e) {
      trackAndShowError('purchase', { error: 'NETWORK_ERROR', message: e.message });
      return;
    }

    // 3. 弹 QR 模态框
    showPaymentModal({
      order: json.order,
      instructions: json.instructions,
    });
  }

  /**
   * 弹出支付模态框 - 显示 QR + 操作指引
   * @param {object} payload - { order, instructions }
   */
  function showPaymentModal({ order, instructions }) {
    // 移除旧模态框
    const old = document.getElementById('payment-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'payment-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full p-6 md:p-8 relative shadow-2xl">
        <button id="pm-close" class="absolute top-3 right-3 w-9 h-9 grid place-items-center rounded-full hover:bg-ink-100 text-ink-500 text-xl" aria-label="关闭">×</button>

        <h2 class="text-xl font-bold mb-1 text-center">扫码支付</h2>
        <p class="text-sm text-ink-500 text-center mb-5">${escapeHtml(order.packageName)} · ¥${order.amount}</p>

        <div class="bg-ink-100 rounded-xl p-4 mb-4 flex items-center justify-center" style="min-height:260px">
          <img src="${escapeAttr(order.paymentUrl)}" alt="微信收款码" class="max-w-full max-h-64 object-contain"
               onerror="this.parentElement.innerHTML='<div class=&quot;text-center text-ink-500 text-sm&quot;>二维码加载失败<br>请刷新重试或联系主公</div>'" />
        </div>

        <div class="space-y-2 text-sm text-ink-700 mb-5">
          <p><span class="inline-block w-5 h-5 rounded-full bg-brand-500 text-white text-xs grid place-items-center mr-2">1</span>${escapeHtml(instructions.step1)}</p>
          <p><span class="inline-block w-5 h-5 rounded-full bg-brand-500 text-white text-xs grid place-items-center mr-2">2</span>${escapeHtml(instructions.step2)}</p>
          <p><span class="inline-block w-5 h-5 rounded-full bg-brand-500 text-white text-xs grid place-items-center mr-2">3</span>${escapeHtml(instructions.step3)}</p>
        </div>

        <div class="bg-ink-100 rounded-lg p-3 text-xs text-ink-500 mb-4">
          <div class="flex justify-between"><span>订单号</span><span class="font-mono">${escapeHtml(order.orderId)}</span></div>
          <div class="flex justify-between mt-1"><span>状态</span><span class="text-amber-600">${escapeHtml(order.status)}</span></div>
        </div>

        <div class="flex gap-2">
          <button id="pm-paid" class="flex-1 py-2.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 text-sm font-medium">我已完成支付</button>
          <button id="pm-cancel" class="px-4 py-2.5 rounded-md border border-ink-300 text-ink-700 hover:border-brand-500 text-sm">稍后</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // 关闭逻辑
    const close = () => {
      modal.remove();
      document.body.style.overflow = '';
    };
    modal.querySelector('#pm-close').onclick = close;
    modal.querySelector('#pm-cancel').onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    // "我已完成支付" 跳 success 页
    modal.querySelector('#pm-paid').onclick = () => {
      close();
      track('purchase_paid_click', { orderId: order.orderId });
      location.href = `success.html?package=${encodeURIComponent(order.packageId)}&orderId=${encodeURIComponent(order.orderId)}`;
    };
  }

  // 简易 HTML 转义（防 XSS）
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /**
   * D6 新增：用户申请退款的前端封装
   * 错误走 humanizeError 统一处理，提示带主公 SOP 链接
   */
  async function requestRefund({ orderId, userId, reason }) {
    track('refund_request_click', { orderId });
    try {
      const resp = await fetch('/api/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, userId, reason }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        trackAndShowError('refund_request', json);
        return { ok: false, error: json };
      }
      track('refund_request_success', { orderId, refundId: json.refund && json.refund.id });
      return { ok: true, refund: json.refund };
    } catch (e) {
      trackAndShowError('refund_request', { error: 'NETWORK_ERROR', message: e.message });
      return { ok: false, error: { error: 'NETWORK_ERROR' } };
    }
  }

  // ============================================================
  // AI 后端调用（D2 by 吕玲绮）
  // 走自建路线：Vercel Serverless Function 转发到 DeepSeek API
  // 前端只管 POST { tool, input }，服务端负责 DeepSeek + 缓存 + 分级
  // ============================================================
  /**
   * @param {'title'|'note'} toolName 工具名
   * @param {string} input 用户输入
   * @returns {Promise<{ok: boolean, data?: any, error?: string, message?: string, cached?: boolean, tier?: object, usage?: object, cost?: number, elapsedMs?: number}>}
   */
  async function callAI(toolName, input) {
    // 0. 工具名 + input 校验
    if (!toolName || (toolName !== 'title' && toolName !== 'note')) {
      return { ok: false, error: 'INVALID_TOOL', message: '工具名必须为 title 或 note' };
    }
    if (!input || typeof input !== 'string' || !input.trim()) {
      return { ok: false, error: 'INVALID_INPUT', message: '请输入内容' };
    }

    // 1. 构造 AbortController 实现超时
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

    let resp;
    try {
      resp = await fetch(AI_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, input: input.trim() }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { ok: false, error: 'TIMEOUT', message: '请求超时，请稍后重试' };
      }
      // 网络层错误（断网/CORS/服务挂）
      console.error('[callAI] 网络错误', e);
      return { ok: false, error: 'NETWORK_ERROR', message: '请稍后重试' };
    }
    clearTimeout(timer);

    // 2. 解析响应
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      console.error('[callAI] 响应非 JSON', e);
      return { ok: false, error: 'BAD_RESPONSE', message: '请稍后重试' };
    }

    // 3. HTTP 状态码异常
    if (!resp.ok || !json.ok) {
      // 服务端错误已归一化为 { ok: false, error, message }
      return {
        ok: false,
        error: json.error || 'API_ERROR',
        message: json.message || '请稍后重试',
        status: resp.status,
      };
    }

    // 4. 成功
    return {
      ok: true,
      data: json.data,
      cached: !!json.cached,
      tier: json.tier || null,
      usage: json.usage || null,
      cost: json.cost || 0,
      elapsedMs: json.elapsedMs || 0,
    };
  }

  // ============================================================
  // 暴露全局 App
  // ============================================================
  const App = {
    init() { getPoints(); },   // 首次访问初始化积分
    // 埋点
    track, getTrackLog, clearTrackLog,
    // 积分
    getPoints, addPoints, consumePoints, setPoints, refreshPointsBadge, showInsufficientPoints,
    // 购买
    purchase,
    // 退款
    requestRefund,
    // AI
    callAI, AI_CONFIG,
    // D6 新增
    humanizeError, trackAndShowError,
    SOP_URL,
  };

  global.App = App;

})(window);
