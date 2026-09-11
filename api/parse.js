// 网盘直链解析 API（百度网盘）
// Vercel Serverless Function · 需要环境变量 BDUSS（你的百度网盘登录凭证）
// 流程：init 分享页提取 shareid/uk → verify 验证提取码（拿 BDCLND 会话 Cookie）→ 递归列文件
//       → 转存到账号 /atouop_tmp → 取官方 dlink 直链
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const APP_ID = '250528';

let COOKIE = process.env.BDUSS ? 'BDUSS=' + process.env.BDUSS : '';

function qs(obj) {
  return Object.keys(obj).map(k => k + '=' + encodeURIComponent(obj[k])).join('&');
}

// 通用请求：自动合并 Set-Cookie 到会话
async function jfetch(url, opts = {}) {
  const headers = Object.assign({
    'User-Agent': UA,
    'Referer': 'https://pan.baidu.com/',
    'Cookie': COOKIE,
    'Accept': 'application/json, text/plain, */*',
  }, opts.headers || {});
  const res = await fetch(url, Object.assign({ headers }, opts));
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const parts = sc.split(/,\s*(?=[A-Za-z_]+=)/);
    for (const p of parts) {
      const kv = p.split(';')[0];
      if (!kv || /^(expires|path|domain|max-age|secure|httponly|samesite)/i.test(kv)) continue;
      const k = kv.split('=')[0].trim();
      COOKIE = COOKIE.split(';').map(c => c.trim()).filter(c => c && c.split('=')[0] !== k).join('; ') + '; ' + kv;
    }
  }
  return res.json();
}

// 从分享链接提取短码（去掉开头的 1）
function extractSurl(url) {
  const m = String(url || '').match(/s\/1([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

// 1. 打开分享页，提取 shareid / share_uk（HTML 内嵌）
async function initShare(surl) {
  const url = 'https://pan.baidu.com/share/init?surl=' + encodeURIComponent(surl);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://pan.baidu.com/share/init?surl=' + encodeURIComponent(surl),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const t = await res.text();
  const sid = t.match(/shareid:"(\d+)"/);
  const su = t.match(/share_uk:"(\d+)"/);
  if (!sid || !su) throw new Error('无法解析分享信息（链接可能已失效）');
  return { shareid: sid[1], uk: su[1] };
}

// 2. 验证提取码，换取会话 Cookie（BDCLND）
async function verify(surl, pwd) {
  const url = 'https://pan.baidu.com/share/verify?surl=' + encodeURIComponent(surl) +
    '&pwd=' + encodeURIComponent(pwd || '') + '&vcode=&vcode_str=';
  const j = await jfetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://pan.baidu.com/share/init?surl=' + encodeURIComponent(surl),
    },
    body: qs({ surl: surl, pwd: pwd || '', vcode: '', vcode_str: '' }),
  });
  if (j.errno !== 0) {
    const map = { '-9': '链接已失效或不存在', '-62': '提取码错误', '-12': '需要验证码（分享被风控）' };
    throw new Error(map[j.errno] || ('验证失败（errno=' + j.errno + '）'));
  }
}

// 3. 列出分享目录（xpan 客户端接口，规避网页接口对数据中心 IP 的风控）
async function listFiles(shareid, uk, dir, surl, pwd) {
  let url = 'https://pan.baidu.com/rest/2.0/xpan/share?method=list&shorturl=' + encodeURIComponent(surl) +
    '&pwd=' + encodeURIComponent(pwd || '') +
    '&page=1&num=100&root=' + (dir ? '0' : '1');
  if (dir) url += '&dir=' + encodeURIComponent(dir);
  const j = await jfetch(url, {
    headers: {
      'User-Agent': 'netdisk;12.24.6;piano;android-android;16;JSbridge4.4.0;jointBridge;1.1.0',
      'Referer': 'https://pan.baidu.com/',
    },
  });
  if (j.errno !== 0) {
    const map = {
      '-9': '百度风控拦截：列文件失败（分享解析已失效，请用电脑端 LinkSwift）',
      '9019': '百度风控拦截：列文件失败（分享解析已失效，请用电脑端 LinkSwift）',
    };
    throw new Error(map[j.errno] || ('列文件失败（errno=' + j.errno + '）'));
  }
  return j.list || [];
}

// 递归收集所有文件
async function collectFiles(shareid, uk, dir, depth, out, surl, pwd) {
  const items = await listFiles(shareid, uk, dir, surl, pwd);
  for (const it of items) {
    if (String(it.isdir) === '1') {
      if (depth < 6) await collectFiles(shareid, uk, it.path, depth + 1, out, surl, pwd);
    } else {
      out.push({ fs_id: it.fs_id, name: it.server_filename, size: it.size, path: it.path });
    }
  }
  return out;
}

// 4. 取 bdstoken
async function getBdstoken() {
  const url = 'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=' + APP_ID +
    '&web=1&fields=%5B%22bdstoken%22%5D';
  const j = await jfetch(url);
  if (!j.result || !j.result.bdstoken) throw new Error('获取 bdstoken 失败（登录态可能失效）');
  return j.result.bdstoken;
}

// 5. 转存文件到账号 /atouop_tmp
async function transfer(shareid, uk, fsid, bdstoken) {
  const url = 'https://pan.baidu.com/share/transfer?shareid=' + shareid + '&from=' + uk +
    '&fsidlist=%5B%22' + fsid + '%22%5D&path=%2Fatouop_tmp&ondup=newcopy&bdstoken=' + bdstoken;
  const j = await jfetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({ shareid: shareid, from: uk, fsidlist: '["' + fsid + '"]', path: '/atouop_tmp', ondup: 'newcopy', bdstoken: bdstoken }),
  });
  if (j.errno !== 0) throw new Error('转存失败（errno=' + j.errno + '）');
}

// 6. 取 dlink 直链
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
  const dir = req.query.dir || '';
  const surl = extractSurl(url);
  if (!surl) return res.status(400).json({ ok: false, error: '无法从链接中识别分享码' });

  try {
    const sess = await initShare(surl);
    await verify(surl, pwd);
    const files = await collectFiles(sess.shareid, sess.uk, dir, 0, [], surl, pwd);
    if (!files.length) return res.json({ ok: true, files: [], note: '分享中没有可下载的文件' });
    if (files.length > 50) files.length = 50; // 单次最多 50 个文件

    const bdstoken = await getBdstoken();
    const results = [];
    for (const f of files) {
      try {
        await transfer(sess.shareid, sess.uk, f.fs_id, bdstoken);
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
