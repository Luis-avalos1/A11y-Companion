// tour.js — a self-driving guided tour of every A11y Companion feature.
//
// It controls the REAL toolbar by reaching into its (open) shadow root and
// clicking the same buttons a user would, plus it dispatches synthetic pointer
// and keyboard events for the ruler / hover-reader / keyboard-nav demos. The
// exact same routine powers the on-page "Play the guided tour" button and the
// Playwright video recorder, so the recording always matches the live site.
(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let cancelled = false;

  // ── Toolbar access (open shadow DOM) ──
  const host = () => document.getElementById('__a11y-companion-host');
  const tb = () => host()?.shadowRoot || null;
  const click = (sel) => { const el = tb()?.querySelector(sel); if (el) el.click(); };
  const setColor = (mode) => {
    const s = tb()?.querySelector('#colorMode');
    if (s) { s.value = mode; s.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const isPressed = (sel) => tb()?.querySelector(sel)?.getAttribute('aria-pressed') === 'true';
  const ensureOff = (sel) => { if (isPressed(sel)) click(sel); };

  // ── Caption + spotlight overlay ──
  let cap, spot;
  function ensureOverlay() {
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'a11y-tour-caption';
      cap.setAttribute('role', 'status');
      cap.setAttribute('aria-live', 'polite');
      document.body.appendChild(cap);
    }
    if (!spot) {
      spot = document.createElement('div');
      spot.id = 'a11y-tour-spot';
      document.body.appendChild(spot);
    }
  }
  function say(label, html) {
    ensureOverlay();
    cap.innerHTML = `<span class="step">${label}</span>${html}`;
    cap.classList.add('show');
  }
  function hideCap() { cap && cap.classList.remove('show'); }
  function spotlight(target) {
    ensureOverlay();
    if (!target) { spot.classList.remove('show'); return; }
    const r = typeof target.getBoundingClientRect === 'function'
      ? target.getBoundingClientRect() : target;
    const pad = 8;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    spot.classList.add('show');
  }
  function clearSpot() { spot && spot.classList.remove('show'); }

  // ── Synthetic input helpers ──
  function movePointer(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  }
  async function sweepRuler() {
    // Animate the pointer down the article so the ruler band visibly follows.
    const x = Math.round(innerWidth * 0.4);
    for (let y = 180; y < innerHeight - 160 && !cancelled; y += 14) {
      movePointer(x, y);
      await sleep(28);
    }
  }
  function pressArrow(key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  function hoverText(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  async function scrollTo(y) {
    window.scrollTo({ top: y, behavior: cancelled ? 'auto' : 'smooth' });
    await sleep(650);
  }
  function elTop(sel) {
    const el = document.querySelector(sel);
    if (!el) return 0;
    return window.scrollY + el.getBoundingClientRect().top;
  }

  async function resetState() {
    // Begin from a clean, default page so the tour is deterministic.
    const all = await chrome.storage.sync.get(null);
    const siteKeys = Object.keys(all).filter((k) => k.startsWith('site:'));
    if (siteKeys.length) await chrome.storage.sync.remove(siteKeys);
    await chrome.storage.sync.set({ ...A11Y_DEFAULTS });
    await sleep(450); // let the content script reconcile
  }

  async function waitForToolbar(ms = 6000) {
    const start = Date.now();
    while (!tb() && Date.now() - start < ms) await sleep(100);
    return !!tb();
  }

  // ── The tour ──
  async function run() {
    if (!(await waitForToolbar())) return;
    await scrollTo(0);
    await resetState();

    // 1. Intro
    spotlight(host());
    say('Welcome', 'This floating bar is the <b>real</b> A11y Companion extension, running live on this page. Watch it reshape the article →');
    await sleep(3400);
    clearSpot();
    if (cancelled) return cleanup();

    // 2. Bigger text
    say('Text size', 'Make text <b>bigger</b> — it scales the page itself, so layouts stay intact.');
    click('[data-act="font+"]'); await sleep(500);
    click('[data-act="font+"]'); await sleep(500);
    click('[data-act="font+"]'); await sleep(2200);
    click('[data-act="font-"]'); click('[data-act="font-"]'); click('[data-act="font-"]');
    await sleep(500);
    if (cancelled) return cleanup();

    // 3. Spacing
    say('Spacing', 'Open up <b>letter and line spacing</b> — a big help for dyslexic readers.');
    click('[data-act="space+"]'); await sleep(500);
    click('[data-act="space+"]'); await sleep(2300);
    click('[data-act="space-"]'); click('[data-act="space-"]');
    await sleep(500);
    if (cancelled) return cleanup();

    // 4. Dyslexia font
    say('Dyslexia font', 'Switch the whole page to the <b>OpenDyslexic</b> typeface in one tap.');
    click('#t-dyslexiaFont'); await sleep(3200);
    ensureOff('#t-dyslexiaFont'); await sleep(500);
    if (cancelled) return cleanup();

    // 5. Reading mode
    await scrollTo(0);
    say('Reading mode', 'Strip the page down to just the article and <b>dim everything else</b>.');
    click('#t-readingMode'); await sleep(3600);
    ensureOff('#t-readingMode'); await sleep(500);
    if (cancelled) return cleanup();

    // 6. Reading ruler
    say('Reading ruler', 'A focus band <b>follows your pointer</b> and dims the rest, so you never lose your line.');
    click('#t-ruler'); await sleep(400);
    await sweepRuler();
    await sleep(600);
    ensureOff('#t-ruler'); await sleep(500);
    if (cancelled) return cleanup();

    // 7. Dark / invert
    say('Dark mode', 'Invert the page to a <b>dark, low-glare</b> theme.');
    setColor('invert'); await sleep(2600);
    if (cancelled) return cleanup();

    // 8. High contrast
    say('High contrast', 'Maximise contrast — text on solid black, links in cyan.');
    setColor('high-contrast'); await sleep(2600);

    // 9. Colour blindness
    await scrollTo(elTop('.inline-figure') - 120);
    spotlight(document.querySelector('.inline-figure img'));
    say('Color-blindness filters', 'Real color-matrix simulations. Switching to <b>Deuteranopia</b> — watch the hidden “5” wash out.');
    setColor('deuteranopia'); await sleep(3600);
    setColor('default'); clearSpot(); await sleep(500);
    if (cancelled) return cleanup();

    // 10. Keyboard navigation
    await scrollTo(0);
    say('Keyboard navigation', 'Walk every link and button with the <b>arrow keys</b> and a visible focus ring; Enter activates.');
    click('#t-keyboardNav'); await sleep(700);
    for (let i = 0; i < 5 && !cancelled; i++) { pressArrow('ArrowDown'); await sleep(620); }
    await sleep(700);
    ensureOff('#t-keyboardNav'); await sleep(400);
    if (cancelled) return cleanup();

    // 11. Screen reader (hover to read)
    spotlight(document.querySelector('article p'));
    say('Screen reader', 'Turn on hover-to-read and <b>point at anything</b> — it speaks the text under your cursor.');
    click('#t-screenReader'); await sleep(800);
    hoverText(document.querySelector('article p')); await sleep(2600);
    ensureOff('#t-screenReader'); clearSpot(); await sleep(400);
    if (cancelled) return cleanup();

    // 12. Read aloud (moving highlight)
    await scrollTo(0);
    say('Read aloud', 'Read the whole article aloud, in chunks, with a <b>moving highlight</b> and pause / skip controls.');
    click('#read-play'); await sleep(1400);
    for (let i = 0; i < 4 && !cancelled; i++) { click('#read-skip'); await sleep(1200); }
    click('#read-play'); // stop
    await sleep(500);
    if (cancelled) return cleanup();

    // 13. Voice commands
    say('Voice commands', 'Go hands-free: say “scroll down”, “reading mode”, or “click add to chrome”.');
    click('#t-voiceInput'); await sleep(3000);
    ensureOff('#t-voiceInput'); await sleep(400);
    if (cancelled) return cleanup();

    // 14. On-device AI
    say('On-device AI', 'Summarize the page with Chrome’s built-in model — <b>privately, on your device</b>.');
    click('#ai-summary');
    await sleep(3600); // sheet renders the summary
    click('#sheet-close'); await sleep(500);
    if (cancelled) return cleanup();

    // 15. Presets
    say('One-tap presets', 'Starting points for common needs — here’s the <b>Low-vision</b> preset.');
    await chrome.storage.sync.set({ ...A11Y_PRESET_BASE, ...A11Y_PRESETS['low-vision'].settings });
    await sleep(3000);
    if (cancelled) return cleanup();

    // 16. Reset
    say('Reset', 'One tap puts every setting back to default.');
    click('#reset'); await sleep(1800);

    // 17. Outro
    await scrollTo(0);
    spotlight(document.getElementById('cta-store'));
    say('Try it yourself', 'A11y Companion works on <b>every</b> website. Add it to Chrome, or explore the toolbar below.');
    await sleep(4200);
    cleanup();
  }

  function cleanup() {
    clearSpot();
    hideCap();
    running = false;
    document.dispatchEvent(new CustomEvent('a11y-tour-done'));
  }

  window.A11yTour = {
    async start() {
      if (running) return;
      running = true;
      cancelled = false;
      try { await run(); }
      catch (e) { console.error('[a11y-tour]', e); cleanup(); }
    },
    stop() { cancelled = true; },
    get running() { return running; },
  };
})();
