#!/usr/bin/env node
// Usage: node server.js [contentDir] [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'content'));
const PORT = Number(process.argv[3] || process.env.PORT || 4321);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};
const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const VID = new Set(['.mp4', '.webm', '.mov']);

function attachmentType(ext) {
  if (IMG.has(ext)) return 'image';
  if (VID.has(ext)) return 'video';
  if (ext === '.pdf') return 'pdf';
  return null;
}

function collectAttachments(dir, urlBase) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...collectAttachments(path.join(dir, e.name), `${urlBase}/${encodeURIComponent(e.name)}`));
    } else {
      const type = attachmentType(path.extname(e.name).toLowerCase());
      if (type) out.push({ name: e.name, type, url: `${urlBase}/${encodeURIComponent(e.name)}` });
    }
  }
  return out;
}

function buildSky() {
  const years = [];
  let entries;
  try { entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true }); } catch { return { years }; }

  for (const yearEntry of entries) {
    if (!yearEntry.isDirectory() || !safeName(yearEntry.name)) continue;
    const yearDir = path.join(CONTENT_DIR, yearEntry.name);
    const yearUrl = `/files/${yearEntry.name}`;
    const children = fs.readdirSync(yearDir, { withFileTypes: true });

    const mdFiles = children.filter(c => c.isFile() && c.name.toLowerCase().endsWith('.md'));
    const folders = children.filter(c => c.isDirectory());
    const matched = new Set();

    const files = mdFiles.map(md => {
      const base = md.name.replace(/\.md$/i, '');
      const quote = fs.readFileSync(path.join(yearDir, md.name), 'utf8');
      let attachments = [];
      const folder = folders.find(f => f.name === base);
      if (folder) {
        matched.add(folder.name);
        attachments = collectAttachments(path.join(yearDir, folder.name), `${yearUrl}/${encodeURIComponent(folder.name)}`);
      }
      return { name: base, quote, attachments };
    });

    // folders that match no md file become year-level attachments
    const yearAttachments = folders
      .filter(f => !matched.has(f.name))
      .flatMap(f => collectAttachments(path.join(yearDir, f.name), `${yearUrl}/${encodeURIComponent(f.name)}`));

    years.push({ year: yearEntry.name, files, attachments: yearAttachments });
  }
  years.sort((a, b) => a.year.localeCompare(b.year));
  return { years };
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    // always revalidate code/markup so the browser never runs a stale mix
    const noCache = ['.html', '.css', '.js'].includes(ext);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
    if (noCache) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const safeName = s => typeof s === 'string' && s.trim() && !/[/\\]|^\.|\.\./.test(s.trim());
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const [rawPath, rawQuery] = req.url.split('?');
  const url = decodeURIComponent(rawPath);
  const q = new URLSearchParams(rawQuery || '');

  // ---- write API ----
  if (url === '/api/quote' && req.method === 'POST') {
    try {
      const { year, name, quote } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!safeName(year) || !safeName(name) || typeof quote !== 'string')
        return json(res, 400, { error: 'need group, name, quote' });
      const dir = path.join(CONTENT_DIR, year.trim());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name.trim() + '.md'), quote);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url === '/api/upload' && req.method === 'POST') {
    const year = q.get('year'), name = q.get('name'), filename = q.get('filename');
    const ext = filename ? path.extname(filename).toLowerCase() : '';
    if (!safeName(year) || !safeName(name) || !safeName(filename) || !attachmentType(ext))
      return json(res, 400, { error: 'bad params or unsupported file type' });
    try {
      const body = await readBody(req);
      const dir = path.join(CONTENT_DIR, year.trim(), name.trim());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename.trim()), body);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url === '/api/quote' && req.method === 'DELETE') {
    const year = q.get('year'), name = q.get('name');
    if (!safeName(year) || !safeName(name)) return json(res, 400, { error: 'bad params' });
    try {
      fs.rmSync(path.join(CONTENT_DIR, year.trim(), name.trim() + '.md'), { force: true });
      fs.rmSync(path.join(CONTENT_DIR, year.trim(), name.trim()), { recursive: true, force: true });
      try { fs.rmdirSync(path.join(CONTENT_DIR, year.trim())); } catch {} // only removes if empty
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url === '/api/sky') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildSky()));
    return;
  }
  if (url.startsWith('/files/')) {
    const rel = path.normalize(url.slice('/files/'.length));
    const abs = path.join(CONTENT_DIR, rel);
    if (!abs.startsWith(CONTENT_DIR)) { res.writeHead(403); res.end(); return; }
    serveFile(res, abs);
    return;
  }
  const rel = url === '/' ? 'index.html' : path.normalize(url).replace(/^[/\\]+/, '');
  const abs = path.join(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  serveFile(res, abs);
}).listen(PORT, () => {
  console.log(`night sky at http://localhost:${PORT}  (content: ${CONTENT_DIR})`);
});
