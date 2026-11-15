(() => {
  'use strict';

  /* ---------- Platforms ---------- */
  const PLATFORMS = [
    { id: 'spawn',    name: 'Spawn',     hosts: ['spawn'],                      color: '#f97316' },
    { id: 'gdevelop', name: 'GDevelop',  hosts: ['gd.games', 'gdevelop'],       color: '#ec4899' },
    { id: 'gearzero', name: 'Gear Zero', hosts: ['gearzero', 'gear-zero', 'gear.zero'], color: '#eab308' },
    { id: 'unity',    name: 'Unity',     hosts: ['unity'],                      color: '#64748b' },
    { id: 'godot',    name: 'Godot',     hosts: ['godot'],                      color: '#3b82f6' },
    { id: 'playdrop', name: 'Playdrop',  hosts: ['playdrop'],                   color: '#14b8a6' },
    { id: 'ludo',     name: 'Ludo.ai',   hosts: ['ludo.ai', 'ludo'],            color: '#a855f7' },
    { id: 'tesana',   name: 'Tesana',    hosts: ['tesana'],                     color: '#06b6d4' },
    { id: 'rosebud',  name: 'Rosebud.ai', hosts: ['rosebud'],                   color: '#f43f5e' },
    { id: 'refybe',   name: 'Refybe',    hosts: ['refybe'],                     color: '#22c55e' },
    { id: 'other',    name: 'Other',     hosts: [],                             color: '#7c3aed' }
  ];
  const PLATFORM = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));
  const detectPlatform = (url) => {
    const s = (url || '').toLowerCase();
    const hit = PLATFORMS.find(p => p.hosts.some(h => s.includes(h)));
    return hit ? hit.id : 'other';
  };

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const safeJSON = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
  const store = {
    get(k, d) { try { return safeJSON(localStorage.getItem(k), d); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const slugify = (s) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game').slice(0, 40);
  const isHttp = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
  const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  let toastTimer;
  const toast = (msg) => {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  };

  /* ---------- IndexedDB (uploaded builds) ---------- */
  const DB_NAME = 'species-files', STORE = 'files';
  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
  async function putFiles(id, files) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const [path, blob] of files) os.put(blob, `${id}/${path}`);
    await txDone(tx); db.close();
  }
  async function deleteFiles(id) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`));
    await txDone(tx); db.close();
  }
  async function readFiles(id) {
    const db = await openDb();
    const os = db.transaction(STORE).objectStore(STORE);
    const range = IDBKeyRange.bound(`${id}/`, `${id}/\uffff`);
    const out = await new Promise((res, rej) => {
      const items = [], req = os.openCursor(range);
      req.onsuccess = () => { const c = req.result; if (c) { items.push([c.key.slice(id.length + 1), c.value]); c.continue(); } else res(items); };
      req.onerror = () => rej(req.error);
    });
    db.close(); return out;
  }

  /* ---------- Service worker ---------- */
  let swReady = null;
  function ensureSW() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('Service workers are not supported in this browser.'));
    swReady ??= navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready);
    return swReady;
  }
  const playUrl = (id) => new URL(`play/${id}/index.html`, document.baseURI).href;

  /* ---------- State ---------- */
  const state = { catalog: [], local: store.get('species.games', []), likes: new Set(store.get('species.likes', [])), q: '', platform: 'all', sort: 'new' };
  const saveLocal = () => store.set('species.games', state.local);
  const allGames = () => [...state.local.map(g => ({ ...g, source: 'local' })), ...state.catalog.map(g => ({ ...g, source: 'catalog' }))];
  const findGame = (id) => allGames().find(g => g.id === id);
  const likeCount = (g) => (g.likes || 0) + (state.likes.has(g.id) ? 1 : 0);

  async function loadCatalog() {
    try {
      const r = await fetch('data/games.json', { cache: 'no-cache' });
      const data = await r.json();
      if (Array.isArray(data)) state.catalog = data.filter(g => g && g.id && g.title && g.url);
    } catch { /* offline or not served over http: local games still work */ }
  }

  /* ---------- Rendering ---------- */
  function renderChips() {
    const games = allGames();
    const counts = {}; games.forEach(g => counts[g.platform] = (counts[g.platform] || 0) + 1);
    const box = $('#chips'); box.replaceChildren();
    const mk = (id, label, n) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.platform === id),
      onclick: () => { state.platform = id; render(); }
    }, label, n != null ? h('small', {}, String(n)) : null);
    box.append(mk('all', 'All', games.length));
    PLATFORMS.forEach(p => box.append(mk(p.id, p.name, counts[p.id] || 0)));
  }

  function cover(g) {
    const p = PLATFORM[g.platform] || PLATFORM.other;
    const hh = hue(g.title);
    const btn = h('button', {
      class: 'cover', type: 'button', 'aria-label': `Play ${g.title}`,
      style: `background:linear-gradient(135deg,hsl(${hh} 70% 38%),hsl(${(hh + 50) % 360} 70% 22%))`,
      onclick: () => openPlayer(g.id)
    }, h('span', { 'aria-hidden': 'true' }, (g.title[0] || '?').toUpperCase()));
    if (g.cover && (g.cover.startsWith('data:image/') || isHttp(g.cover) || !/^[a-z]+:/i.test(g.cover))) {
      const img = h('img', { src: g.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      btn.append(img);
    }
    btn.append(h('span', { class: 'play' }, '▶ Play'));
    return h('div', { style: 'position:relative' }, h('span', { class: 'badge', style: `border-color:${p.color}` }, p.name), btn);
  }

  function card(g) {
    const mine = g.source === 'local';
    const liked = state.likes.has(g.id);
    return h('article', { class: 'card' },
      cover(g),
      h('div', { class: 'card-body' },
        h('h3', {}, g.title),
        g.description ? h('p', {}, g.description) : null,
        h('div', { class: 'card-foot' },
          h('span', { class: 'by' }, g.author ? `by ${g.author}` : (mine ? 'You' : '')),
          mine ? h('button', { class: 'btn small', type: 'button', onclick: () => openPublish(g.id) }, 'Publish') : null,
          mine ? h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${g.title}`, onclick: () => removeGame(g.id) }, 'Remove') : null,
          h('button', {
            class: 'like', type: 'button', 'aria-pressed': String(liked), 'aria-label': `Like ${g.title}`,
            onclick: () => toggleLike(g.id)
          }, `${liked ? '♥' : '♡'} ${likeCount(g)}`)
        )
      )
    );
  }

  function render() {
    renderChips();
    const q = state.q.trim().toLowerCase();
    let list = allGames().filter(g =>
      (state.platform === 'all' || g.platform === state.platform) &&
      (!q || [g.title, g.author, g.description, (PLATFORM[g.platform] || {}).name].some(v => (v || '').toLowerCase().includes(q))));
    const cmp = {
      new: (a, b) => (b.added || '').localeCompare(a.added || ''),
      likes: (a, b) => likeCount(b) - likeCount(a),
      az: (a, b) => a.title.localeCompare(b.title)
    }[state.sort];
    list.sort(cmp);
    $('#grid').replaceChildren(...list.map(card));
    $('#count').textContent = `${list.length} game${list.length === 1 ? '' : 's'}`;
    $('#empty').hidden = allGames().length > 0;
    $('.bar').hidden = allGames().length === 0;
  }

  function toggleLike(id) {
    state.likes.has(id) ? state.likes.delete(id) : state.likes.add(id);
    store.set('species.likes', [...state.likes]);
    render();
  }

  async function removeGame(id) {
    const g = state.local.find(x => x.id === id);
    if (!g || !confirm(`Remove "${g.title}" from this browser?`)) return;
    state.local = state.local.filter(x => x.id !== id);
    saveLocal();
    if (g.type === 'upload') { try { await deleteFiles(id); } catch { /* ignore */ } }
    render(); toast('Game removed');
  }

  /* ---------- Player ---------- */
  const playDlg = $('#playDlg'), frame = $('#frame');
  async function openPlayer(id, { pushHash = true } = {}) {
    const g = findGame(id); if (!g) return;
    let src = g.url;
    try {
      if (g.type === 'upload') { await ensureSW(); src = playUrl(g.id); }
      else if (g.type === 'hosted') src = new URL(g.url, document.baseURI).href;
      else if (!isHttp(g.url)) throw new Error('Invalid link');
    } catch (e) { toast(e.message || 'Could not load this game'); return; }

    $('#playTitle').textContent = g.title;
    $('#playMeta').textContent = [(PLATFORM[g.platform] || PLATFORM.other).name, g.author && `by ${g.author}`].filter(Boolean).join(' · ');
    const nt = $('#btnNewTab'); nt.href = src;
    $('#playNote').textContent = g.type === 'link'
      ? 'Game not loading? Some platforms block embedding — use “Open in new tab”.'
      : '';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-pointer-lock allow-forms allow-modals allow-downloads');
    frame.src = src;
    playDlg.dataset.id = id;
    if (!playDlg.open) playDlg.showModal();
    if (pushHash) history.replaceState(null, '', `#play=${encodeURIComponent(id)}`);
  }
  function closePlayer() { if (playDlg.open) playDlg.close(); }
  playDlg.addEventListener('close', () => {
    frame.src = 'about:blank';
    if (location.hash.startsWith('#play=')) history.replaceState(null, '', location.pathname + location.search);
  });
  $('#btnClosePlay').addEventListener('click', closePlayer);
  $('#btnFull').addEventListener('click', () => { (frame.requestFullscreen || frame.webkitRequestFullscreen)?.call(frame); });
  $('#btnShare').addEventListener('click', async () => {
    const g = findGame(playDlg.dataset.id);
    if (!g) return;
    if (g.source === 'local') {
      if (g.type === 'upload') { toast('Publish this game on GitHub first to share it'); return; }
      toast((await copy(g.url)) ? 'Game link copied' : 'Copy failed'); return;
    }
    const link = `${location.origin}${location.pathname}#play=${encodeURIComponent(g.id)}`;
    toast((await copy(link)) ? 'Share link copied' : 'Copy failed');
  });

  /* ---------- Submit dialog ---------- */
  const submitDlg = $('#submitDlg'), formLink = $('#formLink'), formUpload = $('#formUpload');
  [formLink, formUpload].forEach(f => {
    const sel = f.elements.platform;
    sel.append(...PLATFORMS.map(p => h('option', { value: p.id }, p.name)));
    sel.value = 'other';
  });
  const setTab = (which) => {
    const link = which === 'link';
    $('#tabLink').setAttribute('aria-selected', String(link));
    $('#tabUpload').setAttribute('aria-selected', String(!link));
    formLink.hidden = !link; formUpload.hidden = link;
  };
  $('#tabLink').addEventListener('click', () => setTab('link'));
  $('#tabUpload').addEventListener('click', () => setTab('upload'));
  const openSubmit = (tab = 'link') => { setTab(tab); submitDlg.showModal(); };
  $('#openSubmit').addEventListener('click', () => openSubmit());
  document.querySelectorAll('[data-open-submit]').forEach(b => b.addEventListener('click', () => openSubmit()));
  submitDlg.addEventListener('close', () => {
    [formLink, formUpload].forEach(f => { f.reset(); f.elements.platform.value = 'other'; f.querySelector('[data-error]').hidden = true; });
    $('#detectLink').textContent = ''; $('#fileName').textContent = ''; $('#prog').hidden = true;
  });
  const showError = (form, msg) => { const e = form.querySelector('[data-error]'); e.textContent = msg; e.hidden = !msg; };

  let platformTouched = false;
  formLink.elements.platform.addEventListener('change', () => (platformTouched = true));
  formLink.elements.url.addEventListener('input', (e) => {
    const id = detectPlatform(e.target.value);
    const note = $('#detectLink');
    if (!e.target.value) { note.textContent = ''; return; }
    if (!platformTouched) formLink.elements.platform.value = id;
    note.textContent = id !== 'other' ? `Detected ${PLATFORM[id].name} ✓` : '';
  });

  formLink.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formLink.elements;
    const url = f.url.value.trim();
    if (!isHttp(url)) return showError(formLink, 'Please enter a valid http(s) link.');
    const dupe = allGames().find(g => g.url === url);
    if (dupe) return showError(formLink, `That link is already shared as “${dupe.title}”.`);
    state.local.unshift({
      id: uid(), type: 'link', url, title: f.title.value.trim(), platform: f.platform.value,
      author: f.author.value.trim(), description: f.description.value.trim(),
      cover: isHttp(f.cover.value.trim()) ? f.cover.value.trim() : '', added: new Date().toISOString().slice(0, 10)
    });
    if (!saveLocal()) return showError(formLink, 'Could not save (browser storage is full or blocked).');
    submitDlg.close(); platformTouched = false; render(); toast('Game added — hit Publish to put it on GitHub');
  });

  const dropEl = $('#drop');
  formUpload.elements.file.addEventListener('change', (e) => {
    const file = e.target.files[0];
    $('#fileName').textContent = file ? `${file.name} (${(file.size / 1048576).toFixed(1)} MB)` : '';
    if (file && !formUpload.elements.title.value) formUpload.elements.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  });
  ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, () => dropEl.classList.remove('over')));
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      formUpload.elements.file.files = e.dataTransfer.files;
      formUpload.elements.file.dispatchEvent(new Event('change'));
    }
  });

  async function extractBuild(file) {
    const files = new Map();
    if (/\.zip$/i.test(file.name)) {
      if (!window.JSZip) throw new Error('Zip support failed to load. Check your connection and retry.');
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(z => !z.dir && !z.name.startsWith('__MACOSX/') && !z.name.split('/').pop().startsWith('.'));
      const idx = entries.filter(z => /(^|\/)index\.html$/i.test(z.name)).sort((a, b) => a.name.length - b.name.length)[0];
      if (!idx) throw new Error('No index.html found in the zip. Export your game for Web/HTML5.');
      const root = idx.name.slice(0, idx.name.length - 'index.html'.length);
      const inRoot = entries.filter(z => z.name.startsWith(root));
      let done = 0;
      for (const z of inRoot) {
        files.set(z.name.slice(root.length), await z.async('blob'));
        $('#prog').value = ++done / inRoot.length;
      }
    } else if (/\.html?$/i.test(file.name)) {
      files.set('index.html', file);
    } else {
      throw new Error('Upload a .html file or a .zip web export.');
    }
    return files;
  }

  const coverToDataUrl = (file) => new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) return resolve('');
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const w = 480, hgt = 270, c = document.createElement('canvas'); c.width = w; c.height = hgt;
      const ctx = c.getContext('2d'), r = Math.max(w / img.width, hgt / img.height);
      ctx.drawImage(img, (w - img.width * r) / 2, (hgt - img.height * r) / 2, img.width * r, img.height * r);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });

  formUpload.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formUpload.elements, file = f.file.files[0];
    const btn = formUpload.querySelector('button[type=submit]');
    if (!file) return showError(formUpload, 'Choose a file to upload.');
    showError(formUpload, ''); btn.disabled = true; $('#prog').hidden = false; $('#prog').value = 0;
    const id = uid();
    try {
      await ensureSW();
      const files = await extractBuild(file);
      await putFiles(id, files);
      state.local.unshift({
        id, type: 'upload', title: f.title.value.trim(), platform: f.platform.value,
        author: f.author.value.trim(), description: f.description.value.trim(),
        cover: await coverToDataUrl(f.cover.files[0]), added: new Date().toISOString().slice(0, 10)
      });
      if (!saveLocal()) { state.local.shift(); await deleteFiles(id); throw new Error('Browser storage is full or blocked.'); }
      submitDlg.close(); render(); toast('Uploaded — hit Publish to put it on GitHub');
    } catch (err) {
      try { await deleteFiles(id); } catch { /* ignore */ }
      showError(formUpload, err.message || 'Upload failed.');
    } finally { btn.disabled = false; $('#prog').hidden = true; }
  });

  /* ---------- Publish dialog ---------- */
  const pubDlg = $('#pubDlg');
  const cfg = window.SPECIES_CONFIG || {};
  const repoUrl = cfg.repo ? `https://github.com/${cfg.repo}` : '';
  const entryFor = (g, slug) => {
    const e = { id: slug, title: g.title, platform: g.platform, type: g.type === 'upload' ? 'hosted' : 'link',
      url: g.type === 'upload' ? `games/${slug}/index.html` : g.url, author: g.author || '', description: g.description || '',
      cover: g.cover && g.cover.startsWith('data:') ? '' : (g.cover || ''), added: g.added };
    return e;
  };

  async function openPublish(id) {
    const g = state.local.find(x => x.id === id); if (!g) return;
    const slug = slugify(g.title);
    const entry = entryFor(g, slug);
    const json = JSON.stringify(entry, null, 2);
    const body = $('#pubBody'); body.replaceChildren();
    const dataUrl = repoUrl ? `${repoUrl}/edit/${cfg.branch || 'main'}/data/games.json` : '';
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

    if (g.type === 'upload') {
      body.append(
        h('div', { class: 'pub-step' }, h('b', {}, '1. '), 'Download the package. It contains ', h('code', {}, `games/${slug}/`), ' (your build) and ', h('code', {}, 'entry.json'), '.',
          h('div', { class: 'actions', style: 'margin-top:10px;justify-content:flex-start' },
            h('button', { class: 'btn primary', type: 'button', id: 'dlPkg' }, 'Download package (.zip)'))),
        h('div', { class: 'pub-step' }, h('b', {}, '2. '), 'Unzip it into the root of your SPECIES.IO repo so the build lives at ', h('code', {}, `games/${slug}/`), '.'),
        h('div', { class: 'pub-step' }, h('b', {}, '3. '), 'Add this entry to ', h('code', {}, 'data/games.json'), ':', h('pre', {}, json),
          h('div', { class: 'actions', style: 'margin-top:8px;justify-content:flex-start' },
            h('button', { class: 'btn small', type: 'button', id: 'cpEntry' }, 'Copy entry'),
            dataUrl ? link(dataUrl, 'Edit games.json on GitHub ↗') : null)),
        h('div', { class: 'pub-step' }, h('b', {}, '4. '), 'Commit & push. GitHub Pages redeploys and your game appears for everyone.',
          h('pre', {}, `git add games data\ngit commit -m "Add ${g.title.replace(/["\\$`]/g, '')}"\ngit push`)),
        g.cover && g.cover.startsWith('data:') ? h('p', { class: 'hint' }, 'Tip: add a public cover image URL to the entry’s "cover" field (uploaded covers stay local).') : null
      );
    } else {
      body.append(
        h('div', { class: 'pub-step' }, h('b', {}, '1. '), 'Add this entry to ', h('code', {}, 'data/games.json'), ' in your repo:', h('pre', {}, json),
          h('div', { class: 'actions', style: 'margin-top:8px;justify-content:flex-start' },
            h('button', { class: 'btn small', type: 'button', id: 'cpEntry' }, 'Copy entry'),
            dataUrl ? link(dataUrl, 'Edit games.json on GitHub ↗') : null)),
        h('div', { class: 'pub-step' }, h('b', {}, '2. '), 'Commit & push. GitHub Pages redeploys and your link is listed for everyone.',
          h('pre', {}, `git add data/games.json\ngit commit -m "Add ${g.title.replace(/["\\$`]/g, '')}"\ngit push`))
      );
    }
    if (!repoUrl) body.append(h('p', { class: 'hint' }, 'Tip: set your repo in ', h('code', {}, 'config.js'), ' to get direct GitHub links here.'));

    $('#cpEntry')?.addEventListener('click', async () => toast((await copy(json)) ? 'Entry copied' : 'Copy failed'));
    $('#dlPkg')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Packing…';
      try {
        const zip = new JSZip();
        for (const [path, blob] of await readFiles(g.id)) zip.file(`games/${slug}/${path}`, blob);
        zip.file('entry.json', json + '\n');
        const out = await zip.generateAsync({ type: 'blob' });
        const a = h('a', { href: URL.createObjectURL(out), download: `${slug}-species-io.zip` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { toast('Could not build the package'); }
      b.disabled = false; b.textContent = 'Download package (.zip)';
    });
    pubDlg.showModal();
  }

  /* ---------- Wiring ---------- */
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  [submitDlg, playDlg, pubDlg].forEach(d => d.addEventListener('click', (e) => { if (e.target === d && d !== playDlg) d.close(); }));
  if (repoUrl) $('#repoLink').href = repoUrl;

  const routeHash = () => {
    const m = location.hash.match(/^#play=(.+)$/);
    if (m) openPlayer(decodeURIComponent(m[1]), { pushHash: false });
  };
  window.addEventListener('hashchange', routeHash);

  (async () => {
    render();
    await loadCatalog();
    render();
    routeHash();
    if (state.local.some(g => g.type === 'upload')) ensureSW().catch(() => {});
  })();
})();
