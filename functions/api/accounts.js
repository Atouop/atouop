// 控制台账号管理（需控制台密码）：创建 / 列表 / 删除 / 重置
import {
  json, readBody, verifyConsolePw,
  sha256, randomToken, getAccounts, saveAccounts,
  getBlob, saveBlob, emptyBlob
} from '../_lib/store.js';

async function authed(request) {
  const u = new URL(request.url);
  let pw = u.searchParams.get('pw') || '';
  let body = null;
  if (request.method === 'POST') {
    body = await readBody(request);
    pw = pw || body.pw || '';
  }
  if (!(await verifyConsolePw(pw))) return { ok: false, body };
  return { ok: true, body };
}

// GET /api/accounts?pw=...
export async function onRequestGet(context) {
  const { request, env } = context;
  const a = await authed(request);
  if (!a.ok) return json({ ok: false, error: 'bad password' }, 401);
  const accounts = await getAccounts(env);
  const list = [];
  for (const name of Object.keys(accounts)) {
    const rec = accounts[name];
    const blob = (await getBlob(env, name)) || null;
    list.push({
      name,
      role: rec.role || 'member',
      created: rec.created || 0,
      lastSeen: rec.lastSeen || 0,
      online: blob ? !!blob.online : false,
      updated: blob ? blob.updated || 0 : 0,
      tasks: blob ? (blob.tasks || []).length : 0,
      events: blob ? (blob.events || []).length : 0,
      courses: blob && blob.schedule ? (blob.schedule.courses || []).length : 0
    });
  }
  list.sort((a, b) => a.created - b.created);
  return json({ ok: true, accounts: list });
}

// POST /api/accounts?pw=...
export async function onRequestPost(context) {
  const { request, env } = context;
  const a = await authed(request);
  if (!a.ok) return json({ ok: false, error: 'bad password' }, 401);
  const body = a.body || {};
  const action = body.action;
  const accounts = await getAccounts(env);

  if (action === 'create') {
    const name = String(body.name || '').trim();
    if (!name) return json({ ok: false, error: '请填写账号名' }, 400);
    if (accounts[name]) return json({ ok: false, error: '账号已存在' }, 400);
    const token = String(body.token || '').trim() || randomToken(16);
    const bridge = randomToken(20);
    const role = Object.keys(accounts).length === 0 ? 'owner' : (body.role || 'member');
    accounts[name] = {
      name,
      tokenHash: await sha256(token),
      bridgeHash: await sha256(bridge),
      role,
      created: Date.now(),
      lastSeen: 0
    };
    await saveAccounts(env, accounts);
    await saveBlob(env, name, emptyBlob());
    return json({ ok: true, name, role, token, bridge });
  }

  if (action === 'delete') {
    const name = String(body.name || '').trim();
    const rec = accounts[name];
    if (!rec) return json({ ok: false, error: '账号不存在' }, 404);
    if (rec.role === 'owner') {
      const owners = Object.values(accounts).filter((x) => x.role === 'owner');
      if (owners.length <= 1) return json({ ok: false, error: '不能删除最后一个站长账号' }, 400);
    }
    delete accounts[name];
    await saveAccounts(env, accounts);
    await env.VISITS.delete('u:' + name);
    return json({ ok: true });
  }

  if (action === 'reset') {
    const name = String(body.name || '').trim();
    const rec = accounts[name];
    if (!rec) return json({ ok: false, error: '账号不存在' }, 404);
    const kind = body.kind === 'bridge' ? 'bridge' : 'token';
    if (kind === 'token') {
      const token = String(body.token || '').trim() || randomToken(16);
      rec.tokenHash = await sha256(token);
      await saveAccounts(env, accounts);
      return json({ ok: true, token });
    }
    const bridge = randomToken(20);
    rec.bridgeHash = await sha256(bridge);
    await saveAccounts(env, accounts);
    return json({ ok: true, bridge });
  }

  return json({ ok: false, error: '未知操作' }, 400);
}

export const onRequestOptions = async () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});
