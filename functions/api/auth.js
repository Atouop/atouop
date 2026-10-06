// 账号登录 / 登出 / 当前会话
import {
  json, readBody, sha256, getAccounts, saveAccounts,
  sessionFromRequest, createSession, deleteSession,
  attachSessionCookie, clearSessionCookie
} from '../_lib/store.js';

export const onRequestOptions = async () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});

// POST /api/auth  {account, token} 或 {action:'logout'}
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await readBody(request);

  if (body.action === 'logout') {
    const cur = await sessionFromRequest(env, request);
    if (cur) await deleteSession(env, cur.sid);
    const res = json({ ok: true });
    clearSessionCookie(res);
    return res;
  }

  const account = String(body.account || '').trim();
  const token = String(body.token || '');
  if (!account || !token) return json({ error: '请输入账号和 token' }, 400);

  const accounts = await getAccounts(env);
  const rec = accounts[account];
  if (!rec) return json({ error: '账号不存在' }, 401);

  const tokenHash = await sha256(token);
  if (tokenHash !== rec.tokenHash) return json({ error: 'token 错误' }, 401);

  rec.lastSeen = Date.now();
  await saveAccounts(env, accounts);

  const sid = await createSession(env, account);
  const res = json({ ok: true, account, role: rec.role || 'member' });
  attachSessionCookie(res, sid);
  return res;
}

// GET /api/auth  → 当前登录账号
export async function onRequestGet(context) {
  const { request, env } = context;
  const cur = await sessionFromRequest(env, request);
  if (!cur) return json({ authenticated: false }, 401);
  const accounts = await getAccounts(env);
  const rec = accounts[cur.name] || {};
  return json({ authenticated: true, account: cur.name, role: rec.role || 'member' });
}
