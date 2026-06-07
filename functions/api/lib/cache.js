// ================================================
// functions/lib/cache.js
// 用途：Cloudflare Pages Functions 内存缓存（无 KV 依赖）
// 键：hash(tool + input)
// TTL：24 小时
// 注：原 Vercel KV 适配器已移除——Cloudflare Pages 单实例运行足够，
//     且 DeepSeek 调用成本极低（0.0001 元/千字），缓存边际效益小
// ================================================

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 小时
const CACHE_PREFIX = 'xhs:ai:';

// 进程内 Map（Cloudflare Pages Functions 单实例共享）
const memCache = new Map();

/**
 * 生成稳定缓存键（FNV-1a 32-bit 哈希）
 */
export function makeCacheKey(tool, input) {
  const text = `${CACHE_PREFIX}${tool}:${input}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return CACHE_PREFIX + hash.toString(16);
}

/**
 * 读缓存
 */
export async function cacheGet(tool, input) {
  const key = makeCacheKey(tool, input);
  const entry = memCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) memCache.delete(key);
  return null;
}

/**
 * 写缓存
 */
export async function cacheSet(tool, input, value) {
  const key = makeCacheKey(tool, input);
  memCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
  });
}

/**
 * 删除指定缓存
 */
export async function cacheDel(tool, input) {
  const key = makeCacheKey(tool, input);
  memCache.delete(key);
}

/**
 * 缓存统计
 */
export async function cacheStats() {
  return {
    backend: 'memory',
    ttlSeconds: CACHE_TTL_SECONDS,
    memSize: memCache.size,
  };
}

export { CACHE_TTL_SECONDS };
