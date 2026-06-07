// ================================================
// functions/payment.js
// 用途：微信支付「人工核对版」API
// 路由：
//   POST /api/payment           { packageId, userId, paymentUrl? }
//   POST /api/payment/confirm   { orderId }
//   GET  /api/payment?orderId=xxx
//   GET  /api/payment?userId=xxx
//   GET  /api/payment?packages=1
// ================================================

import {
  createOrder,
  fulfillOrder,
  getOrder,
  getUserPoints,
  listPackages,
} from './lib/store.js';

const HUMAN_MESSAGES = {
  MISSING_PACKAGE:    '套餐信息缺失，请刷新页面后重试。',
  MISSING_USER:       '用户未识别，请刷新页面后重试。',
  UNKNOWN_PACKAGE:    '该套餐已下架，请回到「定价」页选其他套餐。',
  ORDER_NOT_FOUND:    '找不到这笔订单，请刷新页面或联系主公查询。',
  MISSING_ORDER:      '订单号缺失，请刷新页面后重试。',
  MISSING_PARAMS:     '请求参数不完整，请刷新页面后重试。',
  METHOD_NOT_ALLOWED: '请求方式不支持，请刷新页面后重试。',
  INTERNAL:           '服务出了点小问题，主公已知悉，请稍后重试。',
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
  if (code === 'UNKNOWN_PACKAGE' || code === 'MISSING_USER') return 400;
  if (code === 'ORDER_NOT_FOUND') return 404;
  if (code === 'INVALID_STATUS') return 409;
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
  const { request, env } = context;
  const url = new URL(request.url);
  const body = await readJson(request);
  if (body === null) {
    return jsonResponse({ ok: false, error: 'INVALID_JSON', message: '请求体不是合法 JSON' }, 400);
  }

  try {
    if (url.pathname.includes('/confirm')) {
      return await handleConfirm(body);
    }
    return await handleCreate(body, env);
  } catch (e) {
    console.error('[payment] 异常', e);
    return jsonResponse({
      ok: false,
      error: e.code || 'INTERNAL',
      message: humanize(e.code || 'INTERNAL', '支付服务出了点小问题，请稍后重试。'),
    }, statusForError(e.code));
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  const userId = url.searchParams.get('userId');
  const packages = url.searchParams.get('packages');

  try {
    if (packages === '1') {
      return jsonResponse({ ok: true, packages: listPackages() });
    }
    if (orderId) {
      const order = await getOrder(orderId);
      if (!order) {
        return jsonResponse({
          ok: false,
          error: 'ORDER_NOT_FOUND',
          message: humanize('ORDER_NOT_FOUND'),
        }, 404);
      }
      return jsonResponse({ ok: true, order });
    }
    if (userId) {
      const points = await getUserPoints(userId);
      return jsonResponse({ ok: true, userId, points });
    }
    return jsonResponse({
      ok: false,
      error: 'MISSING_PARAMS',
      message: humanize('MISSING_PARAMS'),
    }, 400);
  } catch (e) {
    console.error('[payment] GET 异常', e);
    return jsonResponse({
      ok: false,
      error: e.code || 'INTERNAL',
      message: humanize(e.code || 'INTERNAL', '支付服务出了点小问题，请稍后重试。'),
    }, statusForError(e.code));
  }
}

async function handleCreate(body, env) {
  const { packageId, userId, paymentUrl } = body || {};
  if (!packageId) {
    return jsonResponse({
      ok: false,
      error: 'MISSING_PACKAGE',
      message: humanize('MISSING_PACKAGE'),
    }, 400);
  }
  if (!userId) {
    return jsonResponse({
      ok: false,
      error: 'MISSING_USER',
      message: humanize('MISSING_USER'),
    }, 400);
  }
  const DEFAULT_PAYMENT_URL = env.WECHAT_PAYMENT_URL || 'https://placeholder.example.com/wechat-qr.png';
  const order = await createOrder({
    userId,
    packageId,
    paymentUrl: paymentUrl || DEFAULT_PAYMENT_URL,
  });
  return jsonResponse({
    ok: true,
    order,
    instructions: {
      step1: '长按识别下方收款码完成支付',
      step2: '支付完成后，主公会在 10 分钟内核对到账',
      step3: '到账确认后，积分自动到账，可刷新本页面查看',
    },
  });
}

async function handleConfirm(body) {
  const { orderId } = body || {};
  if (!orderId) {
    return jsonResponse({
      ok: false,
      error: 'MISSING_ORDER',
      message: humanize('MISSING_ORDER'),
    }, 400);
  }
  const result = await fulfillOrder(orderId);
  return jsonResponse({
    ok: true,
    order: result.order,
    points: result.points,
    message: '到账确认成功，积分已发放',
  });
}
