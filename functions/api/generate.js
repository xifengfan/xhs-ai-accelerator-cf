// ================================================
// functions/generate.js
// 用途：AI 生成端点（标题 / 笔记）
// 路由：POST /api/generate  { tool: 'title'|'note', input: string }
// 适配：Cloudflare Pages Functions（context.env + Request/Response）
// ================================================

import { callDeepSeek, safeParseJson } from './lib/deepseek.js';
import { buildTitlePrompt, buildNotePrompt } from './lib/prompts.js';
import { decideTier, estimateCost } from './lib/tier.js';
import { cacheGet, cacheSet } from './lib/cache.js';

const TOOL_HANDLERS = {
  title: {
    buildPrompt: (input) => buildTitlePrompt(input),
    parseResult: (rawContent) => {
      const parsed = safeParseJson(rawContent);
      if (!Array.isArray(parsed)) {
        throw new Error('标题生成响应不是数组');
      }
      if (parsed.length === 0) {
        throw new Error('标题生成响应为空数组');
      }
      const titles = parsed
        .filter(t => t && typeof t.title === 'string' && t.title.trim())
        .slice(0, 5)
        .map((t, i) => ({
          title: t.title.trim(),
          formulaId: t.formula_id || t.formulaId || null,
          formulaName: t.formula_name || t.formulaName || null,
          hook: t.hook || '',
          emoji: t.emoji || '',
          rank: i + 1,
        }));
      if (titles.length === 0) {
        throw new Error('标题生成响应无有效 title 字段');
      }
      return titles;
    },
  },
  note: {
    buildPrompt: (input) => buildNotePrompt(input),
    parseResult: (rawContent) => {
      const parsed = safeParseJson(rawContent);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('笔记生成响应不是对象');
      }
      if (!parsed.note || typeof parsed.note !== 'string') {
        throw new Error('笔记生成响应缺少 note 字段');
      }
      return {
        note: parsed.note.trim(),
        wordCount: parsed.word_count || parsed.wordCount || parsed.note.length,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
        structure: parsed.structure || null,
      };
    },
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const startTs = Date.now();
  const { request, env } = context;

  // 1. 参数解析
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({
      ok: false,
      error: 'INVALID_JSON',
      message: '请求体不是合法 JSON',
    }, 400);
  }

  const { tool, input } = body || {};
  if (!tool || typeof tool !== 'string') {
    return jsonResponse({
      ok: false,
      error: 'INVALID_TOOL',
      message: '缺少 tool 字段（应为 "title" 或 "note"）',
    }, 400);
  }
  if (!input || typeof input !== 'string' || !input.trim()) {
    return jsonResponse({
      ok: false,
      error: 'INVALID_INPUT',
      message: '缺少 input 字段或为空',
    }, 400);
  }
  const handler = TOOL_HANDLERS[tool];
  if (!handler) {
    return jsonResponse({
      ok: false,
      error: 'UNKNOWN_TOOL',
      message: `不支持的工具：${tool}（仅支持 title / note）`,
    }, 400);
  }

  // 2. 读取 API Key
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('[generate] DEEPSEEK_API_KEY 未配置');
    return jsonResponse({
      ok: false,
      error: 'SERVER_MISCONFIGURED',
      message: '服务端未配置 DEEPSEEK_API_KEY',
    }, 500);
  }

  // 3. 分级选模型
  const tier = decideTier(tool);
  const prompt = handler.buildPrompt(input.trim());

  // 4. 查缓存
  let cached = null;
  try {
    cached = await cacheGet(tool, input.trim());
  } catch (e) {
    console.warn('[generate] 缓存读失败，继续走 API', e.message);
  }
  if (cached) {
    return jsonResponse({
      ok: true,
      tool,
      cached: true,
      tier: { model: tier.model, rationale: tier.rationale },
      data: cached.data,
      usage: cached.usage || null,
      cost: cached.cost || 0,
      elapsedMs: Date.now() - startTs,
    });
  }

  // 5. 调 DeepSeek
  let deepseekResp;
  try {
    deepseekResp = await callDeepSeek({
      apiKey,
      prompt,
      model: tier.model,
      maxTokens: tier.maxTokens,
      temperature: tier.temperature,
      timeoutMs: 28000,
    });
  } catch (e) {
    console.error('[generate] DeepSeek 调用失败', e);
    const status = e.code === 'TIMEOUT' ? 504
                 : e.code === 'MISSING_API_KEY' ? 500
                 : e.code === 'NETWORK_ERROR' ? 502
                 : e.status && e.status >= 400 && e.status < 600 ? 502
                 : 500;
    return jsonResponse({
      ok: false,
      error: e.code || 'INTERNAL',
      message: e.message || 'AI 调用失败，请稍后重试',
    }, status);
  }

  // 6. 解析结果
  let parsedData;
  try {
    parsedData = handler.parseResult(deepseekResp.content);
  } catch (e) {
    console.error('[generate] 解析失败', e, '\n原始内容:', deepseekResp.content.slice(0, 500));
    return jsonResponse({
      ok: false,
      error: 'PARSE_FAILED',
      message: 'AI 返回内容解析失败，请重试',
      rawPreview: deepseekResp.content.slice(0, 300),
    }, 502);
  }

  // 7. 计算成本
  const totalTokens = (deepseekResp.usage && (deepseekResp.usage.total_tokens || 0)) || 0;
  const cost = estimateCost(deepseekResp.model, totalTokens);

  // 8. 写缓存
  try {
    await cacheSet(tool, input.trim(), {
      data: parsedData,
      usage: deepseekResp.usage,
      cost,
    });
  } catch (e) {
    console.warn('[generate] 缓存写失败', e.message);
  }

  // 9. 返回
  return jsonResponse({
    ok: true,
    tool,
    cached: false,
    tier: { model: deepseekResp.model, rationale: tier.rationale },
    data: parsedData,
    usage: deepseekResp.usage,
    cost,
    elapsedMs: Date.now() - startTs,
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResponse({
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      message: '仅支持 POST 请求',
    }, 405);
  }
  return onRequestPost(context);
}
