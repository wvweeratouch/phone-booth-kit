/* map.js · ลากมุมให้ภาพลงพอดีพื้นผิวจริง (corner-pin) · Phone Booth workshop 2026-11-16
 * ห้ามแก้ไฟล์นี้ (do not edit).
 * ทุก element ที่มี data-surface="ชื่อ" = หน้าจอหนึ่งจอ ลากมุม 4 จุดไปวางบนพื้นผิวจริงได้
 *
 *   M        = เข้า/ออกโหมด map (ลากจุดมุม · ลากสี่เหลี่ยมตรงกลาง = ย้ายทั้งจอ)
 *   F        = เต็มจอ (map หลังเต็มจอบนจอ projector แล้ว)
 *   Shift+R  = ล้างตำแหน่งที่ map ไว้ทั้งหมด
 * ตำแหน่งจำไว้ในเบราว์เซอร์นี้ เปิดใหม่ก็ยังอยู่
 */
(function () {
  'use strict';

  const KEY = 'pbmap:' + location.pathname + ':';
  const GREEN = '#39ff14';
  const surfaces = [];
  let editing = false, bar = null;

  function load(name) {
    try { const s = localStorage.getItem(KEY + name); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save(s) {
    try { localStorage.setItem(KEY + s.name, JSON.stringify(s.pts)); } catch (e) { /* storage blocked: mapping still works this session */ }
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

  function init() {
    // a video or image placed in a surface fills it instead of spilling outside the mapped corners
    const css = document.createElement('style');
    css.textContent = '[data-surface]>video,[data-surface]>img{display:block;width:100%;height:100%;object-fit:cover;}';
    document.head.appendChild(css);

    document.querySelectorAll('[data-surface]').forEach(el => {
      const name = el.dataset.surface || ('surface' + surfaces.length);
      const w = el.offsetWidth, h = el.offsetHeight;
      const r = el.getBoundingClientRect();
      const home = [[r.left, r.top], [r.left + w, r.top], [r.left + w, r.top + h], [r.left, r.top + h]];
      Object.assign(el.style, {
        position: 'fixed', left: '0px', top: '0px', margin: '0',
        width: w + 'px', height: h + 'px', transformOrigin: '0 0',
      });
      const s = { el, name, w, h, home, pts: load(name) || home.map(p => p.slice()), handles: [] };
      s.handles = [1, 2, 3, 4].map(i => makeHandle(String(i)));
      s.handles.forEach((hd, i) => drag(hd, (x, y) => { s.pts[i] = [x, y]; apply(s); }, () => save(s)));
      s.mover = makeHandle(name, true);
      drag(s.mover, (x, y, dx, dy) => { s.pts.forEach(p => { p[0] += dx; p[1] += dy; }); apply(s); }, () => save(s));
      surfaces.push(s);
      apply(s);
    });

    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483644;display:none;padding:6px 12px;' +
      'background:rgba(0,0,0,.75);color:' + GREEN + ';font:13px sans-serif;pointer-events:none;';
    bar.textContent = 'โหมด map · ลากจุด 1-4 ไปที่มุมพื้นผิวจริง · ลากป้ายชื่อ = ย้ายทั้งจอ · M = เสร็จ · F = เต็มจอ · Shift+R = ล้าง';
    document.body.appendChild(bar);

    setEditing(false);
    hint();
  }

  function setEditing(on) {
    editing = on;
    surfaces.forEach(s => {
      s.el.style.outline = on ? '2px solid ' + GREEN : '';
      s.el.style.outlineOffset = '-2px';
      s.handles.concat([s.mover]).forEach(hd => { hd.style.display = on ? 'block' : 'none'; });
    });
    if (bar) bar.style.display = on ? 'block' : 'none';
    document.documentElement.style.cursor = on ? '' : 'none';
  }

  function hint() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483644;' +
      'padding:6px 12px;color:' + GREEN + ';border:1px solid ' + GREEN + ';background:#000;font:13px sans-serif;pointer-events:none;';
    d.textContent = 'M = map พื้นผิว · F = เต็มจอ · D = ดูกล้อง';
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
