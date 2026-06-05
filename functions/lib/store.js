// ================================================
// functions/lib/store.js
// 用途：业务存储（订单 / 退款 / 用户积分 / 事件）
// 存储后端：纯内存 Map（Cloudflare Pages Functions 单实例足够）
// 注：原 Vercel KV 适配器已移除——MVP 阶段主公人工核对订单，
//     内存存储足够；L2 阶段可升级到 Cloudflare KV
// ================================================

// 进程内仓库（单实例共享）
const memRepo = new Map();

function memGet(key, fallback = null) {
  return memRepo.has(key) ? memRepo.get(key) : fallback;
}
function memSet(key, value) { memRepo.set(key, value); }
function memSetAdd(key, member) {
  let s = memRepo.get(key);
  if (!s) { s = new Set(); memRepo.set(key, s); }
  s.add(member);
}
function memSetMembers(key) {
  const s = memRepo.get(key);
  return s instanceof Set ? Array.from(s) : [];
}

// ---- 工具函数 ----
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayStr(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ============================================================
// 套餐配置（与 pricing.html 对齐）
// ============================================================
const PACKAGES = {
  'trial_3.9':   { id: 'trial_3.9',   name: '体验包', amount: 3.9,  points: 10  },
  'monthly_9.9': { id: 'monthly_9.9', name: '月卡',   amount: 9.9,  points: 100 },
};

// ============================================================
// 用户积分
// ============================================================
const KEY_POINTS = (uid) => `xhs:points:${uid}`;

export async function getUserPoints(userId) {
  if (!userId) return 0;
  const v = memGet(KEY_POINTS(userId), 0);
  return Number.isInteger(v) ? v : 0;
}

export async function addUserPoints(userId, amount) {
  if (!userId || !Number.isInteger(amount) || amount <= 0) {
    return getUserPoints(userId);
  }
  const cur = await getUserPoints(userId);
  const next = cur + amount;
  memSet(KEY_POINTS(userId), next);
  return next;
}

export async function setUserPoints(userId, value) {
  if (!userId || !Number.isInteger(value) || value < 0) {
    return getUserPoints(userId);
  }
  memSet(KEY_POINTS(userId), value);
  return value;
}

// ============================================================
// 订单
// ============================================================
const KEY_ORDER = (oid) => `xhs:order:${oid}`;
const KEY_USER_ORDERS = (uid) => `xhs:order:byUser:${uid}`;

export async function createOrder({ userId, packageId, paymentUrl }) {
  const pkg = PACKAGES[packageId];
  if (!pkg) {
    throw Object.assign(new Error(`未知套餐：${packageId}`), { code: 'UNKNOWN_PACKAGE' });
  }
  if (!userId) {
    throw Object.assign(new Error('缺少 userId'), { code: 'MISSING_USER' });
  }
  const orderId = uid('ord');
  const order = {
    orderId,
    userId,
    packageId: pkg.id,
    packageName: pkg.name,
    amount: pkg.amount,
    points: pkg.points,
    paymentUrl: paymentUrl || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    paidAt: null,
    fulfilledAt: null,
  };
  memSet(KEY_ORDER(orderId), order);
  memSetAdd(KEY_USER_ORDERS(userId), orderId);
  return order;
}

export async function getOrder(orderId) {
  if (!orderId) return null;
  return memGet(KEY_ORDER(orderId), null);
}

export async function markOrderPaid(orderId) {
  const order = await getOrder(orderId);
  if (!order) {
    throw Object.assign(new Error('订单不存在'), { code: 'ORDER_NOT_FOUND' });
  }
  if (order.status === 'paid' || order.status === 'fulfilled') {
    return order;
  }
  if (order.status !== 'pending') {
    throw Object.assign(new Error(`订单状态异常：${order.status}`), { code: 'INVALID_STATUS' });
  }
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  memSet(KEY_ORDER(orderId), order);
  return order;
}

export async function fulfillOrder(orderId) {
  const order = await markOrderPaid(orderId);
  if (order.fulfilledAt) return { order, points: await getUserPoints(order.userId) };
  const newPoints = await addUserPoints(order.userId, order.points);
  order.status = 'fulfilled';
  order.fulfilledAt = new Date().toISOString();
  memSet(KEY_ORDER(orderId), order);
  return { order, points: newPoints };
}

export async function cancelOrder(orderId) {
  const order = await getOrder(orderId);
  if (!order) return null;
  if (order.status === 'fulfilled') {
    throw Object.assign(new Error('已发放积分的订单不能直接取消，请走退款流程'), { code: 'NEED_REFUND' });
  }
  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  memSet(KEY_ORDER(orderId), order);
  return order;
}

export function listPackages() {
  return Object.values(PACKAGES);
}

// ============================================================
// 退款
// ============================================================
const KEY_REFUND = (rid) => `xhs:refund:${rid}`;
const KEY_REFUND_BY_ORDER = (oid) => `xhs:refund:byOrder:${oid}`;

const REFUND_WINDOW_DAYS = 7;

export async function checkRefundEligibility(orderId) {
  const order = await getOrder(orderId);
  if (!order) {
    return { eligible: false, reason: '订单不存在', reasonCode: 'ORDER_NOT_FOUND' };
  }
  if (order.status !== 'fulfilled') {
    return { eligible: false, reason: '订单未到账或已取消，无需退款', reasonCode: 'NOT_FULFILLED' };
  }
  const fulfilledAt = new Date(order.fulfilledAt).getTime();
  const now = Date.now();
  const ageDays = (now - fulfilledAt) / (1000 * 60 * 60 * 24);
  if (ageDays > REFUND_WINDOW_DAYS) {
    return {
      eligible: false,
      reason: `已超过 ${REFUND_WINDOW_DAYS} 天退款窗口（${ageDays.toFixed(1)} 天）`,
      reasonCode: 'WINDOW_EXPIRED',
      ageDays,
    };
  }
  const curPoints = await getUserPoints(order.userId);
  const expectedUnused = order.points;
  if (curPoints < expectedUnused) {
    return {
      eligible: false,
      reason: `积分已被使用（订单 ${order.points}，当前余额 ${curPoints}）`,
      reasonCode: 'POINTS_USED',
      orderPoints: order.points,
      currentPoints: curPoints,
    };
  }
  return {
    eligible: true,
    order,
    ageDays,
  };
}

export async function createRefund({ userId, orderId, reason }) {
  const elig = await checkRefundEligibility(orderId);
  if (!elig.eligible) {
    throw Object.assign(new Error(elig.reason), {
      code: elig.reasonCode || 'INELIGIBLE',
    });
  }
  const existingId = memGet(KEY_REFUND_BY_ORDER(orderId), null);
  if (existingId) {
    const existing = memGet(KEY_REFUND(existingId), null);
    if (existing && existing.status !== 'rejected' && existing.status !== 'refunded') {
      throw Object.assign(new Error(`订单已有未完结的退款申请：${existingId}`), {
        code: 'REFUND_EXISTS',
        refundId: existingId,
      });
    }
  }
  const refundId = uid('rfd');
  const refund = {
    refundId,
    orderId,
    userId,
    points: elig.order.points,
    amount: elig.order.amount,
    status: 'pending',
    reason: reason || '用户主动申请',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    refundedAt: null,
  };
  memSet(KEY_REFUND(refundId), refund);
  memSet(KEY_REFUND_BY_ORDER(orderId), refundId);
  return refund;
}

export async function getRefund(refundId) {
  if (!refundId) return null;
  return memGet(KEY_REFUND(refundId), null);
}

export async function getRefundByOrder(orderId) {
  const id = memGet(KEY_REFUND_BY_ORDER(orderId), null);
  if (!id) return null;
  return await getRefund(id);
}

export async function approveRefund(refundId) {
  const refund = await getRefund(refundId);
  if (!refund) {
    throw Object.assign(new Error('退款申请不存在'), { code: 'REFUND_NOT_FOUND' });
  }
  if (refund.status !== 'pending') {
    throw Object.assign(new Error(`退款状态异常：${refund.status}`), { code: 'INVALID_STATUS' });
  }
  refund.status = 'approved';
  refund.decidedAt = new Date().toISOString();
  memSet(KEY_REFUND(refundId), refund);
  return refund;
}

export async function rejectRefund(refundId, reason) {
  const refund = await getRefund(refundId);
  if (!refund) {
    throw Object.assign(new Error('退款申请不存在'), { code: 'REFUND_NOT_FOUND' });
  }
  if (refund.status !== 'pending') {
    throw Object.assign(new Error(`退款状态异常：${refund.status}`), { code: 'INVALID_STATUS' });
  }
  refund.status = 'rejected';
  refund.decidedAt = new Date().toISOString();
  refund.rejectReason = reason || '不符合退款条件';
  memSet(KEY_REFUND(refundId), refund);
  return refund;
}

export async function completeRefund(refundId) {
  const refund = await getRefund(refundId);
  if (!refund) {
    throw Object.assign(new Error('退款申请不存在'), { code: 'REFUND_NOT_FOUND' });
  }
  if (refund.status === 'refunded') return refund;
  if (refund.status !== 'approved') {
    throw Object.assign(new Error(`退款状态异常：${refund.status}，需先 approve`), {
      code: 'NEED_APPROVE',
    });
  }
  await setUserPoints(refund.userId, 0);
  const order = await getOrder(refund.orderId);
  if (order) {
    order.status = 'refunded';
    order.refundedAt = new Date().toISOString();
    memSet(KEY_ORDER(refund.orderId), order);
  }
  refund.status = 'refunded';
  refund.refundedAt = new Date().toISOString();
  memSet(KEY_REFUND(refundId), refund);
  return refund;
}

// ============================================================
// 埋点
// ============================================================
const KEY_EVENT = (date, eid) => `xhs:event:${date}:${eid}`;
const KEY_EVENT_INDEX = (date) => `xhs:event:byDate:${date}`;

export async function recordEvent(event) {
  const date = todayStr();
  const eid = uid('evt');
  const entry = {
    id: eid,
    date,
    event: event.event || 'unknown',
    payload: event.payload || {},
    ts: event.ts || new Date().toISOString(),
    userId: event.userId || null,
    ua: event.ua || null,
  };
  memSet(KEY_EVENT(date, eid), entry);
  memSetAdd(KEY_EVENT_INDEX(date), eid);
  return entry;
}

export async function queryEventsByDate(date) {
  if (!date) date = todayStr();
  const ids = memSetMembers(KEY_EVENT_INDEX(date));
  const events = [];
  for (const eid of ids) {
    const e = memGet(KEY_EVENT(date, eid), null);
    if (e) events.push(e);
  }
  return events;
}

export async function listEventDates() {
  const dates = new Set();
  for (const k of memRepo.keys()) {
    const m = k.match(/^xhs:event:(\d{4}-\d{2}-\d{2}):/);
    if (m) dates.add(m[1]);
  }
  return Array.from(dates).sort().reverse();
}

// ============================================================
// 调试
// ============================================================
export function _memRepo() {
  return {
    orders: filterByPrefix('xhs:order:'),
    ordersByUser: filterByPrefix('xhs:order:byUser:'),
    points: filterByPrefix('xhs:points:'),
    refunds: filterByPrefix('xhs:refund:'),
    refundByOrder: filterByPrefix('xhs:refund:byOrder:'),
    events: filterByPrefix('xhs:event:'),
    eventsByDate: filterByPrefix('xhs:event:byDate:'),
  };
}
function filterByPrefix(prefix) {
  const m = new Map();
  for (const [k, v] of memRepo.entries()) {
    if (k.startsWith(prefix)) m.set(k, v);
  }
  return m;
}
export function _memRaw() { return memRepo; }
export { PACKAGES, REFUND_WINDOW_DAYS };
