const crypto = require('crypto');
const fs = require('fs');

const SRC = 'D:/Atouop/console.master';
const OUT = 'D:/Atouop/Atouop_control.html';
const PASSWORD = '3145269078';
const ITER = 250000;

const src = fs.readFileSync(SRC, 'utf8');

// ---- 提取 <style> 内容 ----
const stA = src.indexOf('<style>') + '<style>'.length;
const stB = src.indexOf('</style>', stA);
const css = src.substring(stA, stB);

// ---- 提取受保护的 HTML：<header class="top"> 到 <script> 之前（含 header + wrap）----
const hStart = src.indexOf('<header class="top">');
const sStart = src.indexOf('<script>');
const protectedHtml = src.substring(hStart, sStart).trim();

// ---- 提取受保护的 JS ----
const jsA = src.indexOf('<script>') + '<script>'.length;
const jsB = src.indexOf('</script>', jsA);
const protectedJs = src.substring(jsA, jsB);

// ---- 加密 ----
const payload = JSON.stringify({ html: protectedHtml, js: protectedJs });
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(PASSWORD, salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const blob = JSON.stringify({
  s: salt.toString('base64'),
  i: iv.toString('base64'),
  t: tag.toString('base64'),
  d: ct.toString('base64')
});

// ---- 锁屏 CSS ----
const lockCss = `
  #app { position: relative; z-index: 1; }
  #lock {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    background: radial-gradient(1200px 600px at 50% -10%, rgba(61,123,255,0.16), transparent 60%), rgba(5,7,12,0.72);
    backdrop-filter: blur(6px);
  }
  #lock.hidden { display: none; }
  .lock-card {
    width: 100%; max-width: 380px;
    border: 1px solid var(--line-strong); border-radius: 16px;
    background: rgba(10,17,34,0.92);
    padding: 30px 28px 26px; text-align: center;
    box-shadow: 0 24px 70px rgba(0,0,0,0.55);
  }
  .lock-logo {
    font-family: var(--mono); font-weight: 700; letter-spacing: 0.08em;
    font-size: 1.12rem; color: var(--text);
  }
  .lock-sub { color: var(--muted); font-size: 0.84rem; margin: 10px 0 22px; }
  #lock-pw {
    width: 100%; background: var(--bg); color: var(--text);
    border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px; font-size: 1rem; font-family: var(--mono);
    outline: none; text-align: center; letter-spacing: 0.12em;
  }
  #lock-pw:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  #lock-pw:disabled { opacity: 0.55; }
  #lock-go {
    width: 100%; margin-top: 14px; cursor: pointer;
    border: none; border-radius: 10px; padding: 12px;
    background: var(--accent); color: #fff; font-size: 0.95rem; font-family: var(--sans);
    transition: filter 0.2s;
  }
  #lock-go:hover { filter: brightness(1.12); }
  #lock-go:disabled { opacity: 0.6; cursor: default; }
  #lock-err { color: var(--danger); font-size: 0.82rem; min-height: 1.1em; margin-top: 12px; }
  .lock-back { display: inline-block; margin-top: 10px; color: var(--muted); font-size: 0.8rem; text-decoration: none; }
  .lock-back:hover { color: var(--accent); }
  #lock.shake .lock-card { animation: lockshake 0.4s; }
  @keyframes lockshake {
    0%,100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(5px); }
  }
`;

// ---- 解密 loader ----
const loader = `
(function () {
  var app = document.getElementById('app');
  var lock = document.getElementById('lock');
  var pw = document.getElementById('lock-pw');
  var go = document.getElementById('lock-go');
  var errBox = document.getElementById('lock-err');
  var subBox = document.querySelector('.lock-sub');
  var SESSION_KEY = 'atouop:ctrl:session';
  var PWSTORE_KEY = 'atouop:ctrl:pw';
  var FAIL_KEY = 'atouop:ctrl:fails';
  var LOCK_KEY = 'atouop:ctrl:lockuntil';
  var MAX_TRIES = 5;
  var COOLDOWN = 300000; // 5 分钟
  var cdTimer = null;

  function getFails() { return parseInt(localStorage.getItem(FAIL_KEY) || '0', 10) || 0; }
  function setFails(n) { localStorage.setItem(FAIL_KEY, String(n)); }
  function getLockUntil() { return parseInt(localStorage.getItem(LOCK_KEY) || '0', 10) || 0; }
  function setLockUntil(t) { if (t) localStorage.setItem(LOCK_KEY, String(t)); else localStorage.removeItem(LOCK_KEY); }
  function resetAttempts() { localStorage.removeItem(FAIL_KEY); setLockUntil(0); }
  function updateSub() {
    var f = getFails();
    subBox.textContent = f > 0 ? ('私人管理面板 · 还可尝试 ' + (MAX_TRIES - f) + ' 次') : '私人管理面板 · 请输入访问密码';
  }

  function b64ToBuf(b64) {
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }
  async function deriveKey(password, salt) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
      { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decrypt(password) {
    var blob = JSON.parse(document.getElementById('enc').textContent);
    var salt = b64ToBuf(blob.s), iv = b64ToBuf(blob.i);
    var data = b64ToBuf(blob.d), tag = b64ToBuf(blob.t);
    var key = await deriveKey(password, salt);
    var ct = new Uint8Array(data.length + tag.length);
    ct.set(data, 0); ct.set(tag, data.length);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function mount(payload, password) {
    window.__ctrlPw = password || '';
    app.innerHTML = payload.html;
    app.hidden = false;
    var s = document.createElement('script');
    s.textContent = payload.js;
    document.body.appendChild(s);
    lock.classList.add('hidden');
  }
  try {
    var saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) { mount(JSON.parse(saved), sessionStorage.getItem(PWSTORE_KEY) || ''); return; }
  } catch (e) {}
  function showError(msg) {
    errBox.textContent = msg;
    lock.classList.remove('shake');
    void lock.offsetWidth;
    lock.classList.add('shake');
    pw.value = ''; pw.focus();
  }
  function tickLockout() {
    var remain = getLockUntil() - Date.now();
    if (remain <= 0) {
      clearInterval(cdTimer);
      resetAttempts();
      pw.disabled = false; go.disabled = false;
      errBox.textContent = '';
      updateSub();
      pw.focus();
      return;
    }
    var s = Math.ceil(remain / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    subBox.textContent = '访问已临时锁定';
    errBox.textContent = '5 次机会已用完，请 ' + m + ' 分 ' + (sec < 10 ? '0' : '') + sec + ' 秒后再试';
  }
  function enterLockout() {
    pw.disabled = true; go.disabled = true;
    pw.value = '';
    tickLockout();
    cdTimer = setInterval(tickLockout, 1000);
  }
  var busy = false;
  async function submit() {
    if (busy) return;
    if (getLockUntil() > Date.now()) return;
    var pwd = pw.value;
    if (!pwd) { showError('请输入密码'); return; }
    busy = true; go.disabled = true; go.textContent = '验证中…';
    try {
      var payload = await decrypt(pwd);
      resetAttempts();
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
        sessionStorage.setItem(PWSTORE_KEY, pwd);
      } catch (e) {}
      mount(payload, pwd);
    } catch (e) {
      busy = false; go.disabled = false; go.textContent = '进入控制台';
      var f = getFails() + 1;
      setFails(f);
      if (f >= MAX_TRIES) {
        setLockUntil(Date.now() + COOLDOWN);
        enterLockout();
      } else {
        showError('密码错误，还剩 ' + (MAX_TRIES - f) + ' 次机会');
        updateSub();
      }
    }
  }
  go.addEventListener('click', submit);
  pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  if (getLockUntil() > Date.now()) {
    enterLockout();
  } else {
    if (getLockUntil() && getLockUntil() <= Date.now()) resetAttempts();
    updateSub();
    pw.focus();
  }
})();
`;

const head = src.substring(0, src.indexOf('<style>'));
const favicon = (src.match(/<link rel="icon"[^>]*>/) || [''])[0];

const out = head +
  '<style>' + css + lockCss + '</style>\n' +
  '</head>\n<body>\n' +
  '<canvas id="stars" aria-hidden="true"></canvas>\n' +
  '<div id="app" hidden></div>\n\n' +
  '<div id="lock">\n' +
  '  <div class="lock-card">\n' +
  '    <div class="lock-logo">ATOUOP_CONTROL</div>\n' +
  '    <div class="lock-sub">私人管理面板 · 请输入访问密码</div>\n' +
  '    <input id="lock-pw" type="password" placeholder="密码" autocomplete="off" inputmode="numeric">\n' +
  '    <button id="lock-go" type="button">进入控制台</button>\n' +
  '    <div id="lock-err"></div>\n' +
  '    <a class="lock-back" href="index.html">← 返回主页</a>\n' +
  '  </div>\n' +
  '</div>\n\n' +
  '<script id="enc" type="application/json">' + blob + '</script>\n' +
  '<script>\n' + loader.replace('ITER', String(ITER)) + '\n</script>\n' +
  '</body>\n</html>\n';

fs.writeFileSync(OUT, out, 'utf8');
console.log('WROTE', OUT, (out.length / 1024).toFixed(1) + 'KB');
console.log('protected html len', protectedHtml.length, 'js len', protectedJs.length);
