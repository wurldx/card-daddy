/* ---- Demo controls: sliders + live code. Not part of the exported code. ---- */
(() => {
  const byId = id => document.getElementById(id);
  const panel = byId('panel');
  const countIn = byId('count');
  const sizeIn = byId('size');
  const speedIn = byId('speed');
  const spotIn = byId('spot');
  const blurIn = byId('blur');
  const countOut = byId('countOut');
  const sizeOut = byId('sizeOut');
  const speedOut = byId('speedOut');
  const spotOut = byId('spotOut');
  const blurOut = byId('blurOut');
  const codeEl = byId('code');
  const codeSize = byId('codeSize');
  const copyBtns = [...document.querySelectorAll('.copy-btn')];
  const fold = byId('fold');
  const codeToggle = byId('codeToggle');
  const modeBtns = [...document.querySelectorAll('[data-mode]')];
  const heroMarkup = window.__heroSrc;
  const frame = byId('phoneFrame');
  const phone = byId('phone');
  const phoneBox = byId('phoneBox');
  const viewBtns = [...document.querySelectorAll('[data-view]')];
  let mobileView = false;
  let reloadTimer;
  let exportAssetsPromise;
  let currentMode = 'graceful';
  try {
    if (localStorage.getItem('heroMode') === 'snappy') {
      currentMode = 'snappy';
    }
  } catch (_) {}

  modeBtns.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === currentMode));
  });
  window.heroControls.setMode(currentMode, false);

  function getExportAssets() {
    if (!exportAssetsPromise) {
      exportAssetsPromise = Promise.all([
        fetch('hero-engine.js').then(response => {
          if (!response.ok) {
            throw new Error('Could not load hero engine');
          }
          return response.text();
        }),
        fetch('style.css').then(response => {
          if (!response.ok) {
            throw new Error('Could not load hero styles');
          }
          return response.text();
        })
      ]).then(([engineText, styleText]) => {
        const exportedStyles = styleText.split('/* ---- Demo controls')[0].trim();
        return { engineText, styleText: exportedStyles };
      });
    }

    return exportAssetsPromise;
  }

  /* Build a standalone page with the current settings embedded in its script. */
  async function buildCode() {
    const count = Number(countIn.value);
    const scale = Number((sizeIn.value / 100).toFixed(2));
    const speed = Number((speedIn.value / 100).toFixed(2));
    const spot = Number((spotIn.value / 100).toFixed(2));
    const blur = Number((blurIn.value / 100).toFixed(2));
    const { engineText, styleText } = await getExportAssets();
    const js = engineText
      .replace(/const COUNT = [\d.]+;/, `const COUNT = ${count};`)
      .replace(/const SCALE = [\d.]+;/, `const SCALE = ${scale};`)
      .replace(/const SPOT = [\d.]+;/, `const SPOT = ${spot};`)
      .replace(/const BLUR = [\d.]+;/, `const BLUR = ${blur};`)
      .replace(/const SPEED_SCALE = [\d.]+;/, `const SPEED_SCALE = ${speed};`)
      .replace(/const INITIAL_MODE = '[^']+';/, `const INITIAL_MODE = '${currentMode}';`);

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      '<meta name="theme-color" content="#ffffff">\n' +
      '<title>Floating Card Hero</title>\n' +
      '<style>' + styleText + '</style>\n</head>\n<body>\n' +
      '<!-- Replace each <img src> below with your own image (about 4:3). Card shape, position and perspective are set by the CSS. -->\n' +
      '<section class="hero" aria-label="Featured work">\n' +
      '  <div class="stage" id="stage">' + heroMarkup.cards + '</div>\n' +
      '</section>\n' +
      '<script>' + js + '<\/script>\n</body>\n</html>\n';
  }

  let queued = false;
  let codeBuildVersion = 0;
  async function showCode() {
    const version = ++codeBuildVersion;
    const code = await buildCode();
    if (version !== codeBuildVersion) {
      return;
    }

    codeEl.value = code;
    codeSize.textContent = '\u00b7 ' + (new Blob([code]).size / 1024).toFixed(1) + ' KB';
  }

  function queueCodeUpdate() {
    if (queued) {
      return;
    }

    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      showCode();
    });
  }

  function sync() {
    window.heroControls.set(
      Number(countIn.value),
      sizeIn.value / 100,
      spotIn.value / 100,
      blurIn.value / 100,
      speedIn.value / 100
    );
    const shownCardCount = mobileView && Number(countIn.value) > 8
      ? ' \u00b7 phones show 8'
      : '';
    countOut.textContent = countIn.value + shownCardCount;
    sizeOut.textContent = sizeIn.value + '%';
    speedOut.textContent = speedIn.value + '%';
    spotOut.textContent = spotIn.value + '%';
    blurOut.textContent = blurIn.value + '%';
    [countIn, sizeIn, speedIn, spotIn, blurIn].forEach(input => {
      const progress = (input.value - input.min) / (input.max - input.min) * 100;
      input.style.setProperty('--pct', progress + '%');
    });
    queueCodeUpdate();
    pushToPhone();
  }

  /* Keep the phone preview in sync with the current controls. */
  function pushToPhone() {
    if (!mobileView) {
      return;
    }

    try {
      frame.contentWindow.heroControls.set(
        Number(countIn.value),
        sizeIn.value / 100,
        spotIn.value / 100,
        blurIn.value / 100,
        speedIn.value / 100
      );
      frame.contentWindow.heroControls.setMode(currentMode, false);
    } catch (_) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (mobileView) {
          frame.srcdoc = await buildCode();
        }
      }, 250);
    }
  }

  function fitPhone() {
    const leftPadding = innerWidth >= 900 ? 440 : 24;
    const availableHeight = innerHeight - 64 - 40 - 34;
    const availableWidth = innerWidth - leftPadding - 24;
    const phoneScale = Math.max(
      0.3,
      Math.min(1, availableHeight / 800, availableWidth / 380)
    );

    phoneBox.style.width = 380 * phoneScale + 'px';
    phoneBox.style.height = 800 * phoneScale + 'px';
    phone.style.transform = `scale(${phoneScale})`;
  }

  async function setView(view) {
    mobileView = view === 'mobile';
    document.body.classList.toggle('view-mobile', mobileView);
    viewBtns.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });

    if (mobileView) {
      byId('clock').textContent = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
      });
      frame.srcdoc = await buildCode();
      fitPhone();
      if (innerWidth < 900) {
        setFolded(true);
      }
    } else {
      clearTimeout(reloadTimer);
      frame.srcdoc = '';
    }

    sync();
  }

  viewBtns.forEach(button => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  addEventListener('resize', () => {
    if (mobileView) {
      fitPhone();
    }
  });
  [countIn, sizeIn, speedIn, spotIn, blurIn].forEach(input => {
    input.addEventListener('input', sync);
  });
  modeBtns.forEach(button => {
    button.addEventListener('click', () => {
      currentMode = button.dataset.mode;
      window.heroControls.setMode(currentMode, true);
      modeBtns.forEach(option => {
        option.setAttribute('aria-pressed', String(option === button));
      });
      sync();
      showCode();
    });
  });
  sync();

  let timer;
  async function copyCode() {
    let copySucceeded = false;
    try {
      await navigator.clipboard.writeText(codeEl.value);
      copySucceeded = true;
    } catch (_) {}

    if (!copySucceeded) {
      panel.classList.add('show-code');
      codeEl.focus();
      codeEl.select();
      try {
        copySucceeded = document.execCommand('copy');
      } catch (_) {}

      if (copySucceeded) {
        codeEl.setSelectionRange(0, 0);
        codeEl.blur();
      }
    }

    copyBtns.forEach(button => {
      button.textContent = copySucceeded ? 'Copied' : 'Select & copy';
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      copyBtns.forEach(button => {
        button.textContent = 'Copy code';
      });
    }, 1800);
  }

  copyBtns.forEach(button => {
    button.addEventListener('click', copyCode);
  });

  function setFolded(closed) {
    panel.classList.toggle('is-collapsed', closed);
    fold.setAttribute('aria-expanded', String(!closed));
    fold.setAttribute('aria-label', closed ? 'Expand controls' : 'Collapse controls');
    fold.innerHTML = closed ? '+' : '&minus;';
  }

  fold.addEventListener('click', () => {
    setFolded(!panel.classList.contains('is-collapsed'));
  });
  codeToggle.addEventListener('click', () => {
    const on = panel.classList.toggle('show-code');
    codeToggle.setAttribute('aria-expanded', String(on));
    codeToggle.textContent = on ? 'Hide code' : 'Show code';
  });

  /* Start with a compact panel on phones and limit card count on small screens. */
  if (matchMedia('(max-width: 560px)').matches) {
    setFolded(true);
  }

  if (matchMedia('(pointer: coarse)').matches || innerWidth < 700) {
    countIn.max = 8;
    sync();
  }
})();
