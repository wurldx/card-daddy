/* Keep the cards exactly as authored for the generated code. */
window.__heroSrc = { cards: document.getElementById('stage').innerHTML };

/* Endless diagonal loop: cards enter at the top-right, glide down-left, and wrap.
   Every card rides one path made from the four slots measured from the reference. Between
   two points of the path the four corners are interpolated, and a matrix3d is rebuilt every
   frame, so the perspective stays correct while the card moves.

   Settings:
   COUNT  cards across the diagonal. 4 = the original layout; more cards = smaller, denser cards
   SCALE  card size. The whole composition grows or shrinks as one, so spacing and overlap always stay right
   SPEED  motion speed multiplier. 1 = current speed; applies to movement, not the Snappy pause
   SPOT   spotlight on the card in the middle: 0 = off, 1 = full. The other cards dim, the middle one lifts and turns upright
   BLUR   how much the other cards blur while one is in the spotlight: 0 = none, 1 = strongest */
const COUNT = 4;
const SCALE = 1;
const SPOT = 1;
const BLUR = 0.5;
const INITIAL_MODE = 'graceful';
const SPEED_SCALE = 1;
const BLUR_MAX = 12;               // blur at BLUR = 1, in px on a full-size card (it shrinks with the card)
const SPEED = 0.1;                  // drift speed, in card spacings per second at 4 cards (lower = slower)
const SW = 1645;
const SH = 1055;
const PHONE_FIT = 0.0012; // portrait stage scale: middle card fills about 3/4 of the screen width

const hero = document.querySelector('.hero');
const stage = document.getElementById('stage');
const originals = [...stage.querySelectorAll('.card')];
const imageCount = originals.length;
const cardSizes = originals.map(card => ({
  w: card.offsetWidth,
  h: card.offsetHeight
}));
originals.forEach((card, index) => {
  card._imageIndex = index;
});

/* Control values become targets; current values ease toward them for smooth updates. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const targetSettings = {
  count: clamp(COUNT, 4, 16),
  scale: clamp(SCALE, 0.4, 2),
  speed: clamp(SPEED_SCALE, 0.5, 2),
  spot: clamp(SPOT, 0, 1),
  blur: clamp(BLUR, 0, 1)
};
const currentSettings = {
  count: targetSettings.count,
  scale: targetSettings.scale,
  speed: targetSettings.speed,
  spot: targetSettings.spot,
  blur: targetSettings.blur
};

window.heroControls = {
  set(count, scale, spot, blur, speed) {
    if (count != null) {
      targetSettings.count = clamp(count, 4, 16);
    }
    if (scale != null) {
      targetSettings.scale = clamp(scale, 0.4, 2);
    }
    if (spot != null) {
      targetSettings.spot = clamp(spot, 0, 1);
    }
    if (blur != null) {
      targetSettings.blur = clamp(blur, 0, 1);
    }
    if (speed != null) {
      targetSettings.speed = clamp(speed, 0.5, 2);
    }
  },
  setMode(modeName, save) {
    setMode(modeName, save);
  }
};

/* ---- The path: [TL, TR, BR, BL] corners in stage pixels ---- */
const LEFT = [
  [-339.1, 564.7], [16.9, 523.1], [72.2, 847.1], [-267.4, 961.7]
];
const SECOND = [
  [45.5, 577.9], [469, 424.2], [609.5, 788.1], [81.7, 943.1]
];
const CENTRE = [
  [481.5, 422.3], [1057.5, 198.5], [1247.5, 649.6], [642.9, 883.5]
];
const RIGHT = [
  [1160.8, 170.8], [1803.6, -96.1], [1987.8, 498.2], [1294.2, 670.7]
];
const BASE = [LEFT, SECOND, CENTRE, RIGHT];

const SNAPPY_MOBILE_SHIFT = [
  SW / 2 - CENTRE.reduce((sum, corner) => sum + corner[0], 0) / 4,
  SH / 2 - CENTRE.reduce((sum, corner) => sum + corner[1], 0) / 4
];

function shift(quad, dx, dy, scale) {
  const centerX = quad.reduce((sum, point) => sum + point[0], 0) / 4;
  const centerY = quad.reduce((sum, point) => sum + point[1], 0) / 4;

  return quad.map(point => [
    centerX + (point[0] - centerX) * scale + dx,
    centerY + (point[1] - centerY) * scale + dy
  ]);
}

/* u = 0..3 runs through the four measured slots. Past either end the path carries on in a straight
   line, growing at the top-right and shrinking at the bottom-left, so cards always enter and leave
   off-screen, whatever the size or number of cards. */
function pathQuad(u) {
  if (u <= 0) {
    const distance = -u;
    return shift(LEFT, -430 * distance, 45 * distance, Math.pow(0.9, distance));
  }

  if (u >= 3) {
    const distance = u - 3;
    return shift(RIGHT, 770 * distance, -250 * distance, Math.pow(1.1, distance));
  }

  const segment = Math.floor(u);
  const progress = u - segment;
  const start = BASE[segment];
  const end = BASE[segment + 1];
  return start.map((point, index) => [
    point[0] + (end[index][0] - point[0]) * progress,
    point[1] + (end[index][1] - point[1]) * progress
  ]);
}

/* ---- Geometry helper ---- */
function matrixFor(q, w, h) {       // flat w x h box -> quad, as CSS matrix3d
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const k = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
}

/* ---- Cards ----
   Cards sit on an endless row of numbered "nodes" n, one card spacing apart. Node n shows image
   n + 2 (wrapping), so a position always keeps its picture while the settings change. Only the
   nodes that can be seen (plus a hidden one at each end) get a card; the rest are parked. */
const free = originals.map(card => [card]); // parked cards, grouped by source image
originals.forEach(card => {
  card.style.display = 'none';
});
const live = new Map(); // path node number -> card currently using that position

function acquire(node) {
  const imageIndex = (((node + 2) % imageCount) + imageCount) % imageCount;
  let card = free[imageIndex].pop();

  if (!card) {
    card = originals[imageIndex].cloneNode(true);
    card.setAttribute('aria-hidden', 'true');
    card.querySelector('img').alt = '';
    card._imageIndex = imageIndex;
    stage.appendChild(card);
  }

  card.style.display = '';
  return card;
}

function release(node, card) {
  card.style.display = 'none';
  free[card._imageIndex].push(card);
  live.delete(node);
}

/* ---- State ---- */
let position = 0; // scroll position, in card spacings
let driftEase = 1;
let velocity = 0; // drag momentum, in spacings per second
let hovering = false;
let dragging = false;
let lastT = 0;
let stageScale = 1;
let appliedScale = 0;
let appliedSpot = -1;
let lite = false;
let portrait = false;
let onScreen = true;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const touchScreen = matchMedia('(pointer: coarse)');
const DIR = [0.952, -0.308];
const SLOT_LEN = 740; // path spacing at four cards, in stage pixels

/* Which part of the path is on screen? Found by testing real card positions, so the row of
   cards always reaches past every edge of the screen, at any size, count or window shape. */
const range = { a: 0, b: 3, key: '' };

function updateRange(s) {
  const width = hero.clientWidth;
  const height = hero.clientHeight;
  const key = [stageScale, s, width, height].join();
  if (key === range.key) {
    return;
  }

  range.key = key;
  const offsetX = (width - SW * stageScale) / 2;
  const offsetY = (height - SH * stageScale) / 2;
  const minX = -offsetX / stageScale - 40;
  const maxX = (width - offsetX) / stageScale + 40;
  const minY = -offsetY / stageScale - 40;
  const maxY = (height - offsetY) / stageScale + 40; // allow for the card shadow
  let a = Infinity, b = -Infinity;

  for (let u = -14; u <= 14; u += 0.05) {
    const quad = shift(pathQuad(u), 0, 0, s);
    const xs = quad.map(corner => corner[0]);
    const ys = quad.map(corner => corner[1]);
    const intersectsViewport =
      Math.max(...xs) >= minX &&
      Math.min(...xs) <= maxX &&
      Math.max(...ys) >= minY &&
      Math.min(...ys) <= maxY;

    if (intersectsViewport) {
      if (u < a) a = u;
      if (u > b) b = u;
    }
  }

  if (!(a <= b)) {
    a = 0;
    b = 3;
  }

  range.a = a - 0.25;
  range.b = b + 0.25;
}

/* Turns a quad toward an upright rectangle with the same centre and average size.
   amt 0 = unchanged (tilted in perspective), 1 = facing straight at you. */
function uprightBlend(q, amt) {
  if (amt <= 0) return q;
  const edgeLength = (start, end) => Math.hypot(
    q[end][0] - q[start][0],
    q[end][1] - q[start][1]
  );
  const halfWidth = (edgeLength(0, 1) + edgeLength(3, 2)) / 4;
  const halfHeight = (edgeLength(0, 3) + edgeLength(1, 2)) / 4;
  const centerX = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const centerY = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const upright = [
    [centerX - halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY + halfHeight],
    [centerX - halfWidth, centerY + halfHeight]
  ];

  return q.map((corner, index) => [
    corner[0] + (upright[index][0] - corner[0]) * amt,
    corner[1] + (upright[index][1] - corner[1]) * amt
  ]);
}

function render() {
  const s = 4 / currentSettings.count; // spacing and card size relative to the four-card layout
  const mobileShiftX = portrait && mode === 'snappy' ? SNAPPY_MOBILE_SHIFT[0] : 0;
  const mobileShiftY = portrait && mode === 'snappy' ? SNAPPY_MOBILE_SHIFT[1] : 0;
  updateRange(s);
  const firstNode = Math.ceil((range.a - 1.5) / s - 0.5 - position);
  const lastNode = Math.floor((range.b - 1.5) / s - 0.5 - position);

  for (const [node, card] of live) {
    if (node < firstNode || node > lastNode) {
      release(node, card);
    }
  }

  for (let node = firstNode; node <= lastNode; node++) {
    let card = live.get(node);
    if (!card) {
      card = acquire(node);
      live.set(node, card);
    }

    const pathPosition = 1.5 + (node + position + 0.5) * s;
    // The spotlight lifts, sharpens, brightens, and straightens the card at the center.
    const proximity = Math.min(
      1,
      Math.max(0, 1 - Math.abs(pathPosition - 2) / s) * 1.6
    );
    const focus = proximity * proximity * (3 - 2 * proximity);
    const spotlight = focus * currentSettings.spot;
    const dim = currentSettings.spot - spotlight;
    const quad = uprightBlend(
      shift(pathQuad(pathPosition), mobileShiftX, mobileShiftY, 1),
      spotlight
    );
    const blur = currentSettings.blur *
      (lite ? BLUR_MAX * 0.6 : BLUR_MAX) *
      (1 - proximity * proximity * (3 - 2 * proximity));
    const cardScale = s * (1 + 0.07 * spotlight);

    card.style.transform = matrixFor(
      shift(quad, 0, 0, cardScale),
      cardSizes[card._imageIndex].w,
      cardSizes[card._imageIndex].h
    );
    const brightness = (1 - 0.18 * dim).toFixed(3);
    const saturation = (1 - 0.35 * dim).toFixed(3);
    const shadow = lite
      ? `drop-shadow(0 ${(6 + 12 * spotlight).toFixed(2)}px ${(8 + 14 * spotlight).toFixed(2)}px rgba(0,0,0,${(0.16 + 0.1 * spotlight).toFixed(3)}))`
      : `drop-shadow(0 ${(10 + 20 * spotlight).toFixed(2)}px ${(12 + 24 * spotlight).toFixed(2)}px rgba(0,0,0,${(0.16 + 0.12 * spotlight).toFixed(3)}))`;
    const blurFilter = blur > 0.02 ? ` blur(${blur.toFixed(2)}px)` : '';
    card.style.filter = `brightness(${brightness}) saturate(${saturation}) ${shadow}${blurFilter}`;

    // Keep the spotlighted card above its neighbors while the outer cards retain
    // their authored front-to-back order.
    const focusPosition = 2 + 0.3 * s;
    const stackingFocus = Math.max(
      0,
      1 - Math.abs(pathPosition - focusPosition) / (1.3 * s)
    );
    const baseZIndex = Math.round(Math.abs(pathPosition - 1.5) * 1000) * 2;
    const sideOrder = pathPosition > 1.5 ? 1 : 0;
    const focusZIndex = Math.round(
      100000 * stackingFocus * stackingFocus * (3 - 2 * stackingFocus)
    );

    card.style.zIndex = baseZIndex + sideOrder + focusZIndex;
  }
}

/* ---- Motion modes ----
   graceful: continuous slow drift (SPEED above).
   snappy:   one quick slide to the next position, a short pause, then repeat. */
const SNAPPY = {
  hold: 0.9,
  dur: 0.55
};
let mode = INITIAL_MODE;
let snappyAnimation = null; // active slide: { from, to, t, dur }
let snappyHoldTime = 0; // seconds paused since the last slide
const easeOut = x => 1 - Math.pow(1 - x, 4);

function startStep(to, duration) {
  snappyAnimation = { from: position, to, t: 0, dur: duration };
}

function frame(now) {
  if (!onScreen || document.hidden) {
    lastT = now;
    requestAnimationFrame(frame);
    return;
  }

  const dt = Math.min((now - lastT) / 1000 || 0, 0.05);
  lastT = now;
  const easing = 1 - Math.exp(-dt * 8);
  const target = {
    count: Math.min(targetSettings.count, lite ? 8 : 16),
    scale: targetSettings.scale,
    speed: targetSettings.speed,
    spot: targetSettings.spot,
    blur: targetSettings.blur
  };

  for (const key in target) {
    const difference = target[key] - currentSettings[key];
    currentSettings[key] = Math.abs(difference) < 0.0005
      ? target[key]
      : currentSettings[key] + difference * easing;
  }

  if (currentSettings.scale !== appliedScale) fit();
  if (currentSettings.spot !== appliedSpot) {
    appliedSpot = currentSettings.spot;
    hero.style.setProperty('--spot', currentSettings.spot);
  }

  const s = 4 / currentSettings.count;
  if (!dragging) {
    if (mode === 'snappy') {
      if (snappyAnimation) {
        snappyAnimation.t = Math.min(
          1,
          snappyAnimation.t + dt * currentSettings.speed / snappyAnimation.dur
        );
        position = snappyAnimation.from +
          (snappyAnimation.to - snappyAnimation.from) * easeOut(snappyAnimation.t);
        if (snappyAnimation.t >= 1) {
          position = snappyAnimation.to;
          snappyAnimation = null;
          snappyHoldTime = 0;
        }
      } else if (!hovering && !reduceMotion.matches) {
        snappyHoldTime += dt;
        if (snappyHoldTime >= SNAPPY.hold) {
          const base = Math.round(position);
          startStep(Math.abs(position - base) < 0.001 ? base - 1 : base, SNAPPY.dur);
        }
      }
    } else {
      const target = (hovering || reduceMotion.matches) ? 0 : 1;
      driftEase += (target - driftEase) * Math.min(1, dt * 5);
      position += (-SPEED * currentSettings.speed / s * driftEase + velocity) * dt;
      velocity *= Math.exp(-dt * 3.2);
      if (Math.abs(velocity) < 0.002) velocity = 0;
    }
  }

  render();
  requestAnimationFrame(frame);
}

/* ---- Fit the stage to the hero ----
   Wide screens: the stage covers the hero. Portrait screens (phones): covering would crop the
   picture down to one card, so instead the stage is zoomed out until the middle card fills about
   3/4 of the width, with its neighbours peeking in along the diagonal. */
function fit() {
  const w = hero.clientWidth, h = hero.clientHeight;
  if (!w || !h) {
    return;
  }

  appliedScale = currentSettings.scale;
  lite = touchScreen.matches || w < 700;
  portrait = h > w * 1.15;
  stageScale = (portrait ? w * PHONE_FIT : Math.max(w / SW, h / SH)) * currentSettings.scale;
  stage.style.setProperty('--k', stageScale);
  stage.style.setProperty('--tx', (w - SW * stageScale) / 2 + 'px');
  stage.style.setProperty('--ty', (h - SH * stageScale) / 2 + 'px');
}
new ResizeObserver(fit).observe(hero);
if ('IntersectionObserver' in window) new IntersectionObserver(e => { onScreen = e[e.length - 1].isIntersecting; }).observe(hero);
fit();

/* ---- Drag with mouse or touch (momentum on release) ---- */
let lx = 0;
let ly = 0;
let lm = 0;

hero.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) {
    return;
  }

  dragging = true;
  velocity = 0;
  lx = e.clientX;
  ly = e.clientY;
  lm = performance.now();
  hero.classList.add('is-dragging');
  hero.setPointerCapture(e.pointerId);
});

hero.addEventListener('pointermove', e => {
  if (!dragging) {
    return;
  }

  const now = performance.now();
  const s = 4 / currentSettings.count;
  const dp = ((e.clientX - lx) * DIR[0] + (e.clientY - ly) * DIR[1]) / (SLOT_LEN * s * stageScale);
  position += dp;
  velocity = velocity * 0.6 + (dp / (Math.max(now - lm, 1) / 1000)) * 0.4;
  lx = e.clientX;
  ly = e.clientY;
  lm = now;
});

function endDrag(e) {
  if (!dragging) {
    return;
  }

  dragging = false;
  hero.classList.remove('is-dragging');
  if (performance.now() - lm > 80) {
    velocity = 0;
  }

  const vmax = 3 / (4 / currentSettings.count);
  velocity = Math.max(-vmax, Math.min(vmax, velocity));
  if (mode === 'snappy') {
    snappyAnimation = null;
    startStep(Math.round(position + velocity * 0.3), 0.45);
    snappyHoldTime = 0;
    velocity = 0;
  }

  try {
    hero.releasePointerCapture(e.pointerId);
  } catch (_) {}
}

hero.addEventListener('pointerup', endDrag);
hero.addEventListener('pointercancel', endDrag);
hero.addEventListener('pointerenter', e => {
  if (e.pointerType === 'mouse' && !lite) {
    hovering = true;
  }
});
hero.addEventListener('pointerleave', e => {
  if (e.pointerType === 'mouse') {
    hovering = false;
  }
});

/* ---- Graceful / Snappy mode selection ---- */
function setMode(modeName, persist) {
  if (modeName !== 'graceful' && modeName !== 'snappy') {
    return;
  }

  if (mode === modeName) {
    if (persist) {
      try {
        localStorage.setItem('heroMode', modeName);
      } catch (_) {}
    }

    return;
  }

  mode = modeName;
  snappyAnimation = null;
  velocity = 0;
  driftEase = 0;
  snappyHoldTime = SNAPPY.hold * 0.5;
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === modeName));
  });
  if (persist) {
    try {
      localStorage.setItem('heroMode', modeName);
    } catch (_) {}
  }
}

render();
requestAnimationFrame(frame);
