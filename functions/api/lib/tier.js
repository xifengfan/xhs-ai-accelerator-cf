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
// 实际可用的 DeepSeek 模型（2026-06 核对）：
// - deepseek-chat       → 主力，对应 "deepseek-v4-pro" 的角色（长文/复杂）
// - deepseek-reasoner   → 推理增强（高成本，仅必要时用）
// "deepseek-v4-pro/flash" 是文若 v3 模型库里的别名，DeepSeek 平台不识别，会返回 400
const TOOL_MODEL_MAP = {
  // 工具 1：标题生成 → 5 条短文本，模板化强，chat 足矣
  title: {
    model: 'deepseek-chat',
    maxTokens: 1024,
    temperature: 0.85,  // 标题要敢于发散
    credits: 1,
    rationale: '短文本生成 + 模板化强，用 chat 节省成本',
  },
  // 工具 2：笔记生成 → 450-550 字，5 段结构，要文采 → chat
  note: {
    model: 'deepseek-chat',
    maxTokens: 2048,
    temperature: 0.75,  // 笔记要有创意但不能太野
    credits: 1,
    rationale: '长文 + 结构化 + 创意发挥，chat 稳住',
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
    // 未知工具：默认降级到 chat（保守策略：省钱 + 异常易发现）
    return {
      model: 'deepseek-chat',
      maxTokens: 512,
      temperature: 0.7,
      credits: 1,
      rationale: `未知工具 "${tool}"，降级到 chat（请检查 TOOL_MODEL_MAP）`,
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
  // deepseek-chat ≈ 1元/百万 input token, 2元/百万 output
  const RATES = {
    'deepseek-chat': 2.0 / 1_000_000,    // 2 元/百万 token（取输出价保守估算）
    'deepseek-reasoner': 4.0 / 1_000_000,
  };
  const rate = RATES[model] || 2.0 / 1_000_000;
  return Number((totalTokens * rate).toFixed(6));
}

export {
  TOOL_MODEL_MAP,
  decideTier,
  estimateCost,
};
