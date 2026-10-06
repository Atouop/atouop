// 首页数据读取（会话）+ 课表 / 手动待办写入
import {
  json, readBody, sessionFromRequest,
  emptyBlob, getBlob, saveBlob, randomToken
} from '../_lib/store.js';

// GET /api/today  → 当前账号的完整数据
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await sessionFromRequest(env, request);
  if (!session) return json({ error: '未登录' }, 401);
  const blob = (await getBlob(env, session.name)) || emptyBlob();
  return json(blob);
}

// POST /api/today  {action:'schedule'|'task', ...}
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await sessionFromRequest(env, request);
  if (!session) return json({ error: '未登录' }, 401);
  const body = await readBody(request);
  const blob = (await getBlob(env, session.name)) || emptyBlob();

  if (body.action === 'schedule') {
    if (body.schedule && typeof body.schedule === 'object') {
      blob.schedule = body.schedule;
    }
  } else if (body.action === 'task') {
    if (body.op === 'add') {
      const text = String(body.text || '').trim();
      if (text) {
        blob.tasks.push({
          id: 'm' + randomToken(10),
          text, due: body.due || '', source: 'manual',
          ts: Date.now(), done: false
        });
      }
    } else if (body.op === 'toggle') {
      const t = blob.tasks.find((x) => x.id === body.id);
      if (t) t.done = !!body.done;
    } else if (body.op === 'delete') {
      blob.tasks = blob.tasks.filter((x) => x.id !== body.id);
    }
  }

  await saveBlob(env, session.name, blob);
  return json(blob);
}

export const onRequestOptions = async () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});
