/* sense.js · ตัวรับรู้จากกล้อง · Phone Booth workshop 2026-11-16
 * ห้ามแก้ไฟล์นี้ (do not edit). หน้าของคุณอ่านค่าจาก window.sense
 *
 *   sense.start({ level: 0 })
 *     level 0 = ความเคลื่อนไหว · ไม่ใช้ AI · ไม่ต้องใช้เน็ต · ทนที่มืดที่สุด
 *     level 1 = + มือ (MediaPipe Gesture Recognizer) · ต้องใช้เน็ตตอนโหลด
 *     level 2 = + คนทั้งตัว หลายคน (MediaPipe Pose Landmarker) · ต้องใช้เน็ตตอนโหลด
 *   กด D = ดูว่ากล้องเห็นอะไร
 *   รายการค่าทั้งหมดอยู่ใน GUIDE.md
 */
(function () {
  'use strict';

  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = {
    gesture: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  };
  const GESTURE = {
    None: 'none', Closed_Fist: 'fist', Open_Palm: 'open', Pointing_Up: 'point',
    Thumb_Up: 'thumb_up', Thumb_Down: 'thumb_down', Victory: 'victory', ILoveYou: 'love',
  };
  const GW = 80, GH = 60;          // motion grid
  const DIFF = 24;                 // pixel change that counts as movement
  const SWIPE_DIST = 0.25;         // share of the frame a swipe must travel
  const SWIPE_WINDOW = 350;        // ms
  const SWIPE_COOLDOWN = 700;      // ms
  const COUNT_STEADY = 8;          // frames before people count changes

  const listeners = {};
  function emit(evt, ...args) {
    (listeners[evt] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });
  }

  const sense = {
    ready: false, level: 0, status: 'idle', error: null,
    motion: 0,
    where: { x: 0.5, y: 0.5 },
    swipe: null,
    hands: [],
    people: [],
    count: 0,
    speed: 0,
    video: null,
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return sense; },
    start,
  };
  window.sense = sense;

  let opts = { level: 0, mirror: true, debug: false };
  let small, sctx, prev = null;
  let gesture = null, pose = null;
  let lastVideoTime = -1, lastT = 0;
  let trail = [], lastSwipe = 0, lastGesture = 'none';
  let pendingCount = 0, pendingFrames = 0;
  let dbg = null, dctx = null, debugOn = false;
  let toast = null;

  async function start(o) {
    if (sense.status !== 'idle') return sense;
    opts = Object.assign(opts, o || {});
    sense.level = Math.max(0, Math.min(2, opts.level | 0));
    sense.status = 'camera';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      const v = document.createElement('video');
      v.playsInline = true; v.muted = true; v.srcObject = stream;
      await v.play();
      sense.video = v;
    } catch (e) {
      fail('กล้องเปิดไม่ได้ ลองกดอนุญาตกล้องแล้ว reload (camera blocked: ' + e.message + ')');
      return sense;
    }
    small = document.createElement('canvas');
    small.width = GW; small.height = GH;
    sctx = small.getContext('2d', { willReadFrequently: true });

    if (sense.level > 0) {
      sense.status = 'loading model';
      try { await loadModels(); }
      catch (e) {
        console.warn(e);
        fail('โหลดโมเดลไม่ได้ (ต้องใช้เน็ต) ใช้ level 0 แทน · model failed: ' + e.message, true);
        sense.level = 0; gesture = null; pose = null;
      }
    }
    if (opts.debug) setDebug(true);
    sense.ready = true; sense.status = 'running';
    emit('ready', sense);
    requestAnimationFrame(loop);
    return sense;
  }

  async function loadModels() {
    const vision = await import(MP + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
    const make = async (Cls, path, extra) => {
      const base = d => Object.assign({ baseOptions: { modelAssetPath: path, delegate: d }, runningMode: 'VIDEO' }, extra);
      try { return await Cls.createFromOptions(files, base('GPU')); }
      catch (e) { return await Cls.createFromOptions(files, base('CPU')); }
    };
    if (sense.level === 1) gesture = await make(vision.GestureRecognizer, MODEL.gesture, { numHands: 2 });
    if (sense.level === 2) pose = await make(vision.PoseLandmarker, MODEL.pose, { numPoses: 4 });
  }

  function mx(x) { return opts.mirror ? 1 - x : x; }

  function nearest(list, x, y) {
    let best = null, bd = 0.2;
    list.forEach(it => { const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } });
    return best;
  }

  function loop() {
    requestAnimationFrame(loop);
    sense.swipe = null;
    const v = sense.video;
    if (!v || v.readyState < 2 || v.currentTime === lastVideoTime) {
      if (debugOn) drawDebug();
      return;
    }
    lastVideoTime = v.currentTime;
    const now = performance.now();
    const dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;

    readMotion(v);
    if (gesture) readHands(v, now, dt);
    if (pose) readPeople(v, now, dt);
    readSwipe(now);
    if (debugOn) drawDebug();
  }

  function readMotion(v) {
    sctx.drawImage(v, 0, 0, GW, GH);
    const px = sctx.getImageData(0, 0, GW, GH).data;
    const cur = new Uint8Array(GW * GH);
    let n = 0, sx = 0, sy = 0;
    for (let i = 0, j = 0; i < cur.length; i++, j += 4) {
      const g = (px[j] * 3 + px[j + 1] * 4 + px[j + 2]) >> 3;
      cur[i] = g;
      if (prev && Math.abs(g - prev[i]) > DIFF) { n++; sx += i % GW; sy += (i / GW) | 0; }
    }
    prev = cur;
    sense.motion += (Math.min(1, (n / cur.length) * 6) - sense.motion) * 0.3;
    if (n > 20) {
      const x = mx(sx / n / GW), y = sy / n / GH;
      sense.where.x += (x - sense.where.x) * 0.3;
      sense.where.y += (y - sense.where.y) * 0.3;
    }
  }

  function readHands(v, now, dt) {
    const r = gesture.recognizeForVideo(v, now);
    const old = sense.hands;
    sense.hands = (r.landmarks || []).map((pts, i) => {
      const points = pts.map(p => ({ x: mx(p.x), y: p.y }));
      const x = points[9].x, y = points[9].y;
      const top = r.gestures && r.gestures[i] && r.gestures[i][0];
      const name = top && top.score > 0.5 ? (GESTURE[top.categoryName] || 'none') : 'none';
      const was = nearest(old, x, y);
      let speed = 0;
      if (was && dt > 0) {
        speed = Math.min(1, Math.hypot(x - was.x, y - was.y) / dt / 2);
        speed = was.speed + (speed - was.speed) * 0.3;
      }
      return { x, y, gesture: name, speed, points };
    });
    const g = sense.hands.length ? sense.hands[0].gesture : 'none';
    if (g !== lastGesture) { lastGesture = g; emit('gesture', g, sense.hands[0] || null); }
  }

  function readPeople(v, now, dt) {
    const r = pose.detectForVideo(v, now);
    const old = sense.people;
    sense.people = (r.landmarks || []).map(pts => {
      const points = pts.map(p => ({ x: mx(p.x), y: p.y, v: p.visibility }));
      const x = (points[11].x + points[12].x + points[23].x + points[24].x) / 4;
      const y = (points[11].y + points[12].y + points[23].y + points[24].y) / 4;
      const was = nearest(old, x, y);
      let speed = 0;
      if (was && dt > 0) {
        const ids = [0, 15, 16, 27, 28];   // nose, wrists, ankles
        let d = 0;
        ids.forEach(k => { d += Math.hypot(points[k].x - was.points[k].x, points[k].y - was.points[k].y); });
        speed = Math.min(1, d / ids.length / dt / 1.5);
        speed = was.speed + (speed - was.speed) * 0.3;
      }
      return { x, y, speed, points };
    });
    const avg = sense.people.length
      ? sense.people.reduce((s, p) => s + p.speed, 0) / sense.people.length : 0;
    sense.speed += (avg - sense.speed) * 0.3;

    const raw = sense.people.length;
    if (raw === pendingCount) pendingFrames++; else { pendingCount = raw; pendingFrames = 0; }
    if (pendingFrames >= COUNT_STEADY && pendingCount !== sense.count) {
      const before = sense.count;
      sense.count = pendingCount;
      emit(sense.count > before ? 'enter' : 'leave', sense.count);
    }
  }

  function readSwipe(now) {
    let p = null;
    if (sense.hands.length) p = sense.hands[0];
    else if (sense.motion > 0.04) p = sense.where;
    if (p) trail.push({ t: now, x: p.x, y: p.y });
    trail = trail.filter(q => now - q.t < SWIPE_WINDOW);
    if (trail.length < 4 || now - lastSwipe < SWIPE_COOLDOWN) return;
    const a = trail[0], b = trail[trail.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    let dir = null;
    if (Math.abs(dx) > SWIPE_DIST && Math.abs(dx) > Math.abs(dy) * 1.5) dir = dx > 0 ? 'right' : 'left';
    else if (Math.abs(dy) > SWIPE_DIST && Math.abs(dy) > Math.abs(dx) * 1.5) dir = dy > 0 ? 'down' : 'up';
    if (dir) { sense.swipe = dir; lastSwipe = now; trail = []; emit('swipe', dir); }
  }

  // ---------- debug view (D) ----------
  function setDebug(on) {
    debugOn = on;
    if (on && !dbg) {
      dbg = document.createElement('canvas');
      dbg.width = 320; dbg.height = 240;
      dbg.style.cssText = 'position:fixed;right:12px;bottom:12px;width:320px;height:240px;z-index:2147483646;border:1px solid #39ff14;background:#000;pointer-events:none;';
      document.body.appendChild(dbg);
      dctx = dbg.getContext('2d');
    }
    if (dbg) dbg.style.display = on ? 'block' : 'none';
  }

  function drawDebug() {
    const v = sense.video, w = dbg.width, h = dbg.height;
    dctx.fillStyle = '#000'; dctx.fillRect(0, 0, w, h);
    if (v && v.readyState >= 2) {
      dctx.save();
      if (opts.mirror) { dctx.translate(w, 0); dctx.scale(-1, 1); }
      dctx.globalAlpha = 0.6; dctx.drawImage(v, 0, 0, w, h);
      dctx.restore();
    }
    dctx.globalAlpha = 1;
    dctx.fillStyle = '#39ff14';
    dctx.beginPath(); dctx.arc(sense.where.x * w, sense.where.y * h, 4 + sense.motion * 30, 0, 7); dctx.fill();
    dctx.fillStyle = '#ffd400';
    sense.hands.forEach(hd => hd.points.forEach(p => dctx.fillRect(p.x * w - 2, p.y * h - 2, 4, 4)));
    dctx.fillStyle = '#ff3df0';
    sense.people.forEach(pp => pp.points.forEach(p => dctx.fillRect(p.x * w - 2, p.y * h - 2, 4, 4)));
    dctx.font = '12px monospace'; dctx.fillStyle = '#fff';
    const lines = [
      'level ' + sense.level + ' · ' + sense.status,
      'motion ' + sense.motion.toFixed(2) + '  where ' + sense.where.x.toFixed(2) + ',' + sense.where.y.toFixed(2),
      'hands ' + sense.hands.map(hd => hd.gesture).join(' ') + '   people ' + sense.count + '  speed ' + sense.speed.toFixed(2),
    ];
    if (sense.error) lines.push('! ' + sense.error.slice(0, 44));
    lines.forEach((t, i) => dctx.fillText(t, 6, 16 + i * 15));
  }

  function fail(msg, soft) {
    sense.error = msg;
    if (!soft) sense.status = 'error';
    console.warn('[sense] ' + msg);
    if (!document.body) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483647;max-width:60vw;padding:8px 12px;background:#300;color:#fff;font:14px sans-serif;border:1px solid #f33;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 10000);
  }

  window.addEventListener('keydown', e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) setDebug(!debugOn);
  });
})();
