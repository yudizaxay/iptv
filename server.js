const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });   // the folder is not in git, so create it on first run
const UA = 'Mozilla/5.0 (IPTV-WebPlayer MVP)';

// ---------- tiny JSON "database" ----------
let db = { users: [], sources: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const uid = () => crypto.randomBytes(8).toString('hex');

function hash(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verify(pw, stored) {
  const [salt] = stored.split(':');
  const a = Buffer.from(hash(pw, salt)), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
if (!db.users.length) {
  db.users.push({ id: uid(), username: 'demo', password: hash('demo123') });
  save();
}

const sessions = new Map(); // token -> userId

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/hls', express.static(path.join(__dirname, 'node_modules/hls.js/dist')));
app.use('/vendor/mpegts', express.static(path.join(__dirname, 'node_modules/mpegts.js/dist')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.t;
  const userId = sessions.get(token);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });
  req.userId = userId;
  req.token = token;
  next();
}

// ---------- accounts ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) return res.status(400).json({ error: 'Username and a password of 4+ characters required' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Username already taken' });
  db.users.push({ id: uid(), username, password: hash(password) });
  save();
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !verify(String(password || ''), user.password)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.id);
  res.json({ token, username: user.username });
});

app.post('/api/logout', auth, (req, res) => { sessions.delete(req.token); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ username: db.users.find(u => u.id === req.userId).username }));

// ---------- saved IPTV sources ----------
const publicSource = s => ({ id: s.id, name: s.name, type: s.type, url: s.url, username: s.username });

app.get('/api/sources', auth, (req, res) =>
  res.json(db.sources.filter(s => s.userId === req.userId).map(publicSource)));

app.post('/api/sources', auth, (req, res) => {
  let { name, url, username, password } = req.body || {};
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL must start with http:// or https://' });
  const type = username && password ? 'xtream' : 'm3u';
  const src = { id: uid(), userId: req.userId, name: name || new URL(url).host, type, url: url.replace(/\/+$/, ''), username: username || '', password: password || '' };
  db.sources.push(src);
  save();
  res.json(publicSource(src));
});

app.delete('/api/sources/:id', auth, (req, res) => {
  db.sources = db.sources.filter(s => !(s.id === req.params.id && s.userId === req.userId));
  save();
  res.json({ ok: true });
});

// ---------- channel loading ----------
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Provider responded ${r.status}`);
  return r.text();
}

function parseM3U(text) {
  const channels = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attr = k => (line.match(new RegExp(k + '="([^"]*)"', 'i')) || [])[1] || '';
      cur = {
        name: line.slice(line.lastIndexOf(',') + 1).trim() || attr('tvg-name'),
        logo: attr('tvg-logo'),
        group: attr('group-title') || 'Other',
        number: attr('tvg-chno'),
      };
    } else if (line && !line.startsWith('#') && cur) {
      cur.url = line;
      channels.push(cur);
      cur = null;
    }
  }
  return channels;
}

app.get('/api/sources/:id/channels', auth, async (req, res) => {
  const src = db.sources.find(s => s.id === req.params.id && s.userId === req.userId);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  try {
    let channels;
    if (src.type === 'xtream') {
      const api = `${src.url}/player_api.php?username=${encodeURIComponent(src.username)}&password=${encodeURIComponent(src.password)}`;
      const info = JSON.parse(await getText(api));
      if (info.user_info && info.user_info.auth === 0) throw new Error('Provider rejected the username/password');
      const [cats, streams] = await Promise.all([
        getText(api + '&action=get_live_categories').then(JSON.parse),
        getText(api + '&action=get_live_streams').then(JSON.parse),
      ]);
      const catName = Object.fromEntries((cats || []).map(c => [c.category_id, c.category_name]));
      channels = (streams || []).map(s => ({
        name: s.name,
        logo: s.stream_icon || '',
        group: catName[s.category_id] || 'Other',
        number: s.num,
        // m3u8 first (browser friendly); client falls back to ts
        url: `${src.url}/live/${encodeURIComponent(src.username)}/${encodeURIComponent(src.password)}/${s.stream_id}.m3u8`,
        tsUrl: `${src.url}/live/${encodeURIComponent(src.username)}/${encodeURIComponent(src.password)}/${s.stream_id}.ts`,
      }));
    } else {
      channels = parseM3U(await getText(src.url));
      if (!channels.length) throw new Error('No channels found in that playlist');
    }
    channels.forEach((c, i) => (c.id = i));
    res.json({ channels, groups: [...new Set(channels.map(c => c.group))] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});


// ---------- built-in DEMO Xtream server (free public channels from iptv-org, only live ones kept) ----------
const DEMO_SOURCES = [
  'https://iptv-org.github.io/iptv/categories/news.m3u',
  'https://iptv-org.github.io/iptv/categories/music.m3u',
  'https://iptv-org.github.io/iptv/categories/movies.m3u',
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
  'https://iptv-org.github.io/iptv/countries/in.m3u',
];
let demoCache = null;
async function buildDemo() {
  const all = [];
  for (const u of DEMO_SOURCES) {
    try { parseM3U(await getText(u)).filter(c => /\.m3u8(\?|$)/i.test(c.url)).slice(0, 40).forEach(c => all.push(c)); } catch {}
  }
  const seen = new Set();
  const uniq = all.filter(c => !seen.has(c.url) && seen.add(c.url));
  const alive = [];
  let i = 0;
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (i < uniq.length) {
      const c = uniq[i++];
      try {
        const r = await fetch(c.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        const t = r.ok ? await r.text() : '';
        if (t.trimStart().startsWith('#EXTM3U')) alive.push(c);
      } catch {}
    }
  }));
  alive.forEach((c, n) => { c.id = n + 1; c.group = c.group.split(';')[0]; });
  const groups = [...new Set(alive.map(c => c.group))];
  console.log(`Demo Xtream: ${alive.length} live channels ready`);
  return { channels: alive, groups };
}
const getDemo = () => (demoCache ||= buildDemo());
getDemo();

app.get('/demo/player_api.php', async (req, res) => {
  const { username, password, action } = req.query;
  if (username !== 'demo' || password !== 'demo') return res.json({ user_info: { auth: 0 } });
  const d = await getDemo();
  if (action === 'get_live_categories') return res.json(d.groups.map((g, i) => ({ category_id: String(i + 1), category_name: g, parent_id: 0 })));
  if (action === 'get_live_streams') return res.json(d.channels.map((c, n) => ({
    num: n + 1, name: c.name, stream_type: 'live', stream_id: c.id, stream_icon: c.logo,
    category_id: String(d.groups.indexOf(c.group) + 1),
  })));
  res.json({ user_info: { auth: 1, status: 'Active', username: 'demo' }, server_info: { url: req.headers.host } });
});

app.get('/demo/live/:u/:p/:id', async (req, res) => {
  if (req.params.u !== 'demo' || req.params.p !== 'demo') return res.status(403).end();
  const d = await getDemo();
  const c = d.channels.find(x => x.id === parseInt(req.params.id, 10));
  if (!c || req.params.id.endsWith('.ts')) return res.status(404).end();
  res.redirect(c.url);
});

// ---------- streaming proxy (fixes CORS / mixed content, rewrites HLS playlists) ----------
const proxied = (url, token) => `/proxy?t=${token}&u=${encodeURIComponent(url)}`;

app.get('/proxy', auth, async (req, res) => {
  const target = String(req.query.u || '');
  if (!/^https?:\/\//i.test(target)) return res.status(400).end();
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const headers = { 'User-Agent': UA };
    if (req.headers.range) headers.Range = req.headers.range;
    const up = await fetch(target, { headers, signal: ac.signal, redirect: 'follow' });
    const ctype = up.headers.get('content-type') || '';
    const finalUrl = up.url || target;
    const isPlaylist = /mpegurl/i.test(ctype) || /\.m3u8?(\?|$)/i.test(finalUrl);

    if (isPlaylist && up.ok) {
      const text = await up.text();
      if (text.trimStart().startsWith('#EXTM3U')) {
        const abs = u => proxied(new URL(u, finalUrl).href, req.token);
        const out = text.split(/\r?\n/).map(l => {
          if (!l.trim()) return l;
          if (l.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (_, u) => `URI="${abs(u)}"`);
          return abs(l.trim());
        }).join('\n');
        res.set('Content-Type', 'application/vnd.apple.mpegurl').set('Cache-Control', 'no-store').send(out);
        return;
      }
      return res.status(up.status).send(text);
    }

    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    if (!up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

app.listen(PORT, () => console.log(`IPTV Web Player running on http://localhost:${PORT}  (demo login: demo / demo123)`));
