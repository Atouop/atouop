// 桥接写入端点：按“账号专属桥接密钥”定位账号，把该账号的待办/调课事件合并进去
// 鉴权：请求头 X-Bridge-Secret（每个账号一个，在控制台创建账号时签发）
import {
  json, sha256, getAccounts,
  emptyBlob, getBlob, saveBlob
} from '../_lib/store.js';

const MAX_TASKS = 400;
const MAX_EVENTS = 200;
const KEEP_DAYS = 45;

function dayStr(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function freshEnough(item, now) {
  const today = dayStr(now);
  if (item.due && item.due >= today) return true;
  if (item.date && item.date >= today) return true;
  if (item.ts && now - item.ts < KEEP_DAYS * 86400000) return true;
  return false;
}
async function accountBySecret(env, secret) {
  if (!secret) return null;
  const hash = await sha256(secret);
  const accounts = await getAccounts(env);
  for (const name of Object.keys(accounts)) {
    if (accounts[name].bridgeHash === hash) return { name, rec: accounts[name] };
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = request.headers.get('x-bridge-secret') || '';
  const found = await accountBySecret(env, secret);
  if (!found) return json({ ok: false, error: 'bad secret' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  const now = Date.now();
  const name = found.name;
  const blob = (await getBlob(env, name)) || emptyBlob();

  const tasks = new Map(blob.tasks.map((t) => [t.id, t]));
  (body.tasks || []).forEach((t) => {
    if (!t.id) return;
    tasks.set(t.id, Object.assign({}, tasks.get(t.id) || {}, t));
  });
  const events = new Map(blob.events.map((e) => [e.id, e]));
  (body.events || []).forEach((e) => {
    if (!e.id) return;
    events.set(e.id, Object.assign({}, events.get(e.id) || {}, e));
  });

  let taskArr = Array.from(tasks.values()).filter((t) => freshEnough(t, now));
  let eventArr = Array.from(events.values()).filter((e) => freshEnough(e, now));
  taskArr.sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
  eventArr.sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  if (taskArr.length > MAX_TASKS) taskArr = taskArr.slice(0, MAX_TASKS);
  if (eventArr.length > MAX_EVENTS) eventArr = eventArr.slice(0, MAX_EVENTS);

  blob.updated = now;
  blob.identity = body.identity || blob.identity || {};
  blob.online = body.online !== false;
  blob.tasks = taskArr;
  blob.events = eventArr;
  // schedule 不由桥接覆盖（保留面板导入的课表）
  blob.schedule = blob.schedule || { periods: [], courses: [] };

  await saveBlob(env, name, blob);
  return json({ ok: true, account: name, counts: { tasks: taskArr.length, events: eventArr.length } });
}

// GET：用同一密钥查看该账号数据（调试）
export async function onRequestGet(context) {
  const { request, env } = context;
  const secret = request.headers.get('x-bridge-secret') || '';
  const found = await accountBySecret(env, secret);
  if (!found) return json({ ok: false, error: 'bad secret' }, 401);
  const blob = (await getBlob(env, found.name)) || emptyBlob();
  return json(Object.assign({ ok: true, serverTime: Date.now(), account: found.name }, blob));
}

export const onRequestOptions = async () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Secret'
  }
});
