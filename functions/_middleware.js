// 整站登录中间件：未登录访问任何页面/资源 → 跳转登录页
import { sessionFromRequest } from './_lib/store.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const p = url.pathname;

  // 直接放行：API、登录页、favicon、控制台（控制台自带密码）
  const allowPrefix = ['/api/'];
  const allowExact = ['/login.html', '/login', '/favicon.ico', '/robots.txt'];
  const allowFrag = ['/Atouop_control'];
  if (allowPrefix.some((x) => p.startsWith(x)) ||
      allowExact.includes(p) ||
      allowFrag.some((x) => p.startsWith(x))) {
    return next();
  }

  const session = await sessionFromRequest(env, request);
  if (session) {
    return next();
  }

  // 未登录 → 登录页（带上目标地址）
  const loginUrl = new URL('/login.html', url);
  if (p !== '/' && p !== '/index.html') loginUrl.searchParams.set('next', p);
  return Response.redirect(loginUrl.toString(), 302);
}
