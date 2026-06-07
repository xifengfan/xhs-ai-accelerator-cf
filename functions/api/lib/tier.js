// ================================================
// api/lib/tier.js
// D2 by 吕玲绮
// 用途：分级 API 决策（标题用 flash，笔记用 pro）
// 原则：能便宜就便宜，复杂任务才上 pro
// 成本：deepseek-v4-flash ≈ 0.14元/百万token，deepseek-v4-pro ≈ 1元/百万token
// ================================================

/**
 * 工具 → 模型映射表
 * 简单工具（短文本、模板化）→ flash
 * 复杂工具（长文、结构化、创意发挥）→ pro
 */
const TOOL_MODEL_MAP = {
  // 工具 1：标题生成 → 5 条短文本，模板化强，flash 足矣
  title: {
    model: 'deepseek-v4-flash',
    maxTokens: 1024,
    temperature: 0.85,  // 标题要敢于发散
    credits: 1,
    rationale: '短文本生成 + 模板化强，用 flash 节省成本',
  },
  // 工具 2：笔记生成 → 450-550 字，5 段结构，要文采 → pro
  note: {
    model: 'deepseek-v4-pro',
    maxTokens: 2048,
    temperature: 0.75,  // 笔记要有创意但不能太野
    credits: 1,
    rationale: '长文 + 结构化 + 创意发挥，pro 才能稳住',
  },
};

/**
 * 决策模型
 * @param {string} tool - 工具名 ('title' | 'note')
 * @returns {{model: string, maxTokens: number, temperature: number, credits: number, rationale: string}}
 */
function decideTier(tool) {
  const cfg = TOOL_MODEL_MAP[tool];
  if (!cfg) {
    // 未知工具：默认降级到 flash（保守策略：省钱 + 异常易发现）
    return {
      model: 'deepseek-v4-flash',
      maxTokens: 512,
      temperature: 0.7,
      credits: 1,
      rationale: `未知工具 "${tool}"，降级到 flash（请检查 TOOL_MODEL_MAP）`,
      isFallback: true,
    };
  }
  return { ...cfg, isFallback: false };
}

/**
 * 估算成本（仅供调试日志，不作为计费依据）
 * @param {string} model
 * @param {number} totalTokens
 * @returns {number} 人民币元
 */
function estimateCost(model, totalTokens) {
  // DeepSeek 公开价格（2026-06 核对：缓存命中不计费）
  const RATES = {
    'deepseek-v4-pro': 1.0 / 1_000_000,    // 1 元/百万 token
    'deepseek-v4-flash': 0.14 / 1_000_000,  // 0.14 元/百万 token
  };
  const rate = RATES[model] || 1.0 / 1_000_000;
  return Number((totalTokens * rate).toFixed(6));
}

export {
  TOOL_MODEL_MAP,
  decideTier,
  estimateCost,
};
