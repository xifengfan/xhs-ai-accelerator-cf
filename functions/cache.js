// ================================================
// functions/cache.js
// 用途：缓存管理端点（debug 用）
// 路由：
//   GET  /api/cache?tool=...&input=...   → 查询缓存
//   GET  /api/cache?stats=1              → 查看缓存统计
//   POST /api/cache  { tool, input, action: 'get' | 'del' }
// ================================================

import { cacheGet, cacheDel, cacheStats, makeCacheKey } from './lib/cache.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 统计查询
  if (url.searchParams.get('stats') === '1') {
    const stats = await cacheStats();
    return jsonResponse({ ok: true, ...stats });
  }

  // GET 查询
  const tool = url.searchParams.get('tool');
  const input = url.searchParams.get('input');
  if (!tool || !input) {
    return jsonResponse({
      ok: false,
      error: 'MISSING_PARAMS',
      message: '需要 tool 和 input 参数',
    }, 400);
  }

  const cacheKey = makeCacheKey(tool, input);
  const value = await cacheGet(tool, input);
  return jsonResponse({
    ok: true,
    action: 'get',
    cacheKey,
    hit: value !== null,
    value: value || null,
  });
}

export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const tool = (body && body.tool) || '';
  const input = (body && body.input) || '';
  const action = (body && body.action) || 'get';

  if (!tool || !input) {
    return jsonResponse({
      ok: false,
      error: 'MISSING_PARAMS',
      message: '需要 tool 和 input 参数',
    }, 400);
  }

  const cacheKey = makeCacheKey(tool, input);

  if (action === 'del' || action === 'delete') {
    await cacheDel(tool, input);
    return jsonResponse({ ok: true, action: 'del', cacheKey });
  }

  const value = await cacheGet(tool, input);
  return jsonResponse({
    ok: true,
    action: 'get',
    cacheKey,
    hit: value !== null,
    value: value || null,
  });
}
