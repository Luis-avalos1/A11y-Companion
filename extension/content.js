// A11y Companion — content script
// Injects an accessibility toolbar into a Shadow DOM on every page,
// and applies user settings synced via chrome.storage.sync.

(function () {
  'use strict';
  if (window.__a11yCompanionLoaded) return;
  window.__a11yCompanionLoaded = true;

  // Defaults and keys come from shared.js, which the manifest loads first.
  const DEFAULTS = A11Y_DEFAULTS;
  const STORAGE_KEYS = A11Y_KEYS;
  // Per-site entry for this host: { disabled?, scoped?, overrides? }.
  const SITE_KEY = a11ySiteKey(location.hostname);

  let settings = { ...DEFAULTS }; // effective: defaults + global + site overrides
  let globalSettings = {};        // raw global values from storage
  let siteEntry = null;
  let siteDisabled = false;
  let host, shadow;
  let orphaned = false;

  // When the extension is reloaded/updated/disabled, content scripts already
  // running in open tabs get orphaned: their chrome.* APIs are severed and any
  // call throws "Extension context invalidated." Detect that and go quiet
  // instead of spamming the console; the next fresh page load runs clean.
  function extValid() {
    return !orphaned && !!(chrome.runtime && chrome.runtime.id);
  }
  function handleOrphan() {
    if (orphaned) return;
    orphaned = true;
    try { observer && observer.disconnect(); } catch {}
    try { kbd.disable(); } catch {}
    try { voice.stop(); } catch {}
    try { screenReader.disableHover(); screenReader.stop(); } catch {}
  }

  // ─── Storage helpers ────────────────────────────────────────────────
  async function loadSettings() {
    if (!extValid()) return;
    try {
      const stored = await chrome.storage.sync.get([...STORAGE_KEYS, SITE_KEY]);
      siteEntry = stored[SITE_KEY] || null;
      delete stored[SITE_KEY];
      globalSettings = stored;
      computeEffective();
    } catch {
      handleOrphan();
    }
  }
  function computeEffective() {
    settings = {
      ...DEFAULTS,
      ...globalSettings,
      ...(siteEntry && siteEntry.scoped ? siteEntry.overrides : null),
    };
  }
  function saveSetting(key, value) {
    settings[key] = value;
    if (!extValid()) return handleOrphan();
    try {
      // Site-scoped mode routes everything except toolbar visibility (a
      // global UX choice) into this host's override entry.
      if (siteEntry?.scoped && key !== 'toolbarVisible') {
        siteEntry.overrides = { ...siteEntry.overrides, [key]: value };
        chrome.storage.sync.set({ [SITE_KEY]: siteEntry });
      } else {
        globalSettings[key] = value;
        chrome.storage.sync.set({ [key]: value });
      }
    } catch {
      handleOrphan();
    }
  }

  // ─── Style application (uses html element + !important to beat sites) ──
  const STYLE_ID = '__a11y-companion-style';
  // A stale style element can survive an extension reload (the old content
  // script is orphaned, but its DOM edits remain). Remove it before measuring
  // the page, so the base font size below is never our own override.
  document.getElementById(STYLE_ID)?.remove();
  // The site's own root font size, captured before we ever restyle. Scaling
  // multiplies this value instead of overwriting it, so sites using the
  // `html { font-size: 62.5% }` rem pattern keep their layout.
  const baseFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  function applyAllStyles() {
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    const regUrl = extValid() ? chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2') : '';
    const boldUrl = extValid() ? chrome.runtime.getURL('fonts/OpenDyslexic-Bold.woff2') : '';
    const fontFaces = settings.dyslexiaFont ? `
      @font-face {
        font-family: 'OpenDyslexic';
        src: url('${regUrl}') format('woff2');
        font-weight: normal; font-style: normal; font-display: swap;
      }
      @font-face {
        font-family: 'OpenDyslexic';
        src: url('${boldUrl}') format('woff2');
        font-weight: bold; font-style: normal; font-display: swap;
      }
    ` : '';

    // Nothing is emitted at default values — an idle extension must never
    // restyle the page.
    const fontSize = settings.fontSize !== DEFAULTS.fontSize
      ? `html { font-size: ${((baseFontPx * settings.fontSize) / 100).toFixed(2)}px !important; }`
      : '';
    // Apply spacing to inheritable parents only — letter-spacing and line-height
    // both inherit, so this avoids breaking icon fonts and flex layouts.
    const spacingProps =
      (settings.letterSpacing !== DEFAULTS.letterSpacing
        ? `letter-spacing: ${settings.letterSpacing}px !important;`
        : '') +
      (settings.lineHeight !== DEFAULTS.lineHeight
        ? ` line-height: ${settings.lineHeight} !important;`
        : '');
    const spacing = spacingProps.trim()
      ? `html, body, p, li, h1, h2, h3, h4, h5, h6, span, a, div, td, th, label, button, input, textarea { ${spacingProps} }`
      : '';
    const dyslexia = settings.dyslexiaFont
      ? `html, body, p, li, h1, h2, h3, h4, h5, h6, span, a, div, td, th, label, button, input, textarea, blockquote, figcaption {
           font-family: 'OpenDyslexic', sans-serif !important;
         }
         /* Don't override icon fonts */
         [class*="icon"], [class*="fa-"], i.fa, i.material-icons, .material-icons {
           font-family: inherit !important;
         }`
      : '';

    let colorFilter = '';
    if (settings.colorMode === 'protanopia') {
      colorFilter = `html { filter: url('#__a11y-protanopia') !important; }`;
    } else if (settings.colorMode === 'deuteranopia') {
      colorFilter = `html { filter: url('#__a11y-deuteranopia') !important; }`;
    } else if (settings.colorMode === 'tritanopia') {
      colorFilter = `html { filter: url('#__a11y-tritanopia') !important; }`;
    } else if (settings.colorMode === 'invert') {
      colorFilter = `html { filter: invert(1) hue-rotate(180deg) !important; }
                     img, video, picture, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`;
    } else if (settings.colorMode === 'high-contrast') {
      colorFilter = `
        html, body { background: #000 !important; color: #fff !important; }
        body *:not(#__a11y-companion-host):not(#__a11y-companion-host *) {
          background-color: transparent !important;
          color: #fff !important;
          border-color: #fff !important;
        }
        /* Floating UI needs a solid surface back, or menus and modals turn
           into unreadable text stacked over the page. */
        dialog, [aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"],
        [role="tooltip"], [class*="modal"], [class*="dropdown"], [class*="popover"],
        [class*="menu"], [class*="tooltip"], .__a11y-hc-surface {
          background-color: #000 !important;
        }
        a, a * { color: #00ffff !important; }
        button:not(#__a11y-companion-host *),
        input:not(#__a11y-companion-host *),
        select:not(#__a11y-companion-host *),
        textarea:not(#__a11y-companion-host *) {
          background: #222 !important; color: #fff !important; border: 1px solid #fff !important;
        }
        img, video, svg { filter: brightness(0.85) contrast(1.1) !important; }
      `;
    } else if (settings.colorMode === 'grayscale') {
      colorFilter = `html { filter: grayscale(1) !important; }`;
    }

    // Reading mode is applied imperatively (see applyReadingMode) so we only
    // emit the styling rules here. The "main" element gets a marker class.
    const readingMode = settings.readingMode
      ? `.__a11y-reading-dim { opacity: 0.08 !important; pointer-events: none !important; }
         .__a11y-reading-main, .__a11y-reading-main * {
           max-width: none !important;
         }
         .__a11y-reading-main {
           max-width: 720px !important;
           margin: 2em auto !important;
           font-size: 1.15em !important;
           line-height: 1.75 !important;
           background: #fafaf7 !important;
           color: #1a1a1a !important;
           padding: 2.5em !important;
           border-radius: 8px !important;
           box-shadow: 0 2px 20px rgba(0,0,0,0.06) !important;
           font-family: Georgia, 'Times New Roman', serif !important;
         }
         .__a11y-reading-main img { max-width: 100% !important; height: auto !important; }`
      : '';

    styleEl.textContent = fontFaces + fontSize + spacing + dyslexia + colorFilter + readingMode;
    ensureColorFilterSVG();
    applyReadingMode();
    markHcSurfaces();
  }

  // Overlays (modals, dropdown portals) usually mount within a couple of
  // levels of <body>; a computed-style pass that shallow stays cheap while
  // catching the floating UI the CSS heuristics in high-contrast mode miss.
  function markHcSurfaces() {
    if (settings.colorMode !== 'high-contrast') {
      document.querySelectorAll('.__a11y-hc-surface').forEach((el) =>
        el.classList.remove('__a11y-hc-surface')
      );
      return;
    }
    for (const el of document.querySelectorAll('body > *, body > * > *')) {
      if (el.id === '__a11y-companion-host' || el.id === '__a11y-color-filters') continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') {
        el.classList.add('__a11y-hc-surface');
      }
    }
  }

  // Reading mode: find the main content element, then walk up to <body>,
  // dimming each sibling along the way. This works on nested layouts where
  // <main> isn't a direct child of <body> (most modern sites).
  function applyReadingMode() {
    // Clean up any previous state first
    document.querySelectorAll('.__a11y-reading-dim').forEach((el) =>
      el.classList.remove('__a11y-reading-dim')
    );
    document.querySelectorAll('.__a11y-reading-main').forEach((el) =>
      el.classList.remove('__a11y-reading-main')
    );
    if (!settings.readingMode) return;

    const main =
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('article') ||
      pickLargestTextBlock();
    if (!main) return;

    main.classList.add('__a11y-reading-main');

    // Walk up to body, dimming siblings at each level
    let node = main;
    while (node && node.parentElement && node !== document.body) {
      const parent = node.parentElement;
      for (const sibling of parent.children) {
        if (
          sibling !== node &&
          sibling.id !== '__a11y-companion-host' &&
          sibling.id !== '__a11y-color-filters'
        ) {
          sibling.classList.add('__a11y-reading-dim');
        }
      }
      node = parent;
    }
  }

  // Heuristic fallback: pick the element with the most direct text content.
  function pickLargestTextBlock() {
    const candidates = document.querySelectorAll('div, section');
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const text = el.innerText || '';
      const score = text.length;
      if (score > bestScore && score > 500) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function ensureColorFilterSVG() {
    if (document.getElementById('__a11y-color-filters')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = '__a11y-color-filters';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;';
    svg.innerHTML = `
      <defs>
        <filter id="__a11y-protanopia"><feColorMatrix type="matrix" values="0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0"/></filter>
        <filter id="__a11y-deuteranopia"><feColorMatrix type="matrix" values="0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0"/></filter>
        <filter id="__a11y-tritanopia"><feColorMatrix type="matrix" values="0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0"/></filter>
      </defs>
    `;
    (document.body || document.documentElement).appendChild(svg);
  }

  // ─── Screen reader (Web Speech API) ─────────────────────────────────
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // Tags that hold their own readable text (vs. generic layout containers).
  const TEXT_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION',
    'TD', 'TH', 'DT', 'DD', 'CAPTION', 'SPAN', 'STRONG', 'EM', 'B', 'I',
    'CODE', 'PRE', 'LABEL', 'TIME', 'SMALL', 'A',
  ]);
  // Pull the most meaningful label for the element under the pointer. Climbs to
  // the nearest control/labelled ancestor so buttons read their name instead of
  // an empty inner span, and skips giant containers so we don't read a whole
  // section when the cursor is over a wrapper.
  function readableText(el) {
    if (!el || el.nodeType !== 1) return '';

    // 1. Nearest interactive control → its accessible name.
    const ctrl = el.closest(
      'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, summary'
    );
    if (ctrl) {
      const name = norm(
        ctrl.getAttribute('aria-label') ||
        ctrl.getAttribute('title') ||
        ctrl.value ||
        ctrl.innerText ||
        ctrl.textContent
      );
      if (name) return name.slice(0, 300);
    }

    // 2. Image → alt/label.
    if (el.tagName === 'IMG') return norm(el.alt || el.getAttribute('aria-label') || el.title);

    // 3. Explicit label on the element or a close ancestor.
    const labelled = el.closest('[aria-label], [title]');
    if (labelled) {
      const name = norm(labelled.getAttribute('aria-label') || labelled.getAttribute('title'));
      if (name) return name.slice(0, 300);
    }

    // 4. Text-level element → its text.
    if (TEXT_TAGS.has(el.tagName)) return norm(el.innerText || el.textContent).slice(0, 800);

    // 5. Generic container → only read if it's a short bit of text, else skip.
    const text = norm(el.innerText || el.textContent);
    return text.length <= 140 ? text : '';
  }

  const screenReader = {
    synth: window.speechSynthesis,
    hoverBound: null,
    leaveBound: null,
    lastEl: null,
    hoverTimer: null,
    speak(text, opts = {}) {
      if (!text || !this.synth) return;
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 32000));
      u.lang = opts.lang || document.documentElement.lang || 'en-US';
      u.rate = settings.speechRate || 1;
      const v = this.pickVoice();
      if (v) u.voice = v;
      this.synth.speak(u);
    },
    pickVoice() {
      if (!settings.speechVoice || !this.synth) return null;
      return this.synth.getVoices().find((v) => v.name === settings.speechVoice) || null;
    },
    readEl(el) {
      this.speak(readableText(el));
    },
    readPage() {
      const main =
        document.querySelector('main, [role="main"], article, #content, .content') ||
        document.body;
      this.speak(main.innerText || main.textContent || '');
    },
    // Announce where the user is — the page title and site. (We can't read the
    // browser's address bar, but the page knows its own URL.)
    readPageInfo() {
      const title = norm(document.title) || 'Untitled page';
      const site = location.hostname.replace(/^www\./, '');
      this.speak(site ? `${title}. ${site}` : title);
    },
    // Hover-to-read: speak whatever the pointer rests on, after a short pause.
    enableHover() {
      if (this.hoverBound) return;
      this.hoverBound = this.onHover.bind(this);
      // Cancel any pending read when the pointer leaves the page or the tab
      // loses focus, so it doesn't blurt out a section after you've moved away.
      this.leaveBound = () => { clearTimeout(this.hoverTimer); this.lastEl = null; };
      document.addEventListener('mouseover', this.hoverBound, true);
      document.documentElement.addEventListener('mouseleave', this.leaveBound);
      window.addEventListener('blur', this.leaveBound);
      document.body?.classList.add('__a11y-hover-read');
      this.speak('Screen reader on. Point at text to hear it.', { lang: 'en-US' });
    },
    disableHover() {
      if (this.hoverBound) document.removeEventListener('mouseover', this.hoverBound, true);
      if (this.leaveBound) {
        document.documentElement.removeEventListener('mouseleave', this.leaveBound);
        window.removeEventListener('blur', this.leaveBound);
      }
      this.hoverBound = null;
      this.leaveBound = null;
      this.lastEl = null;
      clearTimeout(this.hoverTimer);
      document.body?.classList.remove('__a11y-hover-read');
    },
    onHover(e) {
      const el = e.target;
      // Over our own toolbar: cancel any pending read and bail.
      if (host && host.contains(el)) { clearTimeout(this.hoverTimer); return; }
      if (!el || el === this.lastEl) return;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        this.lastEl = el;
        const text = readableText(el);
        if (text) this.speak(text);
      }, settings.hoverDelay || 400);
    },
    stop() {
      this.synth?.cancel();
    },
  };
  window.addEventListener('beforeunload', () => screenReader.stop());

  // ─── Keyboard navigation ────────────────────────────────────────────
  const kbd = {
    current: null,
    bound: null,
    focusables() {
      return Array.from(
        document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        // offsetParent is null for position:fixed elements (sticky navs, chat
        // widgets), so visibility is checked via client rects instead.
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== 'hidden' &&
          !host?.contains(el)
      );
    },
    init() {
      if (this.bound) return;
      this.bound = this.onKey.bind(this);
      document.addEventListener('keydown', this.bound, true);
      const els = this.focusables();
      if (els.length) this.focus(els[0]);
    },
    disable() {
      if (this.bound) document.removeEventListener('keydown', this.bound, true);
      this.bound = null;
      if (this.current) this.current.classList.remove('__a11y-focused');
      this.current = null;
    },
    onKey(e) {
      // Don't hijack typing inside form fields
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') this.move(1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') this.move(-1);
      else if (e.key === 'Enter' && this.current && !host?.contains(this.current)) this.current.click?.();
    },
    move(dir) {
      const els = this.focusables();
      if (!els.length) return;
      const idx = els.indexOf(this.current);
      const next = els[(idx + dir + els.length) % els.length] || els[0];
      this.focus(next);
    },
    focus(el) {
      if (!el) return;
      if (this.current) this.current.classList.remove('__a11y-focused');
      this.current = el;
      el.classList.add('__a11y-focused');
      try { el.focus({ preventScroll: true }); } catch {}
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (settings.screenReader) screenReader.readEl(el);
    },
  };

  // Helper classes (focus ring, hover-read cursor). Inert without the
  // classes; removed again when the extension is turned off for the site.
  const HELPER_STYLE_ID = '__a11y-companion-helper-style';
  document.getElementById(HELPER_STYLE_ID)?.remove(); // stale copy from an orphaned script
  function ensureHelperStyle() {
    if (document.getElementById(HELPER_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = HELPER_STYLE_ID;
    s.textContent = `
      .__a11y-focused { outline: 3px solid #ff3860 !important; outline-offset: 2px !important; }
      .__a11y-hover-read *:hover { cursor: help !important; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ─── Voice commands ─────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = {
    rec: null,
    listening: false,
    init() {
      if (!SR || this.rec) return;
      this.rec = new SR();
      this.rec.continuous = true;
      this.rec.interimResults = false;
      // Recognition language is a user setting — the page's language used to
      // drive it, which broke the (English) command set on non-English sites.
      this.rec.lang = settings.voiceLang || 'en-US';
      this.rec.onresult = (e) => {
        const transcript = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
        this.handle(transcript);
      };
      this.rec.onerror = (e) => {
        console.warn('[a11y] voice error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          saveSetting('voiceInput', false);
          updateUI();
        }
      };
      this.rec.onend = () => {
        this.listening = false;
        // Don't auto-restart the mic on a site the user just turned us off on.
        if (settings.voiceInput && !siteDisabled) {
          try { this.rec.start(); this.listening = true; } catch {}
        }
      };
    },
    start() {
      this.init();
      if (!this.rec || this.listening) return;
      try { this.rec.start(); this.listening = true; } catch {}
    },
    stop() {
      if (this.rec && this.listening) {
        try { this.rec.stop(); } catch {}
      }
      this.listening = false;
    },
    handle(t) {
      console.log('[a11y] heard:', t);
      // "click <something>" — find a link/button whose text matches and click it
      const clickMatch = t.match(/^(?:click|press|tap|open) (.+)$/);
      if (clickMatch) return this.clickByText(clickMatch[1]);

      // Whole-word matching so e.g. "unexpected" can't trigger "next"; the
      // shortest commands additionally require the utterance to be exactly
      // that word, since they occur inside too many ordinary sentences.
      const cmd = (sub, fn) => new RegExp(`\\b${sub}\\b`).test(t) && (fn(), true);
      const exact = (word, fn) => t === word && (fn(), true);
      cmd('scroll down', () => window.scrollBy(0, 400)) ||
      cmd('scroll up', () => window.scrollBy(0, -400)) ||
      cmd('top of page', () => window.scrollTo(0, 0)) ||
      cmd('bottom of page', () => window.scrollTo(0, document.body.scrollHeight)) ||
      cmd('go back', () => history.back()) ||
      cmd('go forward', () => history.forward()) ||
      cmd('reload', () => location.reload()) ||
      cmd('where am i', () => screenReader.readPageInfo()) ||
      cmd('page info', () => screenReader.readPageInfo()) ||
      cmd('read url', () => screenReader.readPageInfo()) ||
      cmd('read page', () => screenReader.readPage()) ||
      cmd('stop reading', () => screenReader.stop()) ||
      cmd('bigger text', () => actions.fontSize(10)) ||
      cmd('smaller text', () => actions.fontSize(-10)) ||
      cmd('reading mode', () => actions.toggle('readingMode')) ||
      cmd('dark mode', () => actions.setColor('invert')) ||
      cmd('high contrast', () => actions.setColor('high-contrast')) ||
      cmd('default colors', () => actions.setColor('default')) ||
      exact('next', () => kbd.move(1)) ||
      exact('previous', () => kbd.move(-1));
    },
    clickByText(query) {
      const q = query.toLowerCase().trim();
      const candidates = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"]');
      let best = null;
      for (const el of candidates) {
        if (host?.contains(el)) continue;
        const label = (
          el.getAttribute('aria-label') ||
          el.innerText ||
          el.value ||
          el.title ||
          ''
        ).toLowerCase().trim();
        if (!label) continue;
        if (label === q) { best = el; break; }
        if (!best && label.includes(q)) best = el;
      }
      if (best) {
        best.scrollIntoView({ behavior: 'smooth', block: 'center' });
        best.click();
      } else {
        screenReader.speak(`Could not find ${query}`, { lang: 'en-US' });
      }
    },
  };

  // ─── Actions ────────────────────────────────────────────────────────
  const actions = {
    fontSize(delta) {
      const next = Math.max(80, Math.min(200, settings.fontSize + delta));
      saveSetting('fontSize', next);
      applyAllStyles();
      updateUI();
    },
    spacing(delta) {
      // Round so stepping back down lands exactly on the defaults again
      // (1.6 - 0.1 is not 1.5 in floating point).
      saveSetting('letterSpacing', Math.round(Math.max(0, settings.letterSpacing + delta * 0.5) * 100) / 100);
      saveSetting('lineHeight', Math.round(Math.max(1, settings.lineHeight + delta * 0.1) * 100) / 100);
      applyAllStyles();
    },
    toggle(key) {
      saveSetting(key, !settings[key]);
      syncFeatureState();
      applyAllStyles();
      updateUI();
    },
    setColor(mode) {
      saveSetting('colorMode', mode);
      applyAllStyles();
    },
    reset() {
      Object.entries(DEFAULTS).forEach(([k, v]) => saveSetting(k, v));
      syncFeatureState();
      screenReader.stop();
      applyAllStyles();
      updateUI();
    },
  };

  // Bring long-lived features in line with the effective settings. Changes
  // arrive from our own toolbar, the popup, the options page, keyboard
  // commands, and other synced devices — this is the single reconciler.
  function syncFeatureState() {
    if (settings.keyboardNav && !kbd.bound) kbd.init();
    if (!settings.keyboardNav && kbd.bound) kbd.disable();
    if (settings.voiceInput) voice.start();
    else voice.stop();
    if (settings.screenReader && !screenReader.hoverBound) screenReader.enableHover();
    if (!settings.screenReader && screenReader.hoverBound) {
      screenReader.disableHover();
      screenReader.stop();
    }
  }

  // ─── Toolbar UI (Shadow DOM, isolated from page CSS) ────────────────
  function buildToolbar() {
    ensureHelperStyle();
    if (host) return;
    host = document.createElement('div');
    host.id = '__a11y-companion-host';
    host.style.cssText = 'all: initial; position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          font-family: -apple-system, system-ui, sans-serif;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          max-width: calc(100vw - 32px);
          background: rgba(255,255,255,0.92);
          backdrop-filter: saturate(1.4) blur(12px);
          -webkit-backdrop-filter: saturate(1.4) blur(12px);
          color: #0f172a;
          border: 1px solid rgba(15,23,42,0.08);
          border-radius: 16px;
          box-shadow: 0 12px 40px rgba(15,23,42,0.22);
          padding: 8px 10px;
          font-size: 13px;
        }
        .brand {
          font-size: 18px;
          line-height: 1;
          padding: 0 4px;
          cursor: default;
          user-select: none;
        }
        .group { display: flex; align-items: center; gap: 4px; }
        .divider { width: 1px; align-self: stretch; background: rgba(15,23,42,0.1); margin: 2px 2px; }
        button.chip {
          all: unset;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 38px;
          height: 38px;
          padding: 0 9px;
          background: #f1f5f9;
          border-radius: 10px;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          transition: background .15s, transform .05s;
        }
        button.chip:hover { background: #e2e8f0; }
        button.chip:active { transform: scale(0.94); }
        button.chip:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
        button.chip.label { font-size: 13px; font-weight: 600; }
        button.chip[aria-pressed="true"] { background: #2563eb; color: #fff; }
        button.chip.feat {
          flex-direction: column;
          gap: 2px;
          min-width: 48px;
          height: 44px;
          padding: 4px 8px;
          font-size: 15px;
        }
        .chip.feat .lbl {
          font-size: 9px; font-weight: 600; line-height: 1;
          letter-spacing: .2px; opacity: .7;
        }
        .chip.feat[aria-pressed="true"] .lbl { opacity: 1; }
        #fontval {
          min-width: 46px; font-size: 12px; font-weight: 600;
          color: #475569; cursor: default; background: transparent;
        }
        #fontval:hover { background: transparent; }
        select {
          height: 38px; padding: 0 8px; border-radius: 10px;
          border: 1px solid #cbd5e1; background: #fff; font-size: 12px;
          color: #0f172a; cursor: pointer;
        }
        .close, .reset {
          all: unset; box-sizing: border-box;
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 38px; border-radius: 10px;
          cursor: pointer; font-size: 16px; color: #64748b;
        }
        .close:hover { background: #f1f5f9; }
        .reset:hover { background: #fee2e2; color: #dc2626; }
        .fab {
          width: 48px; height: 48px; border-radius: 50%;
          background: #2563eb; color: #fff; border: none;
          font-size: 22px; cursor: pointer;
          box-shadow: 0 6px 20px rgba(37,99,235,0.4);
        }
        .hidden { display: none; }
      </style>
      <div class="panel" id="panel" role="toolbar" aria-label="A11y Companion">
        <span class="brand" title="A11y Companion">♿</span>

        <div class="group" aria-label="Text size">
          <button class="chip label" data-act="font-" title="Smaller text" aria-label="Smaller text">A−</button>
          <span id="fontval" title="Current text size">100%</span>
          <button class="chip label" data-act="font+" title="Bigger text" aria-label="Bigger text">A+</button>
        </div>

        <div class="divider"></div>

        <div class="group" aria-label="Spacing">
          <button class="chip label" data-act="space-" title="Less spacing" aria-label="Less spacing">⇿−</button>
          <button class="chip label" data-act="space+" title="More spacing" aria-label="More spacing">⇿+</button>
        </div>

        <div class="divider"></div>

        <div class="group">
          <button class="chip feat" id="t-dyslexiaFont" title="Dyslexia-friendly font" aria-label="Dyslexia-friendly font">
            <span class="ico" style="font-weight:700;">Aa</span><span class="lbl">Font</span>
          </button>
          <button class="chip feat" id="t-readingMode" title="Reading mode" aria-label="Reading mode">
            <span class="ico">📖</span><span class="lbl">Read</span>
          </button>
          <button class="chip feat" id="t-keyboardNav" title="Keyboard navigation" aria-label="Keyboard navigation">
            <span class="ico">⌨️</span><span class="lbl">Keys</span>
          </button>
          <button class="chip feat" id="t-screenReader" title="Screen reader (hover to read)" aria-label="Screen reader, hover to read">
            <span class="ico">🔊</span><span class="lbl">Speak</span>
          </button>
          <button class="chip feat" id="t-voiceInput" title="Voice commands" aria-label="Voice commands">
            <span class="ico">🎤</span><span class="lbl">Voice</span>
          </button>
          <button class="chip feat" id="pageInfo" title="Read page title and URL" aria-label="Read page title and address">
            <span class="ico">ℹ️</span><span class="lbl">Page</span>
          </button>
        </div>

        <div class="divider"></div>

        <select id="colorMode" title="Color mode" aria-label="Color mode">
          <option value="default">🎨 Default</option>
          <option value="grayscale">Grayscale</option>
          <option value="invert">Invert / Dark</option>
          <option value="high-contrast">High contrast</option>
          <option value="protanopia">Protanopia</option>
          <option value="deuteranopia">Deuteranopia</option>
          <option value="tritanopia">Tritanopia</option>
        </select>

        <div class="divider"></div>

        <button class="reset" id="reset" title="Reset all" aria-label="Reset all settings">↺</button>
        <button class="close" id="close" title="Hide toolbar" aria-label="Hide toolbar">×</button>
      </div>
      <button class="fab hidden" id="fab" aria-label="Show accessibility toolbar">♿</button>
    `;
    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);

    $('#close').onclick = () => { saveSetting('toolbarVisible', false); updateUI(); };
    $('#fab').onclick = () => { saveSetting('toolbarVisible', true); updateUI(); };
    $('#reset').onclick = () => actions.reset();

    shadow.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'font+') actions.fontSize(10);
        if (a === 'font-') actions.fontSize(-10);
        if (a === 'space+') actions.spacing(1);
        if (a === 'space-') actions.spacing(-1);
      };
    });

    ['dyslexiaFont', 'readingMode', 'keyboardNav', 'screenReader', 'voiceInput'].forEach((k) => {
      $('#t-' + k).onclick = () => actions.toggle(k);
    });

    $('#pageInfo').onclick = () => screenReader.readPageInfo();

    $('#colorMode').onchange = (e) => actions.setColor(e.target.value);
  }

  function updateUI() {
    if (!shadow) return;
    const $ = (s) => shadow.querySelector(s);
    $('#panel').classList.toggle('hidden', !settings.toolbarVisible);
    $('#fab').classList.toggle('hidden', settings.toolbarVisible);
    $('#fontval').textContent = settings.fontSize + '%';
    $('#colorMode').value = settings.colorMode;
    ['dyslexiaFont', 'readingMode', 'keyboardNav', 'screenReader', 'voiceInput'].forEach((k) => {
      $('#t-' + k).setAttribute('aria-pressed', String(!!settings[k]));
    });
  }

  // ─── Init & live sync ───────────────────────────────────────────────
  async function init() {
    await loadSettings();
    siteDisabled = !!(siteEntry && siteEntry.disabled);
    if (siteDisabled) return; // the storage listener below handles re-enabling
    buildToolbar();
    applyAllStyles();
    updateUI();
    syncFeatureState();
  }

  // Tear everything out of the page when the user turns the extension off
  // for this site, or rebuild after a re-enable.
  function applyEnabledState() {
    const wantDisabled = !!(siteEntry && siteEntry.disabled);
    if (wantDisabled === siteDisabled) return;
    siteDisabled = wantDisabled;
    if (wantDisabled) {
      kbd.disable();
      voice.stop();
      screenReader.disableHover();
      screenReader.stop();
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(HELPER_STYLE_ID)?.remove();
      document
        .querySelectorAll('.__a11y-hc-surface, .__a11y-reading-dim, .__a11y-reading-main, .__a11y-focused')
        .forEach((el) =>
          el.classList.remove('__a11y-hc-surface', '__a11y-reading-dim', '__a11y-reading-main', '__a11y-focused')
        );
      host?.remove();
      host = null;
      shadow = null;
    } else {
      buildToolbar();
      applyAllStyles();
      updateUI();
      syncFeatureState();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let touched = false;
    for (const [k, c] of Object.entries(changes)) {
      if (k === SITE_KEY) {
        siteEntry = c.newValue || null;
        touched = true;
      } else if (STORAGE_KEYS.includes(k)) {
        if (c.newValue === undefined) delete globalSettings[k];
        else globalSettings[k] = c.newValue;
        touched = true;
      }
    }
    if (!touched) return;
    computeEffective();
    applyEnabledState();
    if (siteDisabled) return;
    buildToolbar(); // first enable on a tab that loaded while disabled
    applyAllStyles();
    updateUI();
    syncFeatureState();
  });

  // SPA support:
  // 1. Re-inject toolbar if removed by client routing
  // 2. Re-apply reading mode on DOM mutations (debounced)
  // 3. Re-apply on URL change (history pushState/replaceState)
  let readingDebounce, hcDebounce;
  const observer = new MutationObserver(() => {
    if (siteDisabled) return;
    if (host && !document.documentElement.contains(host)) {
      document.documentElement.appendChild(host);
    }
    if (settings.readingMode) {
      clearTimeout(readingDebounce);
      readingDebounce = setTimeout(applyReadingMode, 400);
    }
    if (settings.colorMode === 'high-contrast') {
      clearTimeout(hcDebounce);
      hcDebounce = setTimeout(markHcSurfaces, 400);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Patch history APIs to detect SPA navigation
  const fireUrlChange = () => {
    setTimeout(() => {
      if (settings.readingMode) applyReadingMode();
      if (settings.keyboardNav) {
        const els = kbd.focusables();
        if (els.length && !els.includes(kbd.current)) kbd.focus(els[0]);
      }
    }, 500);
  };
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      fireUrlChange();
      return r;
    };
  });
  window.addEventListener('popstate', fireUrlChange);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
