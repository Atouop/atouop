// 网盘直链解析 API（百度网盘）
// Vercel Serverless Function · 需要环境变量 BDUSS（你的百度网盘登录凭证）
// 流程：验证分享 → 列出文件（含子目录递归）→ 转存到账号 /atouop_tmp → 取官方 dlink 直链
const UA = 'netdisk;12.24.6;piano;android-android;16;JSbridge4.4.0;jointBridge;1.1.0';
const APP_ID = '250528';

function cookie() {
  return 'BDUSS=' + (process.env.BDUSS || '');
}

async function jfetch(url, opts = {}) {
  const headers = Object.assign({
    'User-Agent': UA,
    'Referer': 'https://pan.baidu.com/',
    'Cookie': cookie(),
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://pan.baidu.com',
  }, opts.headers || {});
  const res = await fetch(url, Object.assign({ headers }, opts));
  return res.json();
}

function qs(obj) {
  return Object.keys(obj).map(k => k + '=' + encodeURIComponent(obj[k])).join('&');
}

// 从分享链接提取 surl
function extractSurl(url) {
  const m = String(url || '').match(/s\/1[A-Za-z0-9_-]+/);
  return m ? m[0].slice(2) : '';
}

// 1. 验证分享，换取会话
async function verify(surl, pwd) {
  const url = 'https://pan.baidu.com/share/verify?surl=' + encodeURIComponent(surl) +
    '&pwd=' + encodeURIComponent(pwd || '') + '&vcode=&vcode_str=';
  const j = await jfetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({ surl: surl, pwd: pwd || '', vcode: '', vcode_str: '' }),
  });
  if (j.errno !== 0) {
    const map = { '-9': '链接已失效或不存在', '-62': '提取码错误', '-12': '需要验证码（分享被风控）' };
    throw new Error(map[j.errno] || ('验证失败（errno=' + j.errno + '）'));
  }
  return { shareid: j.shareid, uk: j.uk, sekey: j.sekey, randsk: j.randsk };
}

// 2. 列出分享目录
async function listFiles(shareid, uk, randsk, dir) {
  const url = 'https://pan.baidu.com/share/list?shareid=' + shareid + '&uk=' + uk +
    '&randsk=' + encodeURIComponent(randsk || '') + '&root=' + (dir ? '0' : '1') +
    '&dir=' + encodeURIComponent(dir || '');
  const j = await jfetch(url);
  if (j.errno !== 0) throw new Error('列文件失败（errno=' + j.errno + '）');
  return j.list || [];
}

// 递归收集所有文件
async function collectFiles(shareid, uk, randsk, dir, depth, out) {
  const items = await listFiles(shareid, uk, randsk, dir);
  for (const it of items) {
    if (it.isdir === 1) {
      if (depth < 6) await collectFiles(shareid, uk, randsk, it.path, depth + 1, out);
    } else {
      out.push({ fs_id: it.fs_id, name: it.server_filename, size: it.size, path: it.path });
    }
  }
  return out;
}

// 3. 取 bdstoken
async function getBdstoken() {
  const url = 'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=' + APP_ID +
    '&web=1&fields=%5B%22bdstoken%22%5D';
  const j = await jfetch(url);
  if (!j.result || !j.result.bdstoken) throw new Error('获取 bdstoken 失败（登录态可能失效）');
  return j.result.bdstoken;
}

// 4. 转存文件
async function transfer(shareid, uk, sekey, fsid, bdstoken) {
  const url = 'https://pan.baidu.com/share/transfer?shareid=' + shareid + '&from=' + uk +
    '&sekey=' + encodeURIComponent(sekey || '') + '&fsidlist=%5B%22' + fsid +
    '%22%5D&path=%2Fatouop_tmp&ondup=newcopy&bdstoken=' + bdstoken;
  const j = await jfetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({ shareid: shareid, from: uk, sekey: sekey || '', fsidlist: '["' + fsid + '"]', path: '/atouop_tmp', ondup: 'newcopy', bdstoken: bdstoken }),
  });
  if (j.errno !== 0) throw new Error('转存失败（errno=' + j.errno + '）');
}

// 5. 取 dlink 直链
async function getDlink(fsid, bdstoken) {
  const url = 'https://pan.baidu.com/api/filemetas?dlink=1&fsids=%5B' + fsid + '%5D&bdstoken=' + bdstoken;
  const j = await jfetch(url);
  if (j.errno !== 0 || !j.info || !j.info[0]) throw new Error('取直链失败（errno=' + j.errno + '）');
  return j.info[0];
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  const g = n / 1024 / 1024 / 1024;
  if (g >= 1) return g.toFixed(2) + ' GB';
  const m = n / 1024 / 1024;
  if (m >= 1) return m.toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: '仅支持 GET' });
  if (!process.env.BDUSS) return res.status(500).json({ ok: false, error: '服务端未配置 BDUSS（请在 Vercel 环境变量中配置）' });

  const url = req.query.url || '';
  const pwd = req.query.pwd || '';
  const surl = extractSurl(url);
  if (!surl) return res.status(400).json({ ok: false, error: '无法从链接中识别分享码' });

  try {
    const sess = await verify(surl, pwd);
    const files = await collectFiles(sess.shareid, sess.uk, sess.randsk, '', 0, []);
    if (!files.length) return res.json({ ok: true, files: [], note: '分享中没有可下载的文件' });
    if (files.length > 50) files.length = 50; // 单次最多 50 个文件

    const bdstoken = await getBdstoken();
    const results = [];
    for (const f of files) {
      try {
        await transfer(sess.shareid, sess.uk, sess.sekey, f.fs_id, bdstoken);
        const meta = await getDlink(f.fs_id, bdstoken);
        results.push({ name: f.name, size: f.size, sizeText: fmtSize(f.size), dlink: meta.dlink || '', path: f.path });
      } catch (e) {
        results.push({ name: f.name, size: f.size, sizeText: fmtSize(f.size), dlink: '', error: e.message });
      }
    }
    return res.json({ ok: true, files: results });
  } catch (e) {
    return res.json({ ok: false, error: e.message || '解析失败' });
  }
}
