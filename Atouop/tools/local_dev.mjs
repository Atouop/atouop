import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const ROOT = 'D:/Atouop';
const ROOT_NORM = path.resolve(ROOT);
const PORT = 8787;
const TMP = path.join(os.tmpdir(), 'atouop_local');
fs.mkdirSync(TMP, { recursive: true });
const KV_FILE = path.join(TMP, 'kv.json');

// 初始演示数据（模拟几位不同地区的访客）
if (!fs.existsSync(KV_FILE)) {
  const now = Date.now();
  const seed = {
    hits: 4,
    uniq: {
      '114.114.114.114': now - 1000 * 60 * 60 * 26,
      '203.0.113.7': now - 1000 * 60 * 60 * 5,
      '198.51.100.22': now - 1000 * 60 * 42
    },
    recent: [
      { ip: '198.51.100.22', cc: 'CN', region: 'Guangdong', city: 'Shenzhen', tz: 'Asia/Shanghai', path: '/', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/120', ts: now - 1000 * 60 * 42 },
      { ip: '203.0.113.7', cc: 'US', region: 'New York', city: 'New York', tz: 'America/New_York', path: '/index.html', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120', ts: now - 1000 * 60 * 60 * 5 },
      { ip: '114.114.114.114', cc: 'CN', region: 'Yunnan', city: 'Kunming', tz: 'Asia/Shanghai', path: '/', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604', ts: now - 1000 * 60 * 60 * 26 },
      { ip: '114.114.114.114', cc: 'CN', region: 'Yunnan', city: 'Kunming', tz: 'Asia/Shanghai', path: '/', ua: 'Mozilla/5.0 (iPhone) Mobile Safari/604', ts: now - 1000 * 60 * 60 * 26 }
    ]
  };
  fs.writeFileSync(KV_FILE, JSON.stringify({ data: JSON.stringify(seed) }));
}

const kv = {
  async get(k) { const all = JSON.parse(fs.readFileSync(KV_FILE, 'utf8')); return all[k] ?? null; },
  async put(k, v) { const all = JSON.parse(fs.readFileSync(KV_FILE, 'utf8')); all[k] = v; fs.writeFileSync(KV_FILE, JSON.stringify(all)); }
};
const env = { VISITS: kv };

const visitMod = await import(pathToFileURL(path.join(ROOT, 'functions/api/visit.js')).href);
const statsMod = await import(pathToFileURL(path.join(ROOT, 'functions/api/stats.js')).href);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // API
  if (url.pathname === '/api/visit' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) {}
      const ctx = {
        request: {
          headers: { get: (h) => (h === 'CF-Connecting-IP' ? '127.0.0.1' : h === 'User-Agent' ? req.headers['user-agent'] : null) },
          cf: { country: 'CN', region: 'Yunnan', city: 'Kunming', timezone: 'Asia/Shanghai' },
          json: async () => parsed
        },
        env, waitUntil: (p) => { p.catch(() => {}); return p; }
      };
      const r = await visitMod.onRequestPost(ctx);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(await r.text());
    });
    return;
  }
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    const ctx = {
      request: { url: 'http://localhost:' + PORT + req.url, headers: { get: (h) => (h === 'X-Password' ? req.headers['x-password'] : null) } },
      env
    };
    const r = await statsMod.onRequestGet(ctx);
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
    return;
  }
  // 静态
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  let fp = path.resolve(ROOT_NORM, '.' + p);
  if (!fp.startsWith(ROOT_NORM)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('local dev server on http://localhost:' + PORT));
