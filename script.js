<script>
/* Keep the cards and the toggle exactly as authored, for the Code box (the live page rearranges them). */
window.__heroSrc = { cards: document.getElementById('stage').innerHTML, mode: document.querySelector('.mode').outerHTML };
</scrip<script>
/* ---- Demo controls: sliders + live code. Not part of the exported code. ---- */
(() => {
  const $ = id => document.getElementById(id);
  const panel = $('panel'), countIn = $('count'), sizeIn = $('size'), spotIn = $('spot'), blurIn = $('blur'), countOut = $('countOut'), sizeOut = $('sizeOut'), spotOut = $('spotOut'), blurOut = $('blurOut');
  const codeEl = $('code'), codeSize = $('codeSize'), copyBtns = [...document.querySelectorAll('.copy-btn')], fold = $('fold'), codeToggle = $('codeToggle');
  const engine = $('hero-engine'), css = $('hero-css'), src = window.__heroSrc;
  const frame = $('phoneFrame'), phone = $('phone'), phoneBox = $('phoneBox'), viewBtns = [...document.querySelectorAll('[data-view]')];
  let mobileView = false, reloadTimer;

  /* The full page, with the two settings written into the script. */
  function buildCode() {
    const count = +countIn.value, scale = Number((sizeIn.value / 100).toFixed(2)), spot = Number((spotIn.value / 100).toFixed(2)), blur = Number((blurIn.value / 100).toFixed(2));
    const js = engine.textContent
      .replace(/const COUNT = [\d.]+;/, 'const COUNT = ' + count + ';')
      .replace(/const SCALE = [\d.]+;/, 'const SCALE = ' + scale + ';')
      .replace(/const SPOT = [\d.]+;/, 'const SPOT = ' + spot + ';')
      .replace(/const BLUR = [\d.]+;/, 'const BLUR = ' + blur + ';');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#ffffff">\n' +
      '<title>Floating Card Hero</title>\n<style>' + css.textContent + '</style>\n</head>\n<body>\n' +
      '<!-- Replace each <img src> below with your own image (about 4:3). Card shape, position and perspective are set by the CSS. -->\n' +
      '<section class="hero" aria-label="Featured work">\n  <div class="stage" id="stage">' + src.cards + '</div>\n</section>\n' +
      src.mode + '\n<script>' + js + '<\/script>\n</body>\n</html>\n';
  }

  let queued = false;
  function showCode() {
    queued = false;
    const code = buildCode();
    codeEl.value = code;
    codeSize.textContent = '\u00b7 ' + (new Blob([code]).size / 1024).toFixed(1) + ' KB';
  }
  function sync() {
    window.heroControls.set(+countIn.value, sizeIn.value / 100, spotIn.value / 100, blurIn.value / 100);
    countOut.textContent = countIn.value + (mobileView && +countIn.value > 8 ? ' \u00b7 phones show 8' : '');
    sizeOut.textContent = sizeIn.value + '%';
    spotOut.textContent = spotIn.value + '%';
    blurOut.textContent = blurIn.value + '%';
    [countIn, sizeIn, spotIn, blurIn].forEach(el => el.style.setProperty('--pct', (el.value - el.min) / (el.max - el.min) * 100 + '%'));
    if (!queued) { queued = true; requestAnimationFrame(showCode); }   // one rebuild per frame, however fast the slider moves
    pushToPhone();
  }

  /* ---- Mobile preview: the exported code, running inside a Galaxy S26-sized frame ---- */
  function pushToPhone() {
    if (!mobileView) return;
    try {                                               // same-page call: the phone glides to the new settings, no reload
      frame.contentWindow.heroControls.set(+countIn.value, sizeIn.value / 100, spotIn.value / 100, blurIn.value / 100);
    } catch (_) {                                       // not loaded yet (or blocked): reload with the current code instead
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { if (mobileView) frame.srcdoc = buildCode(); }, 250);
    }
  }
  function fitPhone() {                                 // shrink the phone to fit short windows (never enlarge it)
    const padL = innerWidth >= 900 ? 440 : 24;
    const sc = Math.max(0.3, Math.min(1, (innerHeight - 64 - 40 - 34) / 800, (innerWidth - padL - 24) / 380));
    phoneBox.style.width = 380 * sc + 'px'; phoneBox.style.height = 800 * sc + 'px';
    phone.style.transform = 'scale(' + sc + ')';
  }
  function setView(v) {
    mobileView = v === 'mobile';
    document.body.classList.toggle('view-mobile', mobileView);
    viewBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    if (mobileView) {
      $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false });
      frame.srcdoc = buildCode();                       // the page you would copy, running as-is
      fitPhone();
      if (innerWidth < 900) setFolded(true);            // small window: get the panel out of the phone's way
    } else {
      clearTimeout(reloadTimer); frame.srcdoc = '';     // stops the phone's animation
    }
    sync();
  }
  viewBtns.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  addEventListener('resize', () => { if (mobileView) fitPhone(); });
  [countIn, sizeIn, spotIn, blurIn].forEach(el => el.addEventListener('input', sync));
  sync();

  let timer;
  async function copyCode() {
    let ok = false;
    try { await navigator.clipboard.writeText(codeEl.value); ok = true; } catch (_) {}
    if (!ok) {                                          // clipboard API blocked (e.g. inside a frame): select the text and use the old route
      panel.classList.add('show-code'); codeEl.focus(); codeEl.select();
      try { ok = document.execCommand('copy'); } catch (_) {}
      if (ok) { codeEl.setSelectionRange(0, 0); codeEl.blur(); }
    }
    copyBtns.forEach(b => { b.textContent = ok ? 'Copied' : 'Select & copy'; });
    clearTimeout(timer);
    timer = setTimeout(() => copyBtns.forEach(b => { b.textContent = 'Copy code'; }), 1800);
  }
  copyBtns.forEach(b => b.addEventListener('click', copyCode));

  function setFolded(closed) {
    panel.classList.toggle('is-collapsed', closed);
    fold.setAttribute('aria-expanded', String(!closed));
    fold.setAttribute('aria-label', closed ? 'Expand controls' : 'Collapse controls');
    fold.innerHTML = closed ? '+' : '&minus;';
  }
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('is-collapsed')));
  codeToggle.addEventListener('click', () => {
    const on = panel.classList.toggle('show-code');
    codeToggle.setAttribute('aria-expanded', String(on));
    codeToggle.textContent = on ? 'Hide code' : 'Show code';
  });

  /* Phones start folded, and the page itself never shows more than 8 cards on a small screen */
  if (matchMedia('(max-width: 560px)').matches) setFolded(true);
  if (matchMedia('(pointer: coarse)').matches || innerWidth < 700) { countIn.max = 8; sync(); }
})();
</scrip