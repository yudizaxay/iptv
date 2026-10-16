const $ = id => document.getElementById(id);
const show = id => ['auth', 'sources', 'player'].forEach(s => $(s).classList.toggle('hidden', s !== id));
const loading = on => $('loading').classList.toggle('hidden', !on);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let token = localStorage.getItem('token');
let registerMode = false;
let sourceMode = 'xtream';
let state = { source: null, channels: [], group: 'All', q: '', current: null, favs: new Set() };
let hls = null, ts = null;

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(true); throw new Error('Session expired'); }
  if (!r.ok) throw new Error(data.error || `Request failed (HTTP ${r.status}) — the server did not answer in time`);
  return data;
}

function setWho(n) {
  $('whoami').textContent = n;
  $('botSay').textContent = `Hi ${n}! Pick a connection and press play.`;
}

// robot mascot: pupils follow the cursor, click it for a new line
(() => {
  const eyes = [...document.querySelectorAll('#bot .b-eye')];
  const lines = ['Pick a connection and press play.', 'Tip: star a channel to find it fast.', 'Beep boop. Your channels are ready.', 'Try the search box inside the player.', 'Dark mode is one click away.'];
  let i = 0;
  document.addEventListener('pointermove', e => {
    const bot = $('bot'); if (!bot.getBoundingClientRect().width) return;
    const r = bot.getBoundingClientRect(), k = r.width / 160;
    eyes.forEach(g => {
      const cx = r.left + g.dataset.cx * k, cy = r.top + g.dataset.cy * k;
      const a = Math.atan2(e.clientY - cy, e.clientX - cx), d = Math.min(5, Math.hypot(e.clientX - cx, e.clientY - cy) / 40);
      g.querySelector('.pupil').setAttribute('transform', `translate(${Math.cos(a) * d} ${Math.sin(a) * d})`);
    });
  });
  $('bot').parentElement.style.pointerEvents = 'auto';
  $('bot').parentElement.onclick = () => { $('botSay').textContent = lines[i++ % lines.length]; };
})();

// ---------- theme ----------
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('theme', t); } catch {}
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#eef1f8' : '#0f1220';
}
document.querySelectorAll('.theme-toggle').forEach(b => b.onclick = () =>
  setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

// ---------- auth ----------
$('authToggle').onclick = e => {
  e.preventDefault();
  registerMode = !registerMode;
  $('authTitle').textContent = registerMode ? 'Create account' : 'Sign in';
  $('authBtn').textContent = registerMode ? 'Create account' : 'Sign in';
  $('authToggle').textContent = registerMode ? 'Back to sign in' : 'Create an account';
  $('authErr').textContent = '';
};

$('authForm').onsubmit = async e => {
  e.preventDefault();
  $('authErr').textContent = '';
  const body = { username: $('aUser').value.trim(), password: $('aPass').value };
  try {
    if (registerMode) await api('/api/register', { method: 'POST', body });
    const r = await api('/api/login', { method: 'POST', body });
    token = r.token;
    localStorage.setItem('token', token);
    setWho(r.username);
    loadSources();
  } catch (err) { $('authErr').textContent = err.message; }
};

function logout(silent) {
  if (!silent && token) api('/api/logout', { method: 'POST' }).catch(() => {});
  token = null;
  localStorage.removeItem('token');
  stopPlayback();
  show('auth');
}
$('logout').onclick = () => logout();

// ---------- sources ----------
const TIPS = {
  xtream: ['Where do I find these?', 'Your provider sends a server address, a username and a password when you sign up. Paste them here exactly as received.'],
  m3u: ['Where do I find this?', 'Your provider gives you a playlist link that ends in .m3u or contains type=m3u. Paste the whole link.'],
};
function setMode(mode) {
  sourceMode = mode;
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.mode === mode; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $('xtreamFields').classList.toggle('hidden', mode !== 'xtream');
  $('urlLabel').textContent = mode === 'xtream' ? 'Server URL' : 'Playlist URL';
  $('sUrl').placeholder = mode === 'xtream' ? 'e.g. http://server.example.com:8080' : 'e.g. http://…/get.php?username=…&type=m3u_plus';
  $('srcTip').innerHTML = `<b>${TIPS[mode][0]}</b><span>${TIPS[mode][1]}</span>`;
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => setMode(b.dataset.mode));
setMode('xtream');

$('useDemo').onclick = () => {
  setMode('xtream');
  $('sName').value = 'Demo Xtream';
  $('sUrl').value = location.origin + '/demo';
  $('sUser').value = 'demo';
  $('sPass').value = 'demo';
};

const hostOf = u => { try { return new URL(u).host; } catch { return u; } };
let sources = [];

function renderSources() {
  const q = $('srcFilter').value.trim().toLowerCase();
  const list = sources.filter(s => !q || (s.name + ' ' + s.url).toLowerCase().includes(q));
  const box = $('srcList');
  box.innerHTML = '';
  $('srcCount').textContent = sources.length;
  $('srcFilterBox').classList.toggle('hidden', sources.length < 4);
  if (!sources.length) { box.innerHTML = '<div class="nosrc"><svg><use href="#i-server"/></svg><b>No connections yet</b><span>Add your first one on the right to see your channels.</span></div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="nosrc"><b>No match</b><span>Nothing called “' + esc(q) + '”. Try another word.</span></div>'; return; }
  list.forEach(s => {
    const x = s.type === 'xtream';
    const el = document.createElement('div');
    el.className = 'src';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = s.url;
    el.innerHTML = `<div class="ico ${x ? 'x' : 'm'}"><svg><use href="#${x ? 'i-server' : 'i-list'}"/></svg></div>
      <div class="t"><div><b>${esc(s.name)}</b></div><div class="muted small">${esc(hostOf(s.url))}</div></div>
      <span class="badge ${x ? 'x' : 'm'}">${x ? 'Xtream' : 'M3U'}</span>
      <button class="del" aria-label="Delete ${esc(s.name)}" title="Delete"><svg><use href="#i-trash"/></svg></button>
      <svg class="go"><use href="#i-back"/></svg>`;
    el.onclick = () => openSource(s);
    el.onkeydown = ev => { if (ev.target === el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openSource(s); } };
    const del = el.querySelector('.del');
    let armed = null;
    del.onclick = async ev => {
      ev.stopPropagation();
      if (!armed) {   // first click arms, second click deletes
        del.classList.add('armed');
        del.innerHTML = '<span>Delete?</span>';
        armed = setTimeout(() => { armed = null; del.classList.remove('armed'); del.innerHTML = '<svg><use href="#i-trash"/></svg>'; }, 3000);
        return;
      }
      clearTimeout(armed);
      await api('/api/sources/' + s.id, { method: 'DELETE' });
      loadSources();
    };
    box.appendChild(el);
  });
}
$('srcFilter').oninput = renderSources;

async function loadSources() {
  show('sources');
  sources = await api('/api/sources');
  renderSources();
}

$('srcForm').onsubmit = async e => {
  e.preventDefault();
  $('srcErr').textContent = '';
  const body = { name: $('sName').value.trim(), url: $('sUrl').value.trim() };
  if (sourceMode === 'xtream') { body.username = $('sUser').value.trim(); body.password = $('sPass').value.trim(); }
  const btn = $('srcBtn');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    const s = await api('/api/sources', { method: 'POST', body });
    $('srcForm').reset();
    await openSource(s);
  } catch (err) { $('srcErr').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Save & open'; }
};

async function openSource(src) {
  loading(true);
  try {
    const data = await api(`/api/sources/${src.id}/channels`);
    state = { source: src, channels: data.channels, group: 'All', q: '', current: null, favs: loadFavs(src.id) };
    $('search').value = '';
    show('player');
    renderGroups();
    renderChannels();
    setNow(null);
  } catch (err) {
    alert('Could not load channels: ' + err.message);
    loadSources();
  } finally { loading(false); }
}

// ---------- favourites (per device) ----------
const favKey = id => 'favs:' + id;
function loadFavs(id) { try { return new Set(JSON.parse(localStorage.getItem(favKey(id)) || '[]')); } catch { return new Set(); } }
function saveFavs() { localStorage.setItem(favKey(state.source.id), JSON.stringify([...state.favs])); }
const chKey = c => c.name + '|' + c.id;

// ---------- browse ----------
function renderGroups() {
  const counts = {};
  state.channels.forEach(c => counts[c.group] = (counts[c.group] || 0) + 1);
  const items = [['All', state.channels.length], ['★ Favourites', state.favs.size], ...Object.entries(counts)];
  $('groups').innerHTML = '';
  items.forEach(([g, n]) => {
    const d = document.createElement('div');
    d.className = g === state.group ? 'active' : '';
    d.innerHTML = `<span>${esc(g)}</span><span class="muted">${n}</span>`;
    d.onclick = () => { state.group = g; renderGroups(); renderChannels(); };
    $('groups').appendChild(d);
  });
}

function visible() {
  const q = state.q.toLowerCase();
  return state.channels.filter(c =>
    (state.group === 'All' || (state.group === '★ Favourites' ? state.favs.has(chKey(c)) : c.group === state.group)) &&
    (!q || c.name.toLowerCase().includes(q)));
}

function renderChannels() {
  const box = $('channels');
  box.innerHTML = '';
  const list = visible();
  if (!list.length) { box.innerHTML = '<div class="empty">No channels found.</div>'; return; }
  const frag = document.createDocumentFragment();
  list.slice(0, 1500).forEach(c => {
    const d = document.createElement('div');
    d.className = 'ch' + (state.current === c ? ' active' : '');
    const fav = state.favs.has(chKey(c));
    d.innerHTML = (c.logo ? `<img loading="lazy" src="${esc(c.logo)}" onerror="this.outerHTML='<div class=ph>TV</div>'">` : '<div class="ph">TV</div>') +
      `<div class="nm">${esc(c.name)}</div><span class="star ${fav ? 'on' : ''}">${fav ? '★' : ''}</span>`;
    d.onclick = () => play(c);
    frag.appendChild(d);
  });
  box.appendChild(frag);
}

let searchT;
$('search').oninput = e => { clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value; renderChannels(); }, 150); };
$('back').onclick = () => { stopPlayback(); loadSources(); };

// ---------- playback ----------
const video = $('video');
const proxy = u => `/proxy?t=${token}&u=${encodeURIComponent(u)}`;

function stopPlayback() {
  if (hls) { hls.destroy(); hls = null; }
  if (ts) { ts.destroy(); ts = null; }
  video.removeAttribute('src');
  video.load();
}

function setNow(c) {
  $('nowName').textContent = c ? c.name : '—';
  $('nowGroup').textContent = c ? '· ' + c.group : '';
  $('fav').classList.toggle('hidden', !c);
  if (c) $('fav').textContent = state.favs.has(chKey(c)) ? '★' : '☆';
}

$('fav').onclick = () => {
  const c = state.current; if (!c) return;
  const k = chKey(c);
  state.favs.has(k) ? state.favs.delete(k) : state.favs.add(k);
  saveFavs(); setNow(c); renderGroups(); renderChannels();
};

function overlay(msg) {
  $('overlay').textContent = msg || '';
  $('overlay').classList.toggle('off', !msg);
  $('overlay').classList.toggle('busy', /^(Loading|Buffering)/.test(msg || ''));
}

function play(c) {
  state.current = c;
  setNow(c);
  renderChannels();
  startStream(c, c.url, false);
}

function startStream(c, url, isTsRetry) {
  stopPlayback();
  overlay('Loading ' + c.name + '…');
  const isHls = /\.m3u8?(\?|$)/i.test(url) || !/\.(ts|mp4|mkv|flv)(\?|$)/i.test(url);
  const fail = reason => {
    if (state.current !== c) return;
    if (!isTsRetry && c.tsUrl) return startStream(c, c.tsUrl, true);   // Xtream: m3u8 failed → try raw .ts
    overlay('⚠ Stream unavailable. ' + (reason || 'The provider may be offline or the channel not supported in a browser.'));
  };

  if (isHls && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: false, maxBufferLength: 20 });
    hls.loadSource(proxy(url));
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== 'manifestLoadError') return hls.startLoad();
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
      const code = d.response && d.response.code;
      const why = { 403: 'The provider blocked access (geo-restricted or protected stream).', 404: 'This channel link is no longer active on the provider.', 0: 'The provider did not respond (offline or timed out).' };
      fail(d.details === 'manifestLoadError' ? (why[code] || why[0]) + (code ? ' [HTTP ' + code + ']' : '') : d.details);
    });
  } else if (!isHls && mpegts.getFeatureList().mseLivePlayback) {
    ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: proxy(url) });
    ts.attachMediaElement(video);
    ts.load();
    ts.play();
    ts.on(mpegts.Events.ERROR, () => fail());
  } else {
    video.src = proxy(url);                     // e.g. Safari native HLS
    video.play().catch(() => {});
  }
}

video.addEventListener('playing', () => overlay(''));
video.addEventListener('waiting', () => { if (state.current) overlay('Buffering…'); });
video.addEventListener('canplay', () => overlay(''));

// ---------- boot ----------
(async () => {
  if (!token) return show('auth');
  try {
    const me = await api('/api/me');
    setWho(me.username);
    loadSources();
  } catch { show('auth'); }
})();
