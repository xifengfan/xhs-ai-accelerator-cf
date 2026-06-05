// ================================================
// functions/affiliate.js
// 用途：联盟营销链接下发
// 路由：
//   GET /api/affiliate              → 返回所有 3 个联盟位
//   GET /api/affiliate?slot=book    → 返回单个联盟位
// ================================================

const AFFILIATE_SLOTS = [
  {
    slot: 'xhs-book',
    title: '《小红书运营从入门到精通》',
    desc: '主公亲测的运营方法论书单，覆盖定位 / 选题 / 标题 / 排版全链路。',
    href: 'https://s.click.taobao.com/PLACEHOLDER_XHS_BOOK',
    tag: '书',
    icon: '📕',
  },
  {
    slot: 'ai-writing',
    title: '《AI 写作课：从 prompt 到成稿》',
    desc: '把 DeepSeek / Claude 真正用出生产力，3 周掌握商业文案的 AI 协作流程。',
    href: 'https://s.click.taobao.com/PLACEHOLDER_AI_WRITING',
    tag: '课',
    icon: '🎓',
  },
  {
    slot: 'reading-method',
    title: '《陪读方法：让孩子爱上阅读》',
    desc: '主公自家用的陪读方法书，适合 6-12 岁孩子的家长，每天 20 分钟见效果。',
    href: 'https://s.click.taobao.com/PLACEHOLDER_READING',
    tag: '书',
    icon: '📖',
  },
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const slot = url.searchParams.get('slot');

  if (slot) {
    const item = AFFILIATE_SLOTS.find(s => s.slot === slot);
    if (!item) {
      return jsonResponse({
        ok: false,
        error: 'SLOT_NOT_FOUND',
        message: `联盟位 ${slot} 不存在`,
        available: AFFILIATE_SLOTS.map(s => s.slot),
      }, 404);
    }
    const isPlaceholder = item.href.includes('PLACEHOLDER');
    return jsonResponse({ ok: true, isPlaceholder, item });
  }

  return jsonResponse({
    ok: true,
    count: AFFILIATE_SLOTS.length,
    items: AFFILIATE_SLOTS.map(item => ({
      ...item,
      isPlaceholder: item.href.includes('PLACEHOLDER'),
    })),
    note: 'L2 阶段由主公审核替换为真实联盟链接',
  });
}
