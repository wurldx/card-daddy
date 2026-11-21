/* Keep the cards and the toggle exactly as authored, for the Code box (the live page rearranges them). */
window.__heroSrc = { cards: document.getElementById('stage').innerHTML, mode: document.querySelector('.mode').outerHTML };

/* Endless diagonal loop: cards enter at the top-right, glide down-left, and wrap.
   Every card rides one path made from the four slots measured from the reference. Between
   two points of the path the four corners are interpolated, and a matrix3d is rebuilt every
   frame, so the perspective stays correct while the card moves.

   Two settings:
   COUNT  cards across the diagonal. 4 = the original layout; more cards = smaller, denser cards
   SCALE  card size. The whole composition grows or shrinks as one, so spacing and overlap always stay right
   SPOT   spotlight on the card in the middle: 0 = off, 1 = full. The other cards dim, the middle one lifts and turns upright
   BLUR   how much the other cards blur while one is in the spotlight: 0 = none, 1 = strongest */
const COUNT = 4;
const SCALE = 1;
const SPOT = 1;
const BLUR = 0.5;
const BLUR_MAX = 12;               // blur at BLUR = 1, in px on a full-size card (it shrinks with the card)
const SPEED = 0.1;                  // drift speed, in card spacings per second at 4 cards (lower = slower)
const SW = 1645, SH = 1055;         // stage size (the page frame in the CD reference picture)

const hero = document.querySelector('.hero');
const stage = document.getElementById('stage');
const originals = [...stage.querySelectorAll('.card')];
const M = originals.length;
const size = originals.map(c => ({ w: c.offsetWidth, h: c.offsetHeight }));
originals.forEach((c, i) => { c._i = i; });

/* ---- Settings: "want" is where the controls are, "cur" eases toward it, so every change glides ---- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const want = { count: clamp(COUNT, 4, 16), scale: clamp(SCALE, 0.4, 2), spot: clamp(SPOT, 0, 1), blur: clamp(BLUR, 0, 1) };
const cur  = { count: want.count, scale: want.scale, spot: want.spot, blur: want.blur };
window.heroControls = {
  set(count, scale, spot, blur) {
    if (count != null) want.count = clamp(count, 4, 16);
    if (scale != null) want.scale = clamp(scale, 0.4, 2);
    if (spot != null) want.spot = clamp(spot, 0, 1);
    if (blur != null) want.blur = clamp(blur, 0, 1);
  }
};

/* ---- The path: [TL, TR, BR, BL] corners in stage pixels ---- */
const LEFT   = [[-339.1,564.7],[16.9,523.1],[72.2,847.1],[-267.4,961.7]];
const SECOND = [[45.5,577.9],[469,424.2],[609.5,788.1],[81.7,943.1]];
const CENTRE = [[481.5,422.3],[1057.5,198.5],[1247.5,649.6],[642.9,883.5]];
const RIGHT  = [[1160.8,170.8],[1803.6,-96.1],[1987.8,498.2],[1294.2,670.7]];
const BASE = [LEFT, SECOND, CENTRE, RIGHT];
function shift(q, dx, dy, s) {      // move + scale a quad about its centre
  const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
  return q.map(p => [cx + (p[0] - cx) * s + dx, cy + (p[1] - cy) * s + dy]);
}
/* u = 0..3 runs through the four measured slots. Past either end the path carries on in a straight
   line, growing at the top-right and shrinking at the bottom-left, so cards always enter and leave
   off-screen, whatever the size or number of cards. */
function pathQuad(u) {
  if (u <= 0) { const n = -u; return shift(LEFT, -430 * n, 45 * n, Math.pow(0.9, n)); }
  if (u >= 3) { const n = u - 3; return shift(RIGHT, 770 * n, -250 * n, Math.pow(1.1, n)); }
  const i = Math.floor(u), f = u - i, a = BASE[i], b = BASE[i + 1];
  return a.map((p, j) => [p[0] + (b[j][0] - p[0]) * f, p[1] + (b[j][1] - p[1]) * f]);
}

/* ---- Geometry helper ---- */
function matrixFor(q, w, h) {       // flat w x h box -> quad, as CSS matrix3d
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  return `matrix3d(${a/w},${d/w},0,${g/w},${b/h},${e/h},0,${k/h},0,0,1,0,${x0},${y0},0,1)`;
}

/* ---- Cards ----
   Cards sit on an endless row of numbered "nodes" n, one card spacing apart. Node n shows image
   n + 2 (wrapping), so a position always keeps its picture while the settings change. Only the
   nodes that can be seen (plus a hidden one at each end) get a card; the rest are parked. */
const free = originals.map(c => [c]);               // parked cards, one list per image
originals.forEach(c => { c.style.display = 'none'; });
const live = new Map();                             // node number -> card currently on the path
function acquire(n) {
  const i = (((n + 2) % M) + M) % M;
  let c = free[i].pop();
  if (!c) {
    c = originals[i].cloneNode(true);
    c.setAttribute('aria-hidden', 'true'); c.querySelector('img').alt = '';
    c._i = i; stage.appendChild(c);
  }
  c.style.display = '';
  return c;
}
function release(n, c) { c.style.display = 'none'; free[c._i].push(c); live.delete(n); }

/* ---- State ---- */
let p = 0;                          // scroll position, in card spacings
let ease = 1, vel = 0;              // auto-speed easing, drag momentum (spacings / s)
let hovering = false, dragging = false, lastT = 0, k = 1, appliedScale = 0, appliedSpot = -1;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const DIR = [0.952, -0.308], SLOT_LEN = 740;   // travel direction and card spacing at 4 cards (stage px)

/* Which part of the path is on screen? Found by testing real card positions, so the row of
   cards always reaches past every edge of the screen, at any size, count or window shape. */
const range = { a: 0, b: 3, key: '' };
function updateRange(s) {
  const w = hero.clientWidth, h = hero.clientHeight, key = [k, s, w, h].join();
  if (key === range.key) return;
  range.key = key;
  const tx = (w - SW * k) / 2, ty = (h - SH * k) / 2;
  const x0 = -tx / k - 40, x1 = (w - tx) / k + 40, y0 = -ty / k - 40, y1 = (h - ty) / k + 40;   // 40 = room for the shadow
  let a = Infinity, b = -Infinity;
  for (let u = -14; u <= 14; u += 0.05) {
    const q = shift(pathQuad(u), 0, 0, s);
    const xs = q.map(c => c[0]), ys = q.map(c => c[1]);
    if (Math.max(...xs) >= x0 && Math.min(...xs) <= x1 && Math.max(...ys) >= y0 && Math.min(...ys) <= y1) {
      if (u < a) a = u;
      if (u > b) b = u;
    }
  }
  if (!(a <= b)) { a = 0; b = 3; }
  range.a = a - 0.25; range.b = b + 0.25;     // one step beyond the screen: cards appear and vanish unseen
}

/* Turns a quad toward an upright rectangle with the same centre and average size.
   amt 0 = unchanged (tilted in perspective), 1 = facing straight at you. */
function uprightBlend(q, amt) {
  if (amt <= 0) return q;
  const len = (a, b) => Math.hypot(q[b][0] - q[a][0], q[b][1] - q[a][1]);
  const hw = (len(0, 1) + len(3, 2)) / 4, hh = (len(0, 3) + len(1, 2)) / 4;     // half width, half height
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const r = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
  return q.map((c, j) => [c[0] + (r[j][0] - c[0]) * amt, c[1] + (r[j][1] - c[1]) * amt]);
}

function render() {
  const s = 4 / cur.count;                          // spacing (and card size) relative to the 4-card layout
  updateRange(s);
  const kLo = Math.ceil((range.a - 1.5) / s - 0.5 - p), kHi = Math.floor((range.b - 1.5) / s - 0.5 - p);
  for (const [n, c] of live) if (n < kLo || n > kHi) release(n, c);
  for (let n = kLo; n <= kHi; n++) {
    let c = live.get(n);
    if (!c) { c = acquire(n); live.set(n, c); }
    const u = 1.5 + (n + p + 0.5) * s;              // spreads out from the middle of the row when the count changes
    // Spotlight: w is 1 for the card in the middle (u = 2), holds there for a moment, then fades to 0
    // one card spacing away. It drives the lift, the shadow, the dimming of the others, and the turn upright.
    const t = Math.min(1, Math.max(0, 1 - Math.abs(u - 2) / s) * 1.6), w = t * t * (3 - 2 * t) * cur.spot, dim = cur.spot - w;
    const q = uprightBlend(pathQuad(u), w);
    const blur = cur.blur * BLUR_MAX * (1 - t * t * (3 - 2 * t));   // sharp in the middle, softer the further from it
    c.style.transform = matrixFor(shift(q, 0, 0, s * (1 + 0.07 * w)), size[c._i].w, size[c._i].h);
    c.style.filter = `brightness(${(1 - 0.18 * dim).toFixed(3)}) saturate(${(1 - 0.35 * dim).toFixed(3)}) ` +
      `drop-shadow(0 ${(10 + 20 * w).toFixed(2)}px ${(12 + 24 * w).toFixed(2)}px rgba(0,0,0,${(0.16 + 0.12 * w).toFixed(3)}))` +
      (blur > 0.02 ? ` blur(${blur.toFixed(2)}px)` : '');
    // Stacking matches the reference: the far-left card sits over the second card and the
    // right card sits over the centre one. Distance from the middle decides the order, so
    // overlapping neighbours never swap places while moving.
    c.style.zIndex = Math.round(Math.abs(u - 1.5) * 1000) * 2 + (u > 1.5 ? 1 : 0);
  }
}

/* ---- Motion modes ----
   graceful: continuous slow drift (SPEED above).
   snappy:   one quick slide to the next position, a short pause, then repeat. */
const SNAPPY = { hold: 0.9, dur: 0.55 };        // pause (s) between steps, length of each slide (s)
let mode = 'graceful';
try { if (localStorage.getItem('heroMode') === 'snappy') mode = 'snappy'; } catch (_) {}
let anim = null;                                // current snappy slide: { from, to, t, dur }
let holdT = 0;                                  // seconds paused since the last slide
const easeOut = x => 1 - Math.pow(1 - x, 4);    // fast start, soft landing
const startStep = (to, dur) => { anim = { from: p, to, t: 0, dur }; };

function frame(now) {
  const dt = Math.min((now - lastT) / 1000 || 0, 0.05);
  lastT = now;
  const f = 1 - Math.exp(-dt * 8);                       // smooth, frame-rate independent glide to new settings
  for (const key of ['count', 'scale', 'spot', 'blur']) {
    const d = want[key] - cur[key];
    cur[key] = Math.abs(d) < 0.0005 ? want[key] : cur[key] + d * f;
  }
  if (cur.scale !== appliedScale) fit();
  if (cur.spot !== appliedSpot) { appliedSpot = cur.spot; hero.style.setProperty('--spot', cur.spot); }
  const s = 4 / cur.count;
  if (!dragging) {
    if (mode === 'snappy') {
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / anim.dur);
        p = anim.from + (anim.to - anim.from) * easeOut(anim.t);
        if (anim.t >= 1) { p = anim.to; anim = null; holdT = 0; }
      } else if (!hovering && !reduceMotion.matches) {
        holdT += dt;                                    // pauses while the pointer is over the hero
        if (holdT >= SNAPPY.hold) {
          const base = Math.round(p);                   // settle onto a slot first if a drag left it between two
          startStep(Math.abs(p - base) < 0.001 ? base - 1 : base, SNAPPY.dur);
        }
      }
    } else {
      const target = (hovering || reduceMotion.matches) ? 0 : 1;
      ease += (target - ease) * Math.min(1, dt * 5);     // smooth pause / resume
      p += (-SPEED / s * ease + vel) * dt;               // negative = toward the bottom-left; /s keeps the on-screen speed the same
      vel *= Math.exp(-dt * 3.2);
      if (Math.abs(vel) < 0.002) vel = 0;
    }
  }
  render();
  requestAnimationFrame(frame);
}

/* ---- Fit the stage to the hero (cover) ---- */
function fit() {
  const w = hero.clientWidth, h = hero.clientHeight;
  appliedScale = cur.scale;
  k = Math.max(w / SW, h / SH) * cur.scale;
  stage.style.setProperty('--k', k);
  stage.style.setProperty('--tx', (w - SW * k) / 2 + 'px');
  stage.style.setProperty('--ty', (h - SH * k) / 2 + 'px');
}
new ResizeObserver(fit).observe(hero);
fit();

/* ---- Drag with mouse or touch (momentum on release) ---- */
let lx = 0, ly = 0, lm = 0;
hero.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true; vel = 0; lx = e.clientX; ly = e.clientY; lm = performance.now();
  hero.classList.add('is-dragging'); hero.setPointerCapture(e.pointerId);
});
hero.addEventListener('pointermove', e => {
  if (!dragging) return;
  const now = performance.now(), s = 4 / cur.count;
  const dp = ((e.clientX - lx) * DIR[0] + (e.clientY - ly) * DIR[1]) / (SLOT_LEN * s * k);
  p += dp;                                             // drag up-right = cards move up-right
  vel = vel * 0.6 + (dp / (Math.max(now - lm, 1) / 1000)) * 0.4;
  lx = e.clientX; ly = e.clientY; lm = now;
});
function endDrag(e) {
  if (!dragging) return;
  dragging = false; hero.classList.remove('is-dragging');
  if (performance.now() - lm > 80) vel = 0;
  const vmax = 3 / (4 / cur.count);
  vel = Math.max(-vmax, Math.min(vmax, vel));
  if (mode === 'snappy') { anim = null; startStep(Math.round(p + vel * 0.3), 0.45); holdT = 0; vel = 0; }
  try { hero.releasePointerCapture(e.pointerId); } catch (_) {}
}
hero.addEventListener('pointerup', endDrag);
hero.addEventListener('pointercancel', endDrag);
hero.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hovering = true; });
hero.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hovering = false; });

/* ---- Graceful / Snappy toggle ---- */
const modeBtns = [...document.querySelectorAll('[data-mode]')];
function setMode(m, save) {
  mode = m; anim = null; vel = 0; ease = 0;             // ease = 0: graceful drift starts gently
  holdT = SNAPPY.hold * 0.5;                            // snappy: first slide comes after a short beat
  modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  if (save) { try { localStorage.setItem('heroMode', m); } catch (_) {} }
}
modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode, true)));
setMode(mode, false);

render();
requestAnimationFrame(frame);

/* ---- Demo controls: sliders + live code. Not part of the exported code. ---- */
(() => {
  const $ = id => document.getElementById(id);
  const panel = $('panel'), countIn = $('count'), sizeIn = $('size'), spotIn = $('spot'), blurIn = $('blur'), countOut = $('countOut'), sizeOut = $('sizeOut'), spotOut = $('spotOut'), blurOut = $('blurOut');
  const codeEl = $('code'), codeSize = $('codeSize'), copyBtn = $('copy'), fold = $('fold');
  const src = window.__heroSrc;
  let sourcePromise;

  async function getSources() {
    if (!sourcePromise) {
      sourcePromise = Promise.all([
        fetch('script.js').then(response => response.ok ? response.text() : Promise.reject(new Error('Could not load script.js'))),
        fetch('style.css').then(response => response.ok ? response.text() : Promise.reject(new Error('Could not load style.css')))
      ]);
    }
    return sourcePromise;
  }

  /* The full page, with the two settings written into the script. */
  async function buildCode() {
    const count = +countIn.value, scale = Number((sizeIn.value / 100).toFixed(2)), spot = Number((spotIn.value / 100).toFixed(2)), blur = Number((blurIn.value / 100).toFixed(2));
    const [source, stylesheet] = await getSources();
    const js = source
      .split('/* ---- Demo controls')[0]
      .replace(/const COUNT = [\d.]+;/, 'const COUNT = ' + count + ';')
      .replace(/const SCALE = [\d.]+;/, 'const SCALE = ' + scale + ';')
      .replace(/const SPOT = [\d.]+;/, 'const SPOT = ' + spot + ';')
      .replace(/const BLUR = [\d.]+;/, 'const BLUR = ' + blur + ';');
    const css = stylesheet.split('/* ---- Demo controls')[0];
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      '<title>Floating Card Hero</title>\n<style>' + css + '</style>\n</head>\n<body>\n' +
      '<!-- Replace each <img src> below with your own image (about 4:3). Card shape, position and perspective are set by the CSS. -->\n' +
      '<section class="hero" aria-label="Featured work">\n  <div class="stage" id="stage">' + src.cards + '</div>\n</section>\n' +
      src.mode + '\n<script>' + js + '<\/script>\n</body>\n</html>\n';
  }

  let queued = false;
  async function showCode() {
    queued = false;
    const code = await buildCode();
    codeEl.value = code;
    codeSize.textContent = '\u00b7 ' + (new Blob([code]).size / 1024).toFixed(1) + ' KB';
  }
  function sync() {
    window.heroControls.set(+countIn.value, sizeIn.value / 100, spotIn.value / 100, blurIn.value / 100);
    countOut.textContent = countIn.value;
    sizeOut.textContent = sizeIn.value + '%';
    spotOut.textContent = spotIn.value + '%';
    blurOut.textContent = blurIn.value + '%';
    [countIn, sizeIn, spotIn, blurIn].forEach(el => el.style.setProperty('--pct', (el.value - el.min) / (el.max - el.min) * 100 + '%'));
    if (!queued) { queued = true; requestAnimationFrame(showCode); }   // one rebuild per frame, however fast the slider moves
  }
  [countIn, sizeIn, spotIn, blurIn].forEach(el => el.addEventListener('input', sync));
  sync();

  let timer;
  copyBtn.addEventListener('click', async () => {
    const code = codeEl.value;
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; } catch (_) {}
    if (!ok) {                                          // clipboard API blocked (e.g. inside a frame): use the old route
      codeEl.focus(); codeEl.select();
      try { ok = document.execCommand('copy'); } catch (_) {}
      if (ok) { codeEl.setSelectionRange(0, 0); codeEl.blur(); }
    }
    copyBtn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    clearTimeout(timer);
    timer = setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1800);
  });

  fold.addEventListener('click', () => {
    const closed = panel.classList.toggle('is-collapsed');
    fold.setAttribute('aria-expanded', String(!closed));
    fold.setAttribute('aria-label', closed ? 'Expand controls' : 'Collapse controls');
    fold.innerHTML = closed ? '+' : '&minus;';
  });
})();
