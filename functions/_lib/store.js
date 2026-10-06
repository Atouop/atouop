// Atouop 多租户共享存储库（Pages Functions 内部模块，不作为路由）
// KV 键：
//   accounts        账号注册表
//   u:<name>        每个账号的数据（tasks/events/schedule/identity/online）
//   s:<sid>         会话（带 TTL）

export const CONSOLE_PW_HASH = 'cce5dbd7c63e46021dc9b6e3f32398b3d950a421322a4265157c64d16bf04c6f';
export const SESSION_TTL = 60 * 60 * 24 * 7; // 7 天
export const COOKIE_NAME = 'atouop_sid';

// 由作息表图片校准的默认作息（13 节）
export const DEFAULT_PERIODS = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['09:50', '10:35'], ['10:40', '11:25'], ['11:30', '12:15'],
  ['13:30', '14:15'], ['14:20', '15:05'], ['15:10', '15:55'], ['16:10', '16:55'], ['17:00', '17:45'],
  ['19:00', '19:45'], ['19:50', '20:35'], ['20:40', '21:25']
].map((p) => ({ start: p[0], end: p[1] }));

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(n = 20) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- 账号注册表 ----
export async function getAccounts(env) {
  const raw = await env.VISITS.get('accounts');
  return raw ? JSON.parse(raw) : {};
}
export async function saveAccounts(env, accounts) {
  await env.VISITS.put('accounts', JSON.stringify(accounts));
}

// ---- 每账号数据 blob ----
export function emptyBlob() {
  return {
    updated: 0, identity: {}, online: false,
    tasks: [], events: [], schedule: { periods: DEFAULT_PERIODS, courses: [] }
  };
}
export async function getBlob(env, name) {
  const raw = await env.VISITS.get('u:' + name);
  return raw ? JSON.parse(raw) : null;
}
export async function saveBlob(env, name, blob) {
  await env.VISITS.put('u:' + name, JSON.stringify(blob));
}

// ---- 会话 ----
export function parseCookies(request) {
  const h = request.headers.get('Cookie') || '';
  const out = {};
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
      catch (e) { /* ignore */ }
    }
  });
  return out;
}
function setCookieHeader(response, value) {
  response.headers.append('Set-Cookie', value);
}
export function attachSessionCookie(response, sid) {
  setCookieHeader(
    response,
    `${COOKIE_NAME}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`
  );
}
export function clearSessionCookie(response) {
  setCookieHeader(
    response,
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}
export async function createSession(env, name) {
  const sid = randomToken(24);
  await env.VISITS.put('s:' + sid, JSON.stringify({ name, c: Date.now() }),
    { expirationTtl: SESSION_TTL });
  return sid;
}
export async function getSession(env, sid) {
  if (!sid) return null;
  const raw = await env.VISITS.get('s:' + sid);
  return raw ? JSON.parse(raw) : null;
}
export async function deleteSession(env, sid) {
  if (sid) await env.VISITS.delete('s:' + sid);
}
// 从请求 cookie 解析当前会话；返回 {sid, name} 或 null
export async function sessionFromRequest(env, request) {
  const sid = parseCookies(request)[COOKIE_NAME];
  const s = await getSession(env, sid);
  if (!s) return null;
  return { sid, name: s.name };
}

// ---- 控制台密码 ----
export async function verifyConsolePw(pw) {
  if (!pw) return false;
  return (await sha256(String(pw))) === CONSOLE_PW_HASH;
}
