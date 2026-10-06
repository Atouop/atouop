import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

const visitMod = await import(pathToFileURL('D:/Atouop/functions/api/visit.js').href);
const statsMod = await import(pathToFileURL('D:/Atouop/functions/api/stats.js').href);

// 内存 KV
const mem = new Map();
const env = {
  VISITS: {
    get: async (k) => (mem.has(k) ? mem.get(k) : null),
    put: async (k, v) => mem.set(k, v)
  }
};

function mkRequest({ ip, ua, cf, body }) {
  return {
    headers: {
      get: (h) => (h === 'CF-Connecting-IP' ? ip : h === 'User-Agent' ? ua : null)
    },
    cf: cf || {},
    json: async () => body || {}
  };
}

// 模拟两次访问（不同 IP）
const ctx1 = {
  request: mkRequest({ ip: '1.2.3.4', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36', cf: { country: 'CN', region: 'Yunnan', city: 'Kunming', timezone: 'Asia/Shanghai' }, body: { path: '/' } }),
  env,
  waitUntil: (p) => p
};
const ctx2 = {
  request: mkRequest({ ip: '5.6.7.8', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1', cf: { country: 'US', region: 'California', city: 'San Francisco', timezone: 'America/Los_Angeles' }, body: { path: '/index.html' } }),
  env,
  waitUntil: (p) => p
};
// 同一 IP 再访问一次（验证独立访客不重复计数）
const ctx3 = {
  request: mkRequest({ ip: '1.2.3.4', ua: 'Mozilla/5.0 Chrome/120', cf: { country: 'CN', region: 'Yunnan', city: 'Kunming' }, body: { path: '/' } }),
  env,
  waitUntil: (p) => p
};

await visitMod.onRequestPost(ctx1);
await visitMod.onRequestPost(ctx2);
await visitMod.onRequestPost(ctx3);

// 错误密码
const badReq = { url: 'https://x/api/stats?pw=wrong', headers: { get: () => null } };
const badRes = await statsMod.onRequestGet({ request: badReq, env });
console.log('wrong password status:', badRes.status, '(expect 401)');

// 正确密码（query）
const goodReq = { url: 'https://x/api/stats?pw=3145269078', headers: { get: () => null } };
const goodRes = await statsMod.onRequestGet({ request: goodReq, env });
const data = JSON.parse(await goodRes.text());
console.log('auth status:', goodRes.status, '(expect 200)');
console.log('hits:', data.hits, '(expect 3)');
console.log('unique:', data.unique, '(expect 2)');
console.log('recent count:', data.recent.length, '(expect 3)');
console.log('latest rec:', JSON.stringify(data.recent[0], null, 0));

// 验证 KV 原始结构
const raw = JSON.parse(mem.get('data'));
console.log('KV keys:', Object.keys(raw));
console.log('uniq map:', raw.uniq);
