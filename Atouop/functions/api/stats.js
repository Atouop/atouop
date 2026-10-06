// Cloudflare Pages Function: /api/stats
// 控制台读取访客统计；必须提供正确密码（与控制台门同密码），服务端做哈希比对。
const PW_HASH = 'cce5dbd7c63e46021dc9b6e3f32398b3d950a421322a4265157c64d16bf04c6f';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let out = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pw = url.searchParams.get('pw') || request.headers.get('X-Password') || '';
  let authorized = false;
  try { authorized = (await sha256(pw)) === PW_HASH; } catch (e) { authorized = false; }
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  let data = { hits: 0, uniq: {}, recent: [] };
  try {
    const raw = await env.VISITS.get('data');
    if (raw) data = JSON.parse(raw);
  } catch (e) {}
  const out = {
    hits: data.hits || 0,
    unique: Object.keys(data.uniq || {}).length,
    recent: (data.recent || []).slice(0, 100)
  };
  return new Response(JSON.stringify(out), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
