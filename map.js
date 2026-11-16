/* map.js · ลากมุมให้ภาพลงพอดีพื้นผิวจริง · Phone Booth workshop 2026-11-16
 * ห้ามแก้ไฟล์นี้ (do not edit).
 * ทุก element ที่มี data-surface="ชื่อ" = หน้าจอหนึ่งจอ
 *
 *   M        = เข้า/ออกโหมด map
 *              ใต้ชื่อแต่ละจอ: Keystone (ลากมุม 4 จุด) · Grid Warp (ลากจุดบนตาราง) · Add Row · Add Column
 *                              + media / × media · × box (เฉพาะจอที่เพิ่มเอง)
 *              แถบบน: + box = เพิ่มจอใหม่
 *              ลากป้ายชื่อ = ย้ายทั้งจอ
 *   F        = เต็มจอ (map หลังเต็มจอบนจอ projector แล้ว)
 *   Shift+R  = ล้างตำแหน่งที่ map ไว้ทั้งหมด
 *   ลากไฟล์รูปหรือวิดีโอมาวางบนจอไหน = ใส่ media ให้จอนั้น
 *   ในโค้ด: mapMedia('ชื่อจอ', 'clip.mp4') ใส่ · mapMedia('ชื่อจอ', null) เอาออก
 * Grid Warp วาดผ่าน WebGL ใช้กับจอที่เป็น canvas, รูป หรือวิดีโอ
 * ตำแหน่ง, จอที่เพิ่มเอง และ media ที่ใส่ด้วยมือ จำไว้ในเบราว์เซอร์นี้
 */
(function () {
  'use strict';

  const KEY = 'pbmap:' + location.pathname + ':';
  const BOXES = KEY + '#boxes';
  const GREEN = '#39ff14';
  const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
  const SUB = 8;                       // mesh steps inside each grid cell
  const surfaces = [];
  let editing = false, bar = null, picker = null, pickFor = null, toastEl = null;
  let ready = false;
  const queued = [];

  // ---------- storage ----------
  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { /* storage blocked: everything still works this session */ }
  }
  function load(name) {
    const v = lsGet(KEY + name);
    return Array.isArray(v) ? { mode: 'keystone', pts: v } : v;   // older saves were the 4 corners only
  }
  function save(s) { lsSet(KEY + s.name, { mode: s.mode, pts: s.pts, rows: s.rows, cols: s.cols, g: s.g }); }
  function saveBoxes() { lsSet(BOXES, surfaces.filter(s => s.added).map(s => ({ name: s.name, w: s.w, h: s.h }))); }

  // media files kept in IndexedDB, so a reload brings them back
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

  // ---------- geometry ----------
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
  function project(h, x, y) {
    const d = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
  }
  const rect = s => [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]];
  const gi = (s, r, c) => r * (s.cols + 1) + c;

  function corners(s) {
    if (s.mode !== 'grid') return s.pts;
    return [s.g[gi(s, 0, 0)], s.g[gi(s, 0, s.cols)], s.g[gi(s, s.rows, s.cols)], s.g[gi(s, s.rows, 0)]];
  }
  // u, v in 0..1 to a point on screen, bilinear inside each grid cell
  function evalGrid(s, u, v) {
    const cu = Math.min(u * s.cols, s.cols - 1e-9), cv = Math.min(v * s.rows, s.rows - 1e-9);
    const c = Math.floor(cu), r = Math.floor(cv), fu = cu - c, fv = cv - r;
    const a = s.g[gi(s, r, c)], b = s.g[gi(s, r, c + 1)], d = s.g[gi(s, r + 1, c)], e = s.g[gi(s, r + 1, c + 1)];
    const tx = a[0] + (b[0] - a[0]) * fu, ty = a[1] + (b[1] - a[1]) * fu;
    const bx = d[0] + (e[0] - d[0]) * fu, by = d[1] + (e[1] - d[1]) * fu;
    return [tx + (bx - tx) * fv, ty + (by - ty) * fv];
  }
  function resample(s, rows, cols, from) {
    const g = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) g.push(from(c / cols, r / rows));
    s.rows = rows; s.cols = cols; s.g = g;
  }

  // ---------- UI pieces ----------
  function makeHandle(label, square, size) {
    const d = document.createElement('div');
    const z = size || 26;
    d.textContent = label;
    d.style.cssText = 'position:fixed;z-index:2147483645;transform:translate(-50%,-50%);display:none;' +
      'min-width:' + z + 'px;height:' + z + 'px;padding:0 4px;box-sizing:border-box;border:2px solid ' + GREEN + ';' +
      'color:' + GREEN + ';background:rgba(0,0,0,.6);font:12px/' + (z - 4) + 'px monospace;text-align:center;cursor:grab;' +
      'touch-action:none;user-select:none;border-radius:' + (square ? '3px' : '50%') + ';';
    document.body.appendChild(d);
    return d;
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:0 1px;padding:3px 9px;border:1px solid #1f5c1f;background:#0d260d;color:#9fdf9f;' +
      'font:12px sans-serif;cursor:pointer;pointer-events:auto;';
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); b.blur(); });
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

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:60vw;padding:8px 12px;' +
        'background:#300;color:#fff;font:14px sans-serif;border:1px solid #f33;';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 8000);
  }

  // ---------- one surface ----------
  function apply(s) {
    const q = corners(s);
    const h = solve(rect(s), q);
    if (h) {
      s.el.style.transform = 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].join(',') + ')';
    }
    const pts = s.mode === 'grid' ? s.g : s.pts;
    s.handles.forEach((hd, i) => { hd.style.left = pts[i][0] + 'px'; hd.style.top = pts[i][1] + 'px'; });
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    s.mover.style.left = cx + 'px'; s.mover.style.top = cy + 'px';
    s.tools.style.left = cx + 'px'; s.tools.style.top = (cy + 20) + 'px';
    s.meshDirty = true;
  }

  function buildHandles(s) {
    s.handles.forEach(hd => hd.remove());
    const grid = s.mode === 'grid';
    s.handles = (grid ? s.g : s.pts).map((p, i) => {
      const hd = grid ? makeHandle('', false, 16) : makeHandle(String(i + 1));
      drag(hd, (x, y) => { (grid ? s.g : s.pts)[i] = [x, y]; apply(s); }, () => save(s));
      hd.style.display = editing ? 'block' : 'none';
      return hd;
    });
  }

  function paintTools(s) {
    [[s.btnKey, 'keystone'], [s.btnGrid, 'grid']].forEach(([b, m]) => {
      const on = s.mode === m;
      b.style.background = on ? '#2e8b2e' : '#0d260d';
      b.style.color = on ? '#fff' : '#9fdf9f';
    });
  }

  function buildTools(s) {
    s.tools = document.createElement('div');
    s.tools.style.cssText = 'position:fixed;z-index:2147483645;transform:translate(-50%,0);display:none;white-space:nowrap;text-align:center;';
    const row1 = document.createElement('div'), row2 = document.createElement('div');
    row2.style.marginTop = '4px';
    s.btnKey = makeButton('Keystone', () => setMode(s, 'keystone'));
    s.btnGrid = makeButton('Grid Warp', () => setMode(s, 'grid'));
    row1.append(s.btnKey, s.btnGrid, makeButton('Add Row', () => addLine(s, 1, 0)), makeButton('Add Column', () => addLine(s, 0, 1)));
    row2.append(makeButton('+ media', () => { pickFor = s; picker.click(); }));
    s.clearBtn = makeButton('× media', () => clearMedia(s));
    s.clearBtn.style.display = 'none';
    row2.append(s.clearBtn);
    if (s.added) row2.append(makeButton('× box', () => removeBox(s)));
    s.tools.append(row1, row2);
    document.body.appendChild(s.tools);
    paintTools(s);
  }

  function setMode(s, mode) {
    if (mode === s.mode) return;
    if (mode === 'grid') {
      const h = solve(rect(s), s.pts);
      resample(s, 1, 1, (u, v) => (h ? project(h, u * s.w, v * s.h) : [0, 0]));
    } else {
      s.pts = corners(s).map(p => p.slice());
      s.el.style.opacity = '';
    }
    s.mode = mode;
    buildHandles(s); apply(s); save(s); paintTools(s);
  }

  function addLine(s, dRows, dCols) {
    if (s.mode !== 'grid') setMode(s, 'grid');
    const was = { rows: s.rows, cols: s.cols, g: s.g };
    resample(s, s.rows + dRows, s.cols + dCols, (u, v) => evalGrid(was, u, v));
    buildHandles(s); apply(s); save(s);
  }

  function setupSurface(el, added) {
    const name = el.dataset.surface || ('surface' + surfaces.length);
    const w = el.offsetWidth, h = el.offsetHeight;
    const r = el.getBoundingClientRect();
    const home = [[r.left, r.top], [r.left + w, r.top], [r.left + w, r.top + h], [r.left, r.top + h]];
    Object.assign(el.style, {
      position: 'fixed', left: '0px', top: '0px', margin: '0',
      width: w + 'px', height: h + 'px', transformOrigin: '0 0',
    });
    const saved = load(name) || {};
    const grid = saved.mode === 'grid' && Array.isArray(saved.g) && saved.rows && saved.cols;
    const s = {
      el, name, w, h, home, added,
      mode: grid ? 'grid' : 'keystone',
      pts: saved.pts || home.map(p => p.slice()),
      rows: grid ? saved.rows : 1, cols: grid ? saved.cols : 1, g: grid ? saved.g : null,
      handles: [], media: null, url: null, meshDirty: true,
    };
    s.mover = makeHandle(name, true);
    drag(s.mover, (x, y, dx, dy) => { (s.mode === 'grid' ? s.g : s.pts).forEach(p => { p[0] += dx; p[1] += dy; }); apply(s); }, () => save(s));
    buildTools(s);
    buildHandles(s);

    el.addEventListener('dragover', e => { e.preventDefault(); });
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) useFile(s, f);
    });

    surfaces.push(s);
    apply(s);
    restoreMedia(s);
    return s;
  }

  // ---------- boxes added by hand ----------
  function makeBoxEl(name, w, h) {
    const el = document.createElement('div');
    el.dataset.surface = name;
    el.style.cssText = 'position:fixed;background:#000;width:' + w + 'px;height:' + h + 'px;' +
      'left:' + Math.round(innerWidth / 2 - w / 2) + 'px;top:' + Math.round(innerHeight / 2 - h / 2) + 'px;';
    document.body.appendChild(el);
    return el;
  }

  function addBox() {
    let n = 1;
    while (surfaces.some(s => s.name === 'box' + n)) n++;
    const s = setupSurface(makeBoxEl('box' + n, 320, 240), true);
    saveBoxes(); save(s);
    setEditing(editing);
  }

  function removeBox(s) {
    clearMedia(s);
    s.handles.concat([s.mover, s.tools]).forEach(x => x.remove());
    s.el.remove();
    if (gl) { if (s.tex) gl.deleteTexture(s.tex); if (s.buf) gl.deleteBuffer(s.buf); if (s.lineBuf) gl.deleteBuffer(s.lineBuf); }
    surfaces.splice(surfaces.indexOf(s), 1);
    lsSet(KEY + s.name, null);
    saveBoxes();
  }

  // ---------- media ----------
  function dropElement(s) {
    if (s.media) { s.media.remove(); s.media = null; }
    s.clearBtn.style.display = 'none';
    s.texSrc = null; s.blocked = false;
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
    if (!blob || surfaces.indexOf(s) < 0) return;
    const u = URL.createObjectURL(blob);
    setUrl(s, u);
    showMedia(s, u, (blob.type || '').startsWith('video'));
  }

  // ---------- Grid Warp drawing (WebGL) ----------
  let gl = null, glCanvas = null, glFailed = false, prog = null, loc = {};

  function initGL() {
    glCanvas = document.createElement('canvas');
    glCanvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
    document.body.appendChild(glCanvas);
    gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { glFailed = true; toast('เครื่องนี้ไม่มี WebGL · Grid Warp ใช้ไม่ได้ ใช้ Keystone แทน'); return false; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER,
      'attribute vec2 p; attribute vec2 t; uniform vec2 res; uniform vec4 uv; varying vec2 vt;' +
      'void main(){ vt = uv.xy + t * uv.zw; vec2 c = p / res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec2 vt; uniform sampler2D tex; uniform vec4 solid;' +
      'void main(){ gl_FragColor = solid.a > 0.0 ? solid : texture2D(tex, vt); }'));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    ['res', 'uv', 'tex', 'solid'].forEach(k => { loc[k] = gl.getUniformLocation(prog, k); });
    loc.p = gl.getAttribLocation(prog, 'p'); loc.t = gl.getAttribLocation(prog, 't');
    gl.enableVertexAttribArray(loc.p); gl.enableVertexAttribArray(loc.t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(loc.tex, 0);
    return true;
  }

  function pickSource(s) { return s.media || s.el.querySelector('canvas'); }
  function hasFrame(src) {
    if (src.tagName === 'VIDEO') return src.readyState >= 2;
    if (src.tagName === 'IMG') return src.complete && src.naturalWidth > 0;
    return true;
  }

  function buildMesh(s) {
    const N = s.cols * SUB, M = s.rows * SUB, P = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) P.push(evalGrid(s, i / N, j / M));
    const at = (i, j) => P[j * (N + 1) + i];
    const tri = [];
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      const u0 = i / N, u1 = (i + 1) / N, v0 = j / M, v1 = (j + 1) / M;
      tri.push(a[0], a[1], u0, v0, b[0], b[1], u1, v0, c[0], c[1], u0, v1,
               b[0], b[1], u1, v0, d[0], d[1], u1, v1, c[0], c[1], u0, v1);
    }
    const lines = [];
    const seg = (p, q) => lines.push(p[0], p[1], 0, 0, q[0], q[1], 0, 0);
    for (let r = 0; r <= s.rows; r++) for (let i = 0; i < N; i++) seg(at(i, r * SUB), at(i + 1, r * SUB));
    for (let c = 0; c <= s.cols; c++) for (let j = 0; j < M; j++) seg(at(c * SUB, j), at(c * SUB, j + 1));
    if (!s.buf) s.buf = gl.createBuffer();
    if (!s.lineBuf) s.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    s.triCount = tri.length / 4; s.lineCount = lines.length / 4;
    s.meshDirty = false;
  }

  function bindBuf(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(loc.p, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(loc.t, 2, gl.FLOAT, false, 16, 8);
  }

  function drawGrid(s) {
    if (s.meshDirty) buildMesh(s);
    const src = pickSource(s);
    let drawn = false;
    if (src && !s.blocked) {
      if (!s.tex) {
        s.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      try {
        // a video between frames (e.g. at its loop point) keeps showing the last frame it uploaded
        if (hasFrame(src) && (src.tagName !== 'IMG' || s.texSrc !== src)) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          s.texSrc = src;
        }
        drawn = s.texSrc === src;
      } catch (e) {
        s.blocked = true;
        toast('Grid Warp ของจอ ' + s.name + ' ดึงภาพไม่ได้ (ไฟล์ที่ตั้งจากโค้ดตอนเปิดแบบดับเบิลคลิก) · ลากไฟล์มาวางแทน หรือใช้ Keystone');
      }
    }
    s.el.style.opacity = drawn ? '0' : '';
    if (drawn) {
      const sw = src.videoWidth || src.naturalWidth || src.width, shh = src.videoHeight || src.naturalHeight || src.height;
      let sx = 1, sy = 1;
      if (src.tagName !== 'CANVAS' && sw && shh) {            // same crop as object-fit: cover
        const a = (sw / shh) / (s.w / s.h);
        if (a > 1) sx = 1 / a; else sy = a;
      }
      gl.uniform4f(loc.uv, (1 - sx) / 2, (1 - sy) / 2, sx, sy);
      gl.uniform4f(loc.solid, 0, 0, 0, 0);
      bindBuf(s.buf);
      gl.drawArrays(gl.TRIANGLES, 0, s.triCount);
    }
    if (editing) {
      gl.uniform4f(loc.solid, 0.22, 1, 0.08, 1);
      bindBuf(s.lineBuf);
      gl.drawArrays(gl.LINES, 0, s.lineCount);
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    const grids = surfaces.filter(s => s.mode === 'grid');
    if (!grids.length) { if (gl) gl.clear(gl.COLOR_BUFFER_BIT); return; }
    if (glFailed || (!gl && !initGL())) return;
    const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    if (glCanvas.width !== Math.round(W * dpr) || glCanvas.height !== Math.round(H * dpr)) {
      glCanvas.width = Math.round(W * dpr); glCanvas.height = Math.round(H * dpr);
    }
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.uniform2f(loc.res, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    grids.forEach(drawGrid);
  }

  // ---------- page ----------
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

    Array.from(document.querySelectorAll('[data-surface]')).forEach(el => setupSurface(el, false));
    (lsGet(BOXES) || []).forEach(b => {
      if (!surfaces.some(s => s.name === b.name)) setupSurface(makeBoxEl(b.name, b.w, b.h), true);
    });

    // a file dropped outside every surface must not navigate away from the page
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483644;display:none;padding:6px 12px;' +
      'background:rgba(0,0,0,.8);color:' + GREEN + ';font:13px sans-serif;pointer-events:none;';
    const text = document.createElement('span');
    text.textContent = 'โหมด map · ลากจุดไปที่พื้นผิวจริง · ลากป้ายชื่อ = ย้ายทั้งจอ · ลากรูป/วิดีโอมาวางบนจอได้ · M = เสร็จ · F = เต็มจอ · Shift+R = ล้าง   ';
    bar.append(text, makeButton('+ box', addBox));
    document.body.appendChild(bar);

    setEditing(surfaces.length === 0);
    hint();
    ready = true;
    queued.splice(0).forEach(([n, src]) => mapMedia(n, src));
    requestAnimationFrame(frame);
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
      s.mode = 'keystone'; s.g = null; s.rows = 1; s.cols = 1;
      s.pts = s.home.map(p => p.slice());
      s.el.style.opacity = '';
      lsSet(KEY + s.name, null);
      if (s.added) save(s);
      buildHandles(s); apply(s); paintTools(s);
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
