// SAO Gear Optimizer — local server (no dependencies).
// Run: node server.js   (add --open to launch the browser)
// Environment (all optional): PORT, HOST, DATA_DIR (where Items/ and Data/ live; seeded from the
// app folder on first start), APP_PASSWORD (+ APP_USER) to require a login.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3077;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
const PUBLIC_DIR = path.join(ROOT, 'public');
const ITEMS_DIR = path.join(DATA_ROOT, 'Items', 'Accessories');
const IMAGES_DIR = path.join(ITEMS_DIR, 'images');
const SETS_DIR = path.join(DATA_ROOT, 'Items', 'Sets');
const TEXTURES_DIR = path.join(ROOT, 'Textures');
const DATA_DIR = path.join(DATA_ROOT, 'Data');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const AUTH_USER = process.env.APP_USER || '';
const AUTH_PASSWORD = process.env.APP_PASSWORD || '';

const MAX_BODY = 12 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,100}$/;
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

// ---------- helpers ----------
function slugify(s) {
  const slug = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
  return WIN_RESERVED.test(slug) ? `${slug}-item` : slug;
}

function validId(id) {
  return typeof id === 'string' && ID_RE.test(id) && !id.includes('..') && !WIN_RESERVED.test(id);
}

async function ensureDirs() {
  // A fresh data folder (e.g. a new server volume) starts with the items, sets and profile shipped with the app.
  if (DATA_ROOT !== ROOT && !fs.existsSync(path.join(DATA_ROOT, 'Items'))) {
    for (const d of ['Items', 'Data']) {
      if (fs.existsSync(path.join(ROOT, d))) await fsp.cp(path.join(ROOT, d), path.join(DATA_ROOT, d), { recursive: true });
    }
    console.log(`  Seeded ${DATA_ROOT} with the bundled items and profile`);
  }
  for (const d of [ITEMS_DIR, IMAGES_DIR, SETS_DIR, DATA_DIR]) await fsp.mkdir(d, { recursive: true });
}

function sameSecret(a, b) {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function authorized(req) {
  if (!AUTH_PASSWORD) return true;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  const userOk = !AUTH_USER || sameSecret(decoded.slice(0, colon), AUTH_USER);
  return sameSecret(decoded.slice(colon + 1), AUTH_PASSWORD) && userOk;
}

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

async function readJson(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw.replace(/^﻿/, ''));
}

async function readJsonDir(dir) {
  const list = [];
  const errors = [];
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return { list, errors };
  }
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const id = name.slice(0, -5);
    try {
      const obj = await readJson(path.join(dir, name));
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a JSON object');
      obj.id = id; // the filename is the id
      list.push(obj);
    } catch (e) {
      errors.push(`${path.relative(DATA_ROOT, path.join(dir, name))}: ${e.message}`);
    }
  }
  return { list, errors };
}

async function uniqueId(dir, base) {
  let id = slugify(base);
  let n = 2;
  while (fs.existsSync(path.join(dir, `${id}.json`))) id = `${slugify(base)}-${n++}`;
  return id;
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ---------- items / images ----------
async function imageVersion(file) {
  try {
    return Math.round((await fsp.stat(path.join(IMAGES_DIR, file))).mtimeMs);
  } catch {
    return null;
  }
}

async function decorateItem(item) {
  if (item.image && typeof item.image === 'string' && !item.image.includes('..') && !/[\\/]/.test(item.image)) {
    item.imageVersion = await imageVersion(item.image);
    if (item.imageVersion === null) item.imageMissing = true;
  }
  return item;
}

async function removeImageFiles(id, keep) {
  let names = [];
  try {
    names = await fsp.readdir(IMAGES_DIR);
  } catch {
    return;
  }
  for (const n of names) {
    if (n === keep) continue;
    const ext = path.extname(n);
    if (n.slice(0, -ext.length) === id && Object.values(IMAGE_EXT).includes(ext.toLowerCase())) {
      await fsp.unlink(path.join(IMAGES_DIR, n)).catch(() => {});
    }
  }
}

async function saveImage(id, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl));
  if (!m) throw Object.assign(new Error('Unsupported image (use PNG, JPG, GIF or WEBP)'), { status: 400 });
  const file = `${id}${IMAGE_EXT[m[1]]}`;
  await fsp.writeFile(path.join(IMAGES_DIR, file), Buffer.from(m[2], 'base64'));
  await removeImageFiles(id, file);
  return file;
}

function cleanItem(body) {
  const out = {
    name: String(body.name || '').trim() || 'Unnamed item',
    slot: String(body.slot || ''),
    set: body.set ? String(body.set) : null,
    rarity: body.rarity ? String(body.rarity) : 'common',
    owned: body.owned !== false,
    stats: {},
    effect: body.effect ? String(body.effect) : '',
    notes: body.notes ? String(body.notes) : '',
  };
  if (body.stats && typeof body.stats === 'object') {
    for (const [k, v] of Object.entries(body.stats)) {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 0) out.stats[k] = n;
    }
  }
  if (typeof body.image === 'string' && body.image) out.image = body.image;
  if (typeof body.texture === 'string' && /^[\w.-]+\/[\w.-]+$/.test(body.texture)) out.texture = body.texture;
  return out;
}

async function writeItem(id, body) {
  const item = cleanItem(body);
  if (typeof body.imageData === 'string' && body.imageData) {
    item.image = await saveImage(id, body.imageData);
  } else if (body.imageData === null || body.imageData === false) {
    delete item.image;
    await removeImageFiles(id);
  }
  await writeJsonAtomic(path.join(ITEMS_DIR, `${id}.json`), item);
  item.id = id;
  return decorateItem(item);
}

// ---------- textures (copied from the game's resource pack by import-textures.js) ----------
async function listTextures() {
  const packs = [];
  let dirs = [];
  try {
    dirs = await fsp.readdir(TEXTURES_DIR, { withFileTypes: true });
  } catch {
    return packs;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const names = (await fsp.readdir(path.join(TEXTURES_DIR, d.name)).catch(() => []))
      .filter((n) => n.toLowerCase().endsWith('.png'))
      .map((n) => n.slice(0, -4));
    if (names.length) packs.push({ id: d.name, textures: names });
  }
  return packs;
}

// ---------- sets ----------
function cleanSet(body) {
  const tiers = Array.isArray(body.bonuses) ? body.bonuses : [];
  return {
    name: String(body.name || '').trim() || 'Unnamed set',
    cumulative: body.cumulative !== false,
    bonuses: tiers
      .map((t) => {
        const stats = {};
        if (t && t.stats && typeof t.stats === 'object') {
          for (const [k, v] of Object.entries(t.stats)) {
            const n = Number(v);
            if (Number.isFinite(n) && n !== 0) stats[k] = n;
          }
        }
        return { pieces: Math.max(1, Math.round(Number(t && t.pieces) || 0)), stats, effect: t && t.effect ? String(t.effect) : '' };
      })
      .filter((t) => t.pieces > 0)
      .sort((a, b) => a.pieces - b.pieces),
    notes: body.notes ? String(body.notes) : '',
  };
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  const [, kind, id] = parts;
  const method = req.method;

  if (kind === 'data' && method === 'GET') {
    const [items, sets] = await Promise.all([readJsonDir(ITEMS_DIR), readJsonDir(SETS_DIR)]);
    await Promise.all(items.list.map(decorateItem));
    let profile = null;
    try {
      profile = await readJson(PROFILE_FILE);
    } catch (e) {
      if (e.code !== 'ENOENT') items.errors.push(`Data/profile.json: ${e.message}`);
    }
    return send(res, 200, {
      items: items.list,
      sets: sets.list,
      profile,
      errors: [...items.errors, ...sets.errors],
      paths: { items: ITEMS_DIR, images: IMAGES_DIR, textures: TEXTURES_DIR, sets: SETS_DIR, profile: PROFILE_FILE },
    });
  }

  if (kind === 'textures' && method === 'GET') {
    return send(res, 200, { packs: await listTextures() });
  }

  if (kind === 'profile' && method === 'PUT') {
    const body = await readBody(req);
    await writeJsonAtomic(PROFILE_FILE, body);
    return send(res, 200, { ok: true });
  }

  if (kind === 'items' || kind === 'sets') {
    const dir = kind === 'items' ? ITEMS_DIR : SETS_DIR;
    if (id !== undefined && !validId(id)) return send(res, 400, { error: 'Invalid id' });

    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const newId = await uniqueId(dir, body.name);
      if (kind === 'items') return send(res, 201, await writeItem(newId, body));
      const set = cleanSet(body);
      await writeJsonAtomic(path.join(dir, `${newId}.json`), set);
      return send(res, 201, { ...set, id: newId });
    }
    if (method === 'PUT' && id) {
      const body = await readBody(req);
      if (kind === 'items') return send(res, 200, await writeItem(id, body));
      const set = cleanSet(body);
      await writeJsonAtomic(path.join(dir, `${id}.json`), set);
      return send(res, 200, { ...set, id });
    }
    if (method === 'DELETE' && id) {
      await fsp.unlink(path.join(dir, `${id}.json`)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
      if (kind === 'items') await removeImageFiles(id);
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- static ----------
async function serveFile(res, baseDir, rel) {
  const file = path.resolve(baseDir, '.' + path.sep + rel);
  if (!file.startsWith(path.resolve(baseDir) + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="SAO Gear", charset="UTF-8"', 'Content-Type': 'text/plain' });
    return res.end('Login required');
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/item-images/')) {
      return await serveFile(res, IMAGES_DIR, decodeURIComponent(url.pathname.slice('/item-images/'.length)));
    }
    if (url.pathname.startsWith('/textures/')) {
      return await serveFile(res, TEXTURES_DIR, decodeURIComponent(url.pathname.slice('/textures/'.length)));
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return await serveFile(res, PUBLIC_DIR, rel);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

function openBrowser(link) {
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(cmd);
}

ensureDirs().then(() => {
  const link = `http://localhost:${PORT}`;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is already in use — the app is probably already running at ${link}`);
      if (process.argv.includes('--open')) openBrowser(link);
      process.exit(0);
    }
    throw e;
  });
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  SAO GEAR OPTIMIZER  ::  system online');
    console.log(`  ${link}`);
    console.log(`  Items  -> ${ITEMS_DIR}`);
    console.log(`  Sets   -> ${SETS_DIR}`);
    console.log(`  Images -> ${IMAGES_DIR}`);
    console.log(`  Textures -> ${TEXTURES_DIR}`);
    if (AUTH_PASSWORD) console.log('  Login required (APP_PASSWORD is set)');
    console.log('  Press Ctrl+C to stop.');
    if (process.argv.includes('--open')) openBrowser(link);
  });
});

// Docker stops containers with SIGTERM; exit cleanly instead of waiting to be killed.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
