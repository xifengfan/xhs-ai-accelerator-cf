// ================================================
// functions/api/debug-env.js
// 用途：诊断 env 是否加载成功（临时 debug 端点）
// 路由：GET /api/debug-env
// 适配：Cloudflare Pages Functions
// ================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  // 仅暴露存在与否 + 长度（不暴露实际值）
  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    env: {
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY ? `✓ set (${env.DEEPSEEK_API_KEY.length} chars)` : '✗ missing',
      WECHAT_PAYMENT_URL: env.WECHAT_PAYMENT_URL ? `✓ set (${env.WECHAT_PAYMENT_URL.length} chars, value: ${env.WECHAT_PAYMENT_URL})` : '✗ missing',
    },
  };
  return jsonResponse(result);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }
  return onRequestGet(context);
}
