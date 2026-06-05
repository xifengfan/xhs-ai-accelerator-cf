# 小红书 AI 加速器 · Cloudflare Pages 版

> 部署平台：Cloudflare Pages（替代 Vercel，解决国内访问问题）
> 部署时间：2026-06-05
> 迁移执行：荀彧（canzhi）

## 🎯 部署目标

- ✅ 国内访问（Cloudflare 国内节点稳定）
- ✅ 0 成本（Cloudflare Pages 免费层够用）
- ✅ 全局 CDN（200+ 节点）
- ✅ 保留原 Vercel 版本作为兜底

## 📁 项目结构

```
xhs-cf-deploy/
├── functions/                  ← Cloudflare Pages Functions
│   ├── generate.js             ← AI 生成（标题/笔记）
│   ├── cache.js                ← 缓存管理
│   ├── affiliate.js            ← 联盟营销
│   ├── track.js                ← 埋点上报
│   ├── refund.js               ← 退款
│   ├── payment.js              ← 支付（人工核对）
│   └── lib/                    ← 公共模块
│       ├── deepseek.js
│       ├── prompts.js
│       ├── tier.js
│       ├── cache.js            ← 内存版（无 KV）
│       └── store.js            ← 内存版（无 Vercel KV）
├── images/                     ← 9 张配图（PNG + SVG）
├── _headers                    ← Cloudflare 缓存头
├── wrangler.toml               ← Cloudflare 部署配置
├── index.html / tools.html / pricing.html / methods.html / success.html
├── app.js / style.css
└── articles.json
```

## 🚀 部署步骤

### 1. 推送代码到 GitHub

```bash
cd xhs-cf-deploy
git init
git add .
git commit -m "迁移到 Cloudflare Pages by 荀彧"
git branch -M main
git remote add origin https://github.com/xifengfan/xhs-ai-accelerator-cf.git
git push -u origin main
```

### 2. 在 Cloudflare Pages 导入

- 打开 https://dash.cloudflare.com → Pages → Create application
- Connect to Git → 选 `xifengfan/xhs-ai-accelerator-cf`
- Build settings: **Framework preset = None**（不用 Next.js）
- Build command: 留空
- Build output directory: `.`

### 3. 配置环境变量

进入项目 → Settings → Environment variables：

| Variable | Value | Environment |
|:---|:---|:---:|
| `DEEPSEEK_API_KEY` | `sk-...`（从 Bitwarden 取）| Production |
| `WECHAT_PAYMENT_URL` | 主公微信收款码图片 URL | Production |

### 4. 触发首次部署

Cloudflare 会自动构建，URL 类似：
- `https://xhs-ai-accelerator.pages.dev`

### 5. 国内访问验证

- 主公国内 4G/5G 访问
- 朋友手机 4G/5G 访问
- 国内 CDN 节点（Cloudflare 智能分配）应 < 3s 首屏

## 🔧 与 Vercel 版的关键差异

| 维度 | Vercel 版 | Cloudflare 版 |
|:---|:---|:---|
| 后端运行时 | Node.js Serverless | Cloudflare Workers (V8) |
| KV 存储 | Vercel KV | **内存 Map**（降级）|
| 路由约定 | `api/*.js` | `functions/*.js` |
| Handler 签名 | `(req, res)` | `({request, env, ...})` |
| 环境变量 | `process.env.X` | `env.X` |
| 国内访问 | ❌ 受限 | ✅ 稳定 |

## 📝 注意事项

- **缓存为内存版**：Cloudflare Workers 单实例运行，重启后缓存清空（不致命，AI 调用成本极低）
- **订单/积分也是内存版**：MVP 阶段主公人工核对，重启后丢失不影响（用户重新下单即可）
- **L2 升级**：可接 Cloudflare KV 替代内存版（更持久）

## 🔗 在线地址

- Vercel 版（兜底）：https://xhs-ai-accelerator.vercel.app
- Cloudflare Pages 版（主流量）：https://xhs-ai-accelerator.pages.dev
- GitHub 仓库（待主公创建）：https://github.com/xifengfan/xhs-ai-accelerator-cf

---

_版本：v2.0 — 2026-06-05 — Cloudflare Pages 迁移版_
_执行人：荀彧（canzhi）_
