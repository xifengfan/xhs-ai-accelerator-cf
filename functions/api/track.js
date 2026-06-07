// ================================================
// functions/track.js
// 用途：埋点上报通道
// 路由：
//   POST /api/track    { event, payload, userId?, ts?, ua? }
//   GET  /api/track?date=YYYY-MM-DD
//   GET  /api/track?stats=1
// ================================================

import { recordEvent, queryEventsByDate, listEventDates } from './lib/store.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
  const { event, payload, userId, ts, ua } = body || {};
  if (!event || typeof event !== 'string') {
    return jsonResponse({
      ok: false,
      error: 'MISSING_EVENT',
      message: '缺少 event 字段',
    }, 400);
  }
  try {
    const entry = await recordEvent({ event, payload, userId, ts, ua });
    return jsonResponse({ ok: true, id: entry.id, date: entry.date });
  } catch (e) {
    console.error('[track] 上报失败', e);
    return jsonResponse({
      ok: false,
      error: 'INTERNAL',
      message: e.message || '上报失败',
    }, 500);
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const stats = url.searchParams.get('stats');
  const date = url.searchParams.get('date');

  if (stats === '1') {
    const dates = await listEventDates();
    return jsonResponse({ ok: true, dates, count: dates.length });
  }

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidDateStr(date)) {
      return jsonResponse({
        ok: false,
        error: 'INVALID_DATE',
        message: 'date 必须为合法的 YYYY-MM-DD',
      }, 400);
    }
    const events = await queryEventsByDate(date);
    return jsonResponse({ ok: true, date, count: events.length, events });
  }

  return jsonResponse({
    ok: false,
    error: 'MISSING_PARAMS',
    message: '需要 date 或 stats=1',
  }, 400);
}

function isValidDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
