/* map.js · ลากมุมให้ภาพลงพอดีพื้นผิวจริง (corner-pin) · Phone Booth workshop 2026-11-16
 * ห้ามแก้ไฟล์นี้ (do not edit).
 * ทุก element ที่มี data-surface="ชื่อ" = หน้าจอหนึ่งจอ ลากมุม 4 จุดไปวางบนพื้นผิวจริงได้
 *
 *   M        = เข้า/ออกโหมด map (ลากจุดมุม · ลากป้ายชื่อ = ย้ายทั้งจอ · + media = ใส่รูป/วิดีโอ)
 *   F        = เต็มจอ (map หลังเต็มจอบนจอ projector แล้ว)
 *   Shift+R  = ล้างตำแหน่งที่ map ไว้ทั้งหมด
 *   ลากไฟล์รูปหรือวิดีโอมาวางบนจอไหน = ใส่ media ให้จอนั้น
 *   ในโค้ด: mapMedia('ชื่อจอ', 'clip.mp4') ใส่ · mapMedia('ชื่อจอ', null) เอาออก
 * ตำแหน่งและ media ที่ใส่ด้วยมือ จำไว้ในเบราว์เซอร์นี้ เปิดใหม่ก็ยังอยู่
 */
(function () {
  'use strict';

  const KEY = 'pbmap:' + location.pathname + ':';
  const GREEN = '#39ff14';
  const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
  const surfaces = [];
  let editing = false, bar = null, picker = null, pickFor = null;
  let ready = false;
  const queued = [];

  function load(name) {
    try { const s = localStorage.getItem(KEY + name); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save(s) {
    try { localStorage.setItem(KEY + s.name, JSON.stringify(s.pts)); } catch (e) { /* storage blocked: mapping still works this session */ }
  }

  // ---------- media files kept in IndexedDB, so a reload brings them back ----------
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('pbmap-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbPut(key, blob) {
    try {
      const d = await db();
      await new Promise((res, rej) => {
        const tx = d.transaction('media', 'readwrite');
        if (blob) tx.objectStore('media').put(blob, key); else tx.objectStore('media').delete(key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* storage blocked or full: media still shows this session */ }
  }
  async function dbGet(key) {
    try {
      const d = await db();
      return await new Promise(res => {
        const r = d.transaction('media').objectStore('media').get(key);
        r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }

  // projective transform from the element's own rectangle to 4 points on screen
  function solve(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
      h[r] = s / A[r][r];
    }
    return h;
  }

  function apply(s) {
    const h = solve([[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]], s.pts);
    if (h) {
      s.el.style.transform = 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].join(',') + ')';
    }
    s.handles.forEach((hd, i) => { hd.style.left = s.pts[i][0] + 'px'; hd.style.top = s.pts[i][1] + 'px'; });
    const cx = s.pts.reduce((a, p) => a + p[0], 0) / 4, cy = s.pts.reduce((a, p) => a + p[1], 0) / 4;
    s.mover.style.left = cx + 'px'; s.mover.style.top = cy + 'px';
    s.tools.style.left = cx + 'px'; s.tools.style.top = (cy + 22) + 'px';
  }

  function makeHandle(label, square) {
    const d = document.createElement('div');
    d.textContent = label;
    d.style.cssText = 'position:fixed;z-index:2147483645;transform:translate(-50%,-50%);display:none;' +
      'min-width:26px;height:26px;padding:0 4px;box-sizing:border-box;border:2px solid ' + GREEN + ';' +
      'color:' + GREEN + ';background:rgba(0,0,0,.6);font:12px/22px monospace;text-align:center;cursor:grab;' +
      'touch-action:none;user-select:none;border-radius:' + (square ? '3px' : '50%') + ';';
    document.body.appendChild(d);
    return d;
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:0 3px;padding:2px 8px;border:1px solid ' + GREEN + ';background:#000;color:' + GREEN + ';' +
      'font:12px monospace;cursor:pointer;';
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return b;
  }

  function drag(el, onMove, onEnd) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      let last = [e.clientX, e.clientY];
      const move = ev => { onMove(ev.clientX, ev.clientY, ev.clientX - last[0], ev.clientY - last[1]); last = [ev.clientX, ev.clientY]; };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onEnd(); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  // ---------- media ----------
  function dropElement(s) {
    if (s.media) { s.media.remove(); s.media = null; }
    s.clearBtn.style.display = 'none';
  }

  // object URLs of dropped files are freed only when a different source replaces them
  function setUrl(s, u) {
    if (s.url && s.url !== u) URL.revokeObjectURL(s.url);
    s.url = u;
  }

  function showMedia(s, src, isVideo) {
    dropElement(s);
    const m = document.createElement(isVideo ? 'video' : 'img');
    if (isVideo) { m.autoplay = true; m.loop = true; m.muted = true; m.playsInline = true; }
    m.className = 'pbmap-media';
    m.src = src;
    s.el.appendChild(m);
    if (isVideo) m.play().catch(() => {});
    s.media = m;
    s.clearBtn.style.display = 'inline-block';
  }

  function removeMedia(s) {
    dropElement(s);
    setUrl(s, null);
  }

  function useFile(s, file) {
    if (!file || !/^(image|video)\//.test(file.type)) return;
    const u = URL.createObjectURL(file);
    setUrl(s, u);
    showMedia(s, u, file.type.startsWith('video'));
    dbPut(KEY + s.name, file);
  }

  function clearMedia(s) {
    removeMedia(s);
    dbPut(KEY + s.name, null);
  }

  // public: mapMedia('wall', 'clip.mp4') · mapMedia('wall', null) to remove
  // calls made before the page finishes loading wait until the surfaces exist
  function mapMedia(name, src) {
    if (!ready) { queued.push([name, src]); return; }
    const s = surfaces.find(x => x.name === name);
    if (!s) { console.warn('[map] no surface named ' + name); return; }
    if (!src) { clearMedia(s); return; }
    setUrl(s, null);
    showMedia(s, src, VIDEO_EXT.test(src));
  }

  // a file the person dropped in earlier wins over media set in code
  async function restoreMedia(s) {
    const blob = await dbGet(KEY + s.name);
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(s, u);
    showMedia(s, u, (blob.type || '').startsWith('video'));
  }

  function init() {
    const css = document.createElement('style');
    css.textContent =
      // a video or image placed in a surface fills it instead of spilling outside the mapped corners
      '[data-surface]>video,[data-surface]>img{display:block;width:100%;height:100%;object-fit:cover;}' +
      '[data-surface]>.pbmap-media{position:absolute;left:0;top:0;z-index:10;}';
    document.head.appendChild(css);

    picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/*,video/*'; picker.style.display = 'none';
    picker.addEventListener('change', () => {
      if (pickFor && picker.files[0]) useFile(pickFor, picker.files[0]);
      picker.value = '';
    });
    document.body.appendChild(picker);

    document.querySelectorAll('[data-surface]').forEach(el => {
      const name = el.dataset.surface || ('surface' + surfaces.length);
      const w = el.offsetWidth, h = el.offsetHeight;
      const r = el.getBoundingClientRect();
      const home = [[r.left, r.top], [r.left + w, r.top], [r.left + w, r.top + h], [r.left, r.top + h]];
      Object.assign(el.style, {
        position: 'fixed', left: '0px', top: '0px', margin: '0',
        width: w + 'px', height: h + 'px', transformOrigin: '0 0',
      });
      const s = { el, name, w, h, home, pts: load(name) || home.map(p => p.slice()), handles: [], media: null, url: null };
      s.handles = [1, 2, 3, 4].map(i => makeHandle(String(i)));
      s.handles.forEach((hd, i) => drag(hd, (x, y) => { s.pts[i] = [x, y]; apply(s); }, () => save(s)));
      s.mover = makeHandle(name, true);
      drag(s.mover, (x, y, dx, dy) => { s.pts.forEach(p => { p[0] += dx; p[1] += dy; }); apply(s); }, () => save(s));

      s.tools = document.createElement('div');
      s.tools.style.cssText = 'position:fixed;z-index:2147483645;transform:translate(-50%,0);display:none;white-space:nowrap;';
      s.tools.appendChild(makeButton('+ media', () => { pickFor = s; picker.click(); }));
      s.clearBtn = makeButton('× media', () => clearMedia(s));
      s.clearBtn.style.display = 'none';
      s.tools.appendChild(s.clearBtn);
      document.body.appendChild(s.tools);

      el.addEventListener('dragover', e => { e.preventDefault(); });
      el.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (f) useFile(s, f);
      });

      surfaces.push(s);
      apply(s);
      restoreMedia(s);
    });

    // a file dropped outside every surface must not navigate away from the page
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483644;display:none;padding:6px 12px;' +
      'background:rgba(0,0,0,.75);color:' + GREEN + ';font:13px sans-serif;pointer-events:none;';
    bar.textContent = 'โหมด map · ลากจุด 1-4 ไปที่มุมพื้นผิวจริง · ลากป้ายชื่อ = ย้ายทั้งจอ · + media = ใส่รูป/วิดีโอ (หรือลากไฟล์มาวางบนจอ) · M = เสร็จ · F = เต็มจอ · Shift+R = ล้าง';
    document.body.appendChild(bar);

    setEditing(false);
    hint();
    ready = true;
    queued.splice(0).forEach(([n, src]) => mapMedia(n, src));
  }

  function setEditing(on) {
    editing = on;
    surfaces.forEach(s => {
      s.el.style.outline = on ? '2px solid ' + GREEN : '';
      s.el.style.outlineOffset = '-2px';
      s.handles.concat([s.mover]).forEach(hd => { hd.style.display = on ? 'block' : 'none'; });
      s.tools.style.display = on ? 'block' : 'none';
    });
    if (bar) bar.style.display = on ? 'block' : 'none';
    document.documentElement.style.cursor = on ? '' : 'none';
  }

  function hint() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483644;' +
      'padding:6px 12px;color:' + GREEN + ';border:1px solid ' + GREEN + ';background:#000;font:13px sans-serif;pointer-events:none;';
    d.textContent = 'M = map พื้นผิว · F = เต็มจอ · D = ดูกล้อง · ลากรูป/วิดีโอมาวางบนจอได้';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }

  function reset() {
    surfaces.forEach(s => {
      s.pts = s.home.map(p => p.slice());
      try { localStorage.removeItem(KEY + s.name); } catch (e) { /* ignore */ }
      apply(s);
    });
  }

  window.addEventListener('keydown', e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'm') setEditing(!editing);
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
    else if (k === 'r' && e.shiftKey) reset();
  });

  window.surfaces = surfaces;
  window.mapMedia = mapMedia;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
