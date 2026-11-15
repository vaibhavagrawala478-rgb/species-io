// Serves uploaded game builds out of IndexedDB at  <scope>/play/<gameId>/<path>
const DB_NAME = 'species-files';
const STORE = 'files';

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain', xml: 'application/xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  data: 'application/octet-stream', pck: 'application/octet-stream', unityweb: 'application/octet-stream'
};

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getFile(key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function serve(rel) {
  let path;
  try { path = decodeURIComponent(rel.split('?')[0]); } catch { return new Response('Bad path', { status: 400 }); }
  if (path.endsWith('/') || !path.includes('/')) path = (path.endsWith('/') ? path : path + '/') + 'index.html';
  const blob = await getFile(path);
  if (!blob) return new Response('Not found', { status: 404 });

  let name = path.toLowerCase();
  const headers = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };
  if (name.endsWith('.br')) { headers['Content-Encoding'] = 'br'; name = name.slice(0, -3); }
  else if (name.endsWith('.gz')) { headers['Content-Encoding'] = 'gzip'; name = name.slice(0, -3); }
  const ext = name.split('.').pop();
  headers['Content-Type'] = TYPES[ext] || 'application/octet-stream';
  return new Response(blob, { status: 200, headers });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const prefix = new URL('play/', self.registration.scope).pathname;
  if (!url.pathname.startsWith(prefix)) return;
  e.respondWith(serve(url.pathname.slice(prefix.length)));
});
