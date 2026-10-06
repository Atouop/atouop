// Cloudflare Pages Function: /api/visit
// 每次主页加载时上报一次访问，记录真实 IP、地理位置、UA、路径与时间。
export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  let ip = '';
  let rec = { ip: '', cc: '', region: '', city: '', tz: '', path: '', ua: '', ts: Date.now() };
  try {
    ip = request.headers.get('CF-Connecting-IP') || '';
    const cf = request.cf || {};
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const ua = (request.headers.get('User-Agent') || '').slice(0, 200);
    rec = {
      ip: ip,
      cc: cf.country || '',
      region: cf.region || '',
      city: cf.city || '',
      tz: cf.timezone || '',
      path: String(body.path || '').slice(0, 120),
      ua: ua,
      ts: Date.now()
    };
    // 后台写入，不阻塞响应
    waitUntil((async () => {
      const KEY = 'data';
      let data = { hits: 0, uniq: {}, recent: [] };
      try {
        const raw = await env.VISITS.get(KEY);
        if (raw) data = JSON.parse(raw);
      } catch (e) {}
      data.hits = (data.hits || 0) + 1;
      if (ip) {
        if (!data.uniq[ip]) data.uniq[ip] = rec.ts;
      }
      data.recent = Array.isArray(data.recent) ? data.recent : [];
      data.recent.unshift(rec);
      if (data.recent.length > 300) data.recent = data.recent.slice(0, 300);
      try {
        await env.VISITS.put(KEY, JSON.stringify({ hits: data.hits, uniq: data.uniq, recent: data.recent }));
      } catch (e) {}
    })());
  } catch (e) {
    // 任何异常都不影响页面
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// 兼容 GET 探测（不记录）
export async function onRequestGet() {
  return new Response(null, { status: 204 });
}
