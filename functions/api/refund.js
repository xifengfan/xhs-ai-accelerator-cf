// ================================================
// functions/refund.js
// 用途：退款管理
// 路由：
//   POST /api/refund          { orderId, userId, reason? }
//   POST /api/refund/decide   { refundId, action: 'approve'|'reject', reason? }
//   POST /api/refund/complete { refundId }
//   GET  /api/refund?refundId=xxx
//   GET  /api/refund?orderId=xxx
// ================================================

import {
  createRefund,
  approveRefund,
  rejectRefund,
  completeRefund,
  getRefund,
  getRefundByOrder,
  checkRefundEligibility,
  REFUND_WINDOW_DAYS,
} from './lib/store.js';

const HUMAN_MESSAGES = {
  ORDER_NOT_FOUND:    '找不到这笔订单，请刷新页面或联系主公查询。',
  REFUND_NOT_FOUND:   '找不到这笔退款申请，请刷新页面后重试。',
  WINDOW_EXPIRED:     '已超过 7 天退款期限，暂不支持。',
  POINTS_USED:        '您已使用过该订单的积分，暂不支持退款。',
  NOT_FULFILLED:      '订单尚未到账，请联系主公确认到账后再申请退款。',
  REFUND_EXISTS:      '您已申请过该订单的退款，请耐心等待审核。',
  INVALID_STATUS:     '订单状态异常，请联系主公协助处理。',
  NEED_APPROVE:       '退款需要主公先批准，请稍候。',
  INELIGIBLE:         '暂不符合退款条件，请查看退款规则。',
  MISSING_ORDER:      '订单号缺失，请刷新页面后重试。',
  MISSING_USER:       '用户未识别，请刷新页面后重试。',
  MISSING_REFUND:     '退款单号缺失，请刷新页面后重试。',
  INVALID_ACTION:     '审核动作无效，请联系主公。',
  MISSING_PARAMS:     '请求参数不完整，请刷新页面后重试。',
  METHOD_NOT_ALLOWED: '请求方式不支持，请刷新页面后重试。',
  INTERNAL:           '退款服务出了点小问题，主公已知悉，请稍后重试。',
};

function humanize(code, fallback) {
  return HUMAN_MESSAGES[code] || fallback || '请求失败，请稍后重试。';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function statusForError(code) {
  if (code === 'ORDER_NOT_FOUND' || code === 'REFUND_NOT_FOUND') return 404;
  if (['WINDOW_EXPIRED','POINTS_USED','NOT_FULFILLED','REFUND_EXISTS','INVALID_STATUS','NEED_APPROVE','INELIGIBLE'].includes(code)) return 409;
  return 500;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);
  const body = await readJson(request);
  if (body === null) {
    return jsonResponse({ ok: false, error: 'INVALID_JSON', message: '请求体不是合法 JSON' }, 400);
  }

  try {
    if (url.pathname.includes('/decide'))  return await handleDecide(body);
    if (url.pathname.includes('/complete')) return await handleComplete(body);
    return await handleCreate(body);
  } catch (e) {
    console.error('[refund] 异常', e);
    return jsonResponse({
      ok: false,
      error: e.code || 'INTERNAL',
      message: humanize(e.code || 'INTERNAL'),
    }, statusForError(e.code));
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const refundId = url.searchParams.get('refundId');
  const orderId = url.searchParams.get('orderId');

  try {
    if (refundId) {
      const r = await getRefund(refundId);
      if (!r) {
        return jsonResponse({ ok: false, error: 'REFUND_NOT_FOUND', message: humanize('REFUND_NOT_FOUND') }, 404);
      }
      return jsonResponse({ ok: true, refund: r, windowDays: REFUND_WINDOW_DAYS });
    }
    if (orderId) {
      const r = await getRefundByOrder(orderId);
      if (!r) {
        const elig = await checkRefundEligibility(orderId);
        return jsonResponse({ ok: true, refund: null, eligibility: elig });
      }
      return jsonResponse({ ok: true, refund: r, windowDays: REFUND_WINDOW_DAYS });
    }
    return jsonResponse({
      ok: false,
      error: 'MISSING_PARAMS',
      message: humanize('MISSING_PARAMS'),
    }, 400);
  } catch (e) {
    console.error('[refund] GET 异常', e);
    return jsonResponse({
      ok: false,
      error: e.code || 'INTERNAL',
      message: humanize(e.code || 'INTERNAL'),
    }, statusForError(e.code));
  }
}

async function handleCreate(body) {
  const { orderId, userId, reason } = body || {};
  if (!orderId) {
    return jsonResponse({ ok: false, error: 'MISSING_ORDER', message: humanize('MISSING_ORDER') }, 400);
  }
  if (!userId) {
    return jsonResponse({ ok: false, error: 'MISSING_USER', message: humanize('MISSING_USER') }, 400);
  }
  const refund = await createRefund({ orderId, userId, reason });
  return jsonResponse({
    ok: true,
    refund,
    message: '退款申请已提交，主公会尽快审核',
  });
}

async function handleDecide(body) {
  const { refundId, action, reason } = body || {};
  if (!refundId) {
    return jsonResponse({ ok: false, error: 'MISSING_REFUND', message: humanize('MISSING_REFUND') }, 400);
  }
  if (action !== 'approve' && action !== 'reject') {
    return jsonResponse({
      ok: false,
      error: 'INVALID_ACTION',
      message: humanize('INVALID_ACTION'),
    }, 400);
  }
  const refund = action === 'approve'
    ? await approveRefund(refundId)
    : await rejectRefund(refundId, reason);
  return jsonResponse({
    ok: true,
    refund,
    message: action === 'approve' ? '已批准，请尽快转账' : '已拒绝',
  });
}

async function handleComplete(body) {
  const { refundId } = body || {};
  if (!refundId) {
    return jsonResponse({ ok: false, error: 'MISSING_REFUND', message: humanize('MISSING_REFUND') }, 400);
  }
  const refund = await completeRefund(refundId);
  return jsonResponse({
    ok: true,
    refund,
    message: '退款完成，积分已清零',
  });
}
