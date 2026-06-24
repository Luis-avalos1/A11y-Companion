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
    try { attachObserver && attachObserver.disconnect(); } catch {}
    try { featureObserver && featureObserver.disconnect(); } catch {}
    try { kbd.disable(); } catch {}
    try { voice.stop(); } catch {}
    try { screenReader.disableHover(); screenReader.stop(); } catch {}
    try { reader.stop(); } catch {}
    try { ruler.disable(); } catch {}
    try { unwatchBaseFont(); } catch {}
  }
  function isContextError(err) {
    return /context invalidated|Extension context/i.test(err?.message || String(err));
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

  // Keys this tab just wrote, so its own echoed storage.onChanged events don't
  // trigger a redundant full re-apply (the action already applied them).
  const selfWrites = new Set();
  function noteSelfWrite(keys) {
    for (const k of keys) {
      selfWrites.add(k);
      // Self-heal: chrome.storage.sync.set does NOT emit onChanged when the
      // value is byte-identical, so a no-op write (e.g. clamped font step, or
      // reset while already at defaults) would leave this flag stuck and wrongly
      // suppress a LATER external change to the same key. Drop it after a beat
      // if the echo never arrives — same-tab echoes land in well under a second.
      setTimeout(() => selfWrites.delete(k), 2000);
    }
  }
  // chrome.storage write failed (quota/rate throttle) — don't let in-memory
  // state silently diverge from storage; pull the authoritative copy and
  // re-apply. Context-invalidation errors mean we've been orphaned.
  function onWriteError(err) {
    if (isContextError(err)) return handleOrphan();
    console.warn('[a11y] settings write failed; resyncing:', err?.message || err);
    if (extValid()) {
      loadSettings().then(() => {
        if (!siteDisabled) { applyAllStyles(); updateUI(); syncFeatureState(); }
      });
    }
  }
  function persistGlobal(patch) {
    if (!extValid()) return handleOrphan();
    try {
      noteSelfWrite(Object.keys(patch));
      const p = chrome.storage.sync.set(patch);
      if (p && p.catch) p.catch(onWriteError);
    } catch (err) {
      if (isContextError(err)) handleOrphan();
      else onWriteError(err);
    }
  }

  // Scoped per-site writes are serialized and re-read storage before writing,
  // so two writers (this tab, another tab, another device) changing different
  // override keys don't clobber each other with a stale full snapshot.
  let scopedWriteChain = Promise.resolve();
  function persistScoped(overridePatch) {
    scopedWriteChain = scopedWriteChain.then(async () => {
      if (!extValid()) return;
      let fresh;
      try {
        fresh = (await chrome.storage.sync.get(SITE_KEY))[SITE_KEY];
      } catch (err) {
        return isContextError(err) ? handleOrphan() : onWriteError(err);
      }
      if (!extValid()) return;
      fresh = fresh || siteEntry || {};
      fresh.overrides = { ...fresh.overrides, ...overridePatch };
      siteEntry = fresh;
      computeEffective();
      try {
        noteSelfWrite([SITE_KEY]);
        await chrome.storage.sync.set({ [SITE_KEY]: fresh });
      } catch (err) {
        onWriteError(err);
      }
    });
    return scopedWriteChain;
  }

  // Apply one or more settings at once. The in-memory effective value updates
  // synchronously (instant UI); persistence is routed to the global keys or, in
  // site-scoped mode, this host's override entry. Toolbar visibility is a global
  // UX choice and always stays global.
  function saveSettings(patch) {
    Object.assign(settings, patch);
    if (!extValid()) return handleOrphan();
    const scoped = siteEntry && siteEntry.scoped;
    const overridePatch = {};
    const globalPatch = {};
    for (const [k, v] of Object.entries(patch)) {
      // Skip writes that wouldn't change storage — they save quota and, crucially,
      // never produce an onChanged echo (so flagging them would leak; see
      // noteSelfWrite).
      if (scoped && k !== 'toolbarVisible') {
        if (!siteEntry.overrides || siteEntry.overrides[k] !== v) overridePatch[k] = v;
      } else if (globalSettings[k] !== v) {
        globalSettings[k] = v;
        globalPatch[k] = v;
      }
    }
    if (Object.keys(globalPatch).length) persistGlobal(globalPatch);
    if (Object.keys(overridePatch).length) persistScoped(overridePatch);
  }
  function saveSetting(key, value) {
    saveSettings({ [key]: value });
  }

  // ─── Reduce-motion (manual setting OR the OS preference) ─────────────
  let reduceMotionMQ = null;
  function prefersReducedMotion() {
    if (!reduceMotionMQ) {
      try {
        reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
        reduceMotionMQ.addEventListener?.('change', () => {
          if (siteDisabled) return;
          applyAllStyles();
          syncFeatureState();
        });
      } catch { reduceMotionMQ = { matches: false }; }
    }
    return !!reduceMotionMQ.matches;
  }
  function effectiveReduceMotion() {
    return !!settings.reduceMotion || prefersReducedMotion();
  }

  // ─── Style application (uses html element + !important to beat sites) ──
  const STYLE_ID = '__a11y-companion-style';
  // A stale style element can survive an extension reload (the old content
  // script is orphaned, but its DOM edits remain). Remove it before measuring
  // the page, so the base font size below is never our own override.
  document.getElementById(STYLE_ID)?.remove();
  // The site's own root font size, captured before we ever restyle. Scaling
  // multiplies this value instead of overwriting it, so sites using the
  // `html { font-size: 62.5% }` rem pattern keep their layout. Recomputed when
  // the viewport changes (responsive root font-size) — see watchBaseFont.
  let baseFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  let baseFontResizeBound = null, baseFontResizeTimer = null;
  function watchBaseFont() {
    if (baseFontResizeBound) return;
    baseFontResizeBound = () => {
      clearTimeout(baseFontResizeTimer);
      baseFontResizeTimer = setTimeout(() => {
        if (orphaned || settings.fontSize === DEFAULTS.fontSize) return;
        const styleEl = document.getElementById(STYLE_ID);
        if (!styleEl) return;
        // Measure the site's responsive root size with our override removed.
        const prev = styleEl.textContent;
        styleEl.textContent = '';
        const measured = parseFloat(getComputedStyle(document.documentElement).fontSize) || baseFontPx;
        styleEl.textContent = prev;
        if (measured > 0 && Math.abs(measured - baseFontPx) > 0.5) {
          baseFontPx = measured;
          applyAllStyles();
        }
      }, 250);
    };
    window.addEventListener('resize', baseFontResizeBound, { passive: true });
  }
  function unwatchBaseFont() {
    if (baseFontResizeBound) window.removeEventListener('resize', baseFontResizeBound);
    baseFontResizeBound = null;
    clearTimeout(baseFontResizeTimer);
  }

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
    // Reset letter-spacing on icon/ligature fonts so spacing doesn't gap their
    // glyphs (mirrors the dyslexia-font icon exclusion below).
    const spacing = spacingProps.trim()
      ? `html, body, p, li, h1, h2, h3, h4, h5, h6, span, a, div, td, th, label, button, input, textarea { ${spacingProps} }
         [class*="icon"], [class*="fa-"], i.fa, i.material-icons, .material-icons, [class*="glyph"] { letter-spacing: normal !important; }`
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

    // Color modes filter <body> (not <html>) so the cascade never reaches our
    // toolbar host, which is a child of <html> and a sibling of <body>. A CSS
    // filter cannot be undone by descendants, so html-scoped filters used to
    // tint/invert the toolbar itself.
    let colorFilter = '';
    if (settings.colorMode === 'protanopia') {
      colorFilter = `body { filter: url('#__a11y-protanopia') !important; }`;
    } else if (settings.colorMode === 'deuteranopia') {
      colorFilter = `body { filter: url('#__a11y-deuteranopia') !important; }`;
    } else if (settings.colorMode === 'tritanopia') {
      colorFilter = `body { filter: url('#__a11y-tritanopia') !important; }`;
    } else if (settings.colorMode === 'invert') {
      // Mirror a dark backdrop onto <html> so short pages don't show an
      // unfiltered (bright) gutter below the inverted body.
      colorFilter = `html { background-color: #0a0a0a !important; }
                     body { filter: invert(1) hue-rotate(180deg) !important; }
                     img, video, picture, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`;
    } else if (settings.colorMode === 'high-contrast') {
      // Solid #000 on every element (not `transparent`) so layered backgrounds
      // and floating menus/modals stay opaque and readable instead of letting
      // page/image layers bleed through the white text. Low-specificity rules
      // (no :not id padding) so the targeted link/control rules below win by
      // source order. The toolbar host is outside <body>, so `body *` skips it.
      colorFilter = `
        html, body { background-color: #000 !important; color: #fff !important; }
        body * { background-color: #000 !important; color: #fff !important; border-color: #fff !important; }
        body a, body a * { color: #00ffff !important; }
        body button, body input, body select, body textarea {
          background-color: #222 !important; color: #fff !important; border: 1px solid #fff !important;
        }
        body img, body video, body svg { filter: brightness(0.85) contrast(1.1) !important; }
      `;
    } else if (settings.colorMode === 'grayscale') {
      colorFilter = `body { filter: grayscale(1) !important; }`;
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

    // Freeze CSS animations/transitions without breaking sites that wait for
    // animationend (near-zero duration instead of none). Honors the OS
    // prefers-reduced-motion preference in addition to the manual toggle.
    const motion = effectiveReduceMotion()
      ? `*, *::before, *::after {
           animation-duration: 0.001s !important;
           animation-iteration-count: 1 !important;
           transition-duration: 0.001s !important;
           scroll-behavior: auto !important;
         }`
      : '';

    const css = fontFaces + fontSize + spacing + dyslexia + colorFilter + readingMode + motion;
    // Skip the re-parse + full-document style recalc when the CSS is unchanged
    // (e.g. a non-visual setting changed, or our own storage echo re-ran this).
    if (styleEl.textContent !== css) styleEl.textContent = css;

    // Side effects reconcile live DOM state — always run them.
    ensureColorFilterSVG();
    applyReadingMode();
    pauseAutoplayMedia();
    if (settings.fontSize !== DEFAULTS.fontSize) watchBaseFont();
  }

  // Reading mode: find the main content element, then walk up to <body>,
  // dimming each sibling along the way. This works on nested layouts where
  // <main> isn't a direct child of <body> (most modern sites).
  let readingApplied = false;
  // Siblings that must stay interactive even when dimming the page: fixed/sticky
  // chrome and dialogs (cookie walls, modals). Dimming them with
  // pointer-events:none would trap the user.
  const READING_KEEP = 'dialog, [aria-modal="true"], [role="dialog"], [role="alertdialog"]';
  function applyReadingMode() {
    // Only pay for the whole-document cleanup scans when reading mode is (or
    // just was) active — users who never enable it shouldn't trigger them.
    if (settings.readingMode || readingApplied) {
      document.querySelectorAll('.__a11y-reading-dim').forEach((el) =>
        el.classList.remove('__a11y-reading-dim')
      );
      document.querySelectorAll('.__a11y-reading-main').forEach((el) =>
        el.classList.remove('__a11y-reading-main')
      );
    }
    if (!settings.readingMode) { readingApplied = false; return; }

    const main =
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('article') ||
      pickLargestTextBlock();
    if (!main) { readingApplied = false; return; }

    main.classList.add('__a11y-reading-main');

    // Walk up to body, dimming siblings at each level
    let node = main;
    while (node && node.parentElement && node !== document.body) {
      const parent = node.parentElement;
      for (const sibling of parent.children) {
        if (sibling === node) continue;
        if (
          sibling.id === '__a11y-companion-host' ||
          sibling.id === '__a11y-color-filters' ||
          sibling.id === '__a11y-companion-ruler'
        ) continue;
        // Never dim/disable fixed or sticky chrome or dialogs — that blocks
        // cookie banners and modals the user needs to dismiss.
        const pos = getComputedStyle(sibling).position;
        if (pos === 'fixed' || pos === 'sticky') continue;
        if (sibling.matches && sibling.matches(READING_KEEP)) continue;
        sibling.classList.add('__a11y-reading-dim');
      }
      node = parent;
    }
    readingApplied = true;
  }

  // Heuristic fallback: pick the element with the most direct text content.
  // Uses textContent.length (no layout flush) as a cheap pre-filter, only
  // gating on getClientRects() for the candidates that pass, and bails on
  // pathological DOMs instead of reading innerText for every div/section.
  function pickLargestTextBlock() {
    const candidates = document.querySelectorAll('div, section, article');
    if (candidates.length > 6000) return null; // too big to scan safely
    let best = null;
    let bestScore = 500; // require at least this many chars
    for (const el of candidates) {
      const len = (el.textContent || '').length;
      if (len <= bestScore) continue;
      if (!el.getClientRects().length) continue; // skip hidden/offscreen
      bestScore = len;
      best = el;
    }
    return best;
  }

  function ensureColorFilterSVG() {
    if (document.getElementById('__a11y-color-filters')) return;
    if (!document.body && !document.documentElement) return;
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
  const READ_MAX = 300; // cap a single hover/label utterance
  // Pull the most meaningful label for the element under the pointer. Prefers
  // the element's OWN name/text before climbing to an ancestor landmark, so
  // hovering text inside <section aria-label="Comments"> reads the text, not
  // "Comments".
  function readableText(el) {
    if (!el || el.nodeType !== 1) return '';

    // 1. Nearest interactive control → its accessible name. textContent (not
    //    innerText) so visually-hidden labels on icon buttons are captured.
    const ctrl = el.closest(
      'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, summary'
    );
    if (ctrl) {
      const name = norm(
        ctrl.getAttribute('aria-label') ||
        ctrl.getAttribute('title') ||
        ctrl.value ||
        ctrl.textContent
      );
      if (name) return name.slice(0, READ_MAX);
    }

    // 2. Image → alt/label.
    if (el.tagName === 'IMG') return norm(el.alt || el.getAttribute('aria-label') || el.title);

    // 3. The element's OWN explicit label.
    const ownLabel = norm((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '');
    if (ownLabel) return ownLabel.slice(0, READ_MAX);

    // 4. Text-level element → its text.
    if (TEXT_TAGS.has(el.tagName)) return norm(el.innerText || el.textContent).slice(0, READ_MAX);

    // 5. A close labelled ancestor (landmark, labelled wrapper).
    const labelled = el.closest('[aria-label], [title]');
    if (labelled) {
      const name = norm(labelled.getAttribute('aria-label') || labelled.getAttribute('title'));
      if (name) return name.slice(0, READ_MAX);
    }

    // 6. Generic container → only read if it's a short bit of text, else skip.
    const text = norm(el.innerText || el.textContent);
    return text.length <= 140 ? text : '';
  }

  const screenReader = {
    synth: window.speechSynthesis,
    hoverBound: null,
    leaveBound: null,
    lastText: null,
    hoverTimer: null,
    speak(text, opts = {}) {
      if (!text || !this.synth) return;
      if (reader.active) reader.stop(); // hover/feedback speech takes over
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
      reader.start();
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
      this.leaveBound = () => { clearTimeout(this.hoverTimer); this.lastText = null; };
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
      this.lastText = null;
      clearTimeout(this.hoverTimer);
      document.body?.classList.remove('__a11y-hover-read');
    },
    onHover(e) {
      const el = e.target;
      // Over our own toolbar: cancel any pending read and bail.
      if (host && host.contains(el)) { clearTimeout(this.hoverTimer); return; }
      if (!el) return;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        const text = readableText(el);
        // Dedupe by the resolved phrase, not node identity, so sweeping across
        // child nodes that resolve to the same label doesn't stutter.
        if (text && text !== this.lastText) {
          this.lastText = text;
          this.speak(text);
        }
      }, settings.hoverDelay || 400);
    },
    stop() {
      this.synth?.cancel();
    },
  };
  window.addEventListener('beforeunload', () => screenReader.stop());

  // ─── Read page aloud (chunked queue with controls) ───────────────────
  // Chrome's speech synthesis stalls on long utterances (notoriously around
  // 15 seconds with network voices), so pages are read in sentence-sized
  // chunks. That also gives us pause/resume/skip and a moving highlight.
  function splitChunks(text, max = 220) {
    const out = [];
    let cur = '';
    for (const s of text.split(/(?<=[.!?…])\s+/)) {
      if (s.length > max) {
        if (cur) { out.push(cur); cur = ''; }
        for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      } else if ((cur ? cur.length + 1 : 0) + s.length > max) {
        if (cur) out.push(cur);
        cur = s;
      } else {
        cur = cur ? cur + ' ' + s : s;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  const READ_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, dt, dd, pre, td, th';
  const READ_BLOCK_CAP = 2000; // don't build an unbounded queue on huge docs

  const reader = {
    queue: [],
    idx: -1,
    active: false,
    paused: false,
    endedWhilePaused: false,
    utter: null,
    hl: null,
    // Collect readable blocks from the main content area; fall back to
    // sentence-grouping the page's plain text when there's no structure.
    collect() {
      const root =
        document.querySelector('main, [role="main"], article, #content, .content') ||
        document.body;
      if (!root) return [];
      const blocks = [];
      for (const el of root.querySelectorAll(READ_BLOCKS)) {
        if (host?.contains(el)) continue;
        const anc = el.parentElement?.closest(READ_BLOCKS);
        if (anc && root.contains(anc)) continue; // an ancestor block already covers this text
        if (!el.getClientRects().length) continue;
        // textContent avoids the per-element forced reflow that innerText causes;
        // getClientRects() above already filtered non-rendered blocks.
        const text = norm(el.textContent);
        if (text) blocks.push({ el, text });
        if (blocks.length >= READ_BLOCK_CAP) break;
      }
      if (blocks.length) {
        return blocks.flatMap((b) => splitChunks(b.text).map((text) => ({ el: b.el, text })));
      }
      return splitChunks(norm(root.innerText || '')).map((text) => ({ el: null, text }));
    },
    start(plainText) {
      this.stop();
      this.queue = plainText
        ? splitChunks(norm(plainText)).map((text) => ({ el: null, text }))
        : this.collect();
      if (!this.queue.length) {
        return screenReader.speak('Nothing to read on this page.', { lang: 'en-US' });
      }
      this.active = true;
      this.paused = false;
      this.endedWhilePaused = false;
      this.speakAt(0);
      updateReadUI();
    },
    speakAt(i) {
      if (!this.active) return;
      if (i >= this.queue.length) return this.stop();
      this.idx = Math.max(0, i);
      const item = this.queue[this.idx];
      this.highlight(item.el);
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = document.documentElement.lang || 'en-US';
      u.rate = settings.speechRate || 1;
      const v = screenReader.pickVoice();
      if (v) u.voice = v;
      this.utter = u;
      // cancel() fires end/error for the in-flight utterance too — only the
      // utterance that is still current may advance the queue. If a chunk ends
      // while paused (some platforms let pause() finish the in-flight chunk),
      // remember it so resume continues to the NEXT chunk instead of re-reading.
      const advance = () => {
        if (this.utter !== u) return;
        if (this.paused) { this.endedWhilePaused = true; return; }
        if (this.active) this.speakAt(this.idx + 1);
      };
      u.onend = advance;
      u.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') advance();
      };
      screenReader.synth.cancel();
      screenReader.synth.speak(u);
    },
    pauseToggle() {
      if (!this.active) return;
      if (!this.paused) {
        this.paused = true;
        try { screenReader.synth.pause(); } catch {}
      } else {
        this.paused = false;
        if (this.endedWhilePaused) {
          // The chunk finished while paused — advance rather than re-read it.
          this.endedWhilePaused = false;
          this.speakAt(this.idx + 1);
        } else if (screenReader.synth.speaking) {
          try { screenReader.synth.resume(); } catch {}
        } else {
          this.speakAt(this.idx);
        }
      }
      updateReadUI();
    },
    skip(dir) {
      if (!this.active) return;
      this.paused = false;
      this.endedWhilePaused = false;
      try { screenReader.synth.resume(); } catch {}
      this.speakAt(this.idx + dir);
      updateReadUI();
    },
    stop() {
      const wasActive = this.active;
      this.active = false;
      this.paused = false;
      this.endedWhilePaused = false;
      this.utter = null;
      this.highlight(null);
      this.queue = [];
      this.idx = -1;
      try { screenReader.synth.resume(); } catch {}
      try { screenReader.synth.cancel(); } catch {}
      if (wasActive) updateReadUI();
    },
    highlight(el) {
      this.hl?.classList.remove('__a11y-reading-now');
      this.hl = el || null;
      if (el) {
        el.classList.add('__a11y-reading-now');
        try {
          el.scrollIntoView({ block: 'center', behavior: effectiveReduceMotion() ? 'auto' : 'smooth' });
        } catch {}
      }
    },
  };

  // ─── Reading ruler (line-focus band that follows the pointer) ────────
  const RULER_ID = '__a11y-companion-ruler';
  document.getElementById(RULER_ID)?.remove(); // stale copy from an orphaned script
  const ruler = {
    el: null,
    moveBound: null,
    leaveBound: null,
    raf: 0,
    lastY: null,
    sync() {
      if (settings.ruler && !siteDisabled) this.enable();
      else this.disable();
    },
    enable() {
      const h = settings.rulerHeight || 80;
      if (this.el) {
        this.el.style.height = h + 'px';
        return;
      }
      this.el = document.createElement('div');
      this.el.id = RULER_ID;
      // The huge box-shadow dims everything except a transparent band.
      this.el.style.cssText =
        'all: initial; position: fixed; left: 0; right: 0; top: -9999px;' +
        'height: ' + h + 'px; pointer-events: none; z-index: 2147483646;' +
        'box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42);' +
        'border-top: 1px solid rgba(255,255,255,0.35); border-bottom: 1px solid rgba(255,255,255,0.35);';
      // Throttle to one position update per frame, and use the known band height
      // instead of reading offsetHeight (a forced layout flush) every move.
      const update = () => {
        this.raf = 0;
        if (!this.el || this.lastY == null) return;
        this.el.style.top = (this.lastY - (settings.rulerHeight || 80) / 2) + 'px';
      };
      this.moveBound = (e) => {
        if (!this.el) return;
        // Park the band offscreen while the pointer is over our own toolbar.
        if (host && (e.target === host || host.contains(e.target))) {
          this.el.style.top = '-9999px';
          this.lastY = null;
          return;
        }
        this.lastY = e.clientY;
        if (!this.raf) this.raf = requestAnimationFrame(update);
      };
      this.leaveBound = () => {
        if (this.el) this.el.style.top = '-9999px';
        this.lastY = null;
      };
      document.addEventListener('mousemove', this.moveBound, { passive: true });
      document.documentElement.addEventListener('mouseleave', this.leaveBound);
      document.documentElement.appendChild(this.el);
    },
    disable() {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      if (this.moveBound) document.removeEventListener('mousemove', this.moveBound);
      if (this.leaveBound) document.documentElement.removeEventListener('mouseleave', this.leaveBound);
      this.moveBound = this.leaveBound = null;
      this.lastY = null;
      this.el?.remove();
      this.el = null;
    },
  };

  // ─── On-device AI (experimental) ──────────────────────────────────────
  // Chrome's built-in Gemini Nano APIs (138+): the Summarizer web API here in
  // the content script, and the extension-only Prompt API via the service
  // worker. Inference runs locally — page text never leaves the device.
  const ai = {
    busy: false,
    lastTrigger: null,
    showSheet(title, text) {
      if (!shadow) return;
      const sheet = shadow.querySelector('#sheet');
      if (!sheet) return;
      // Remember what to return focus to when the sheet closes. In a shadow
      // root document.activeElement is the host, so read shadow.activeElement.
      if (sheet.classList.contains('hidden')) {
        this.lastTrigger = shadow.activeElement || null;
      }
      shadow.querySelector('#sheet-title').textContent = title;
      shadow.querySelector('#sheet-body').textContent = text;
      sheet.classList.remove('hidden');
      sheet.focus({ preventScroll: true });
    },
    hideSheet() {
      const sheet = shadow?.querySelector('#sheet');
      if (!sheet || sheet.classList.contains('hidden')) return;
      sheet.classList.add('hidden');
      // Restore focus to the control that opened the sheet (fall back to the
      // summarize button if that control is gone — e.g. opened by voice).
      const back = this.lastTrigger && shadow?.contains(this.lastTrigger)
        ? this.lastTrigger
        : shadow?.querySelector('#ai-summary');
      this.lastTrigger = null;
      try { back?.focus({ preventScroll: true }); } catch {}
    },
    errorMessage(err) {
      if (err?.name === 'NotAllowedError') {
        return 'Chrome only downloads the on-device model after a direct click — use the ✨ button on the toolbar once, then try again.';
      }
      return 'On-device AI failed: ' + (err?.message || err);
    },
    async summarize(speakResult) {
      if (this.busy) return;
      if (!('Summarizer' in self)) {
        return this.showSheet(
          'Summary',
          'On-device AI is not available in this browser. Summaries need Chrome 138 or newer with the built-in model (not yet available on all devices).'
        );
      }
      this.busy = true;
      try {
        const availability = await Summarizer.availability();
        if (availability === 'unavailable') {
          return this.showSheet('Summary', 'This device cannot run the on-device AI model.');
        }
        if (availability !== 'available') {
          this.showSheet('Summary', 'Downloading the on-device model — this happens once and can take a few minutes…');
        }
        const summarizer = await Summarizer.create({
          type: 'key-points',
          format: 'plain-text',
          length: 'medium',
          monitor: (m) =>
            m.addEventListener('downloadprogress', (e) => {
              this.showSheet('Summary', `Downloading the on-device model… ${Math.round((e.loaded || 0) * 100)}%`);
            }),
        });
        const text = pageText(15000);
        if (!text) return this.showSheet('Summary', 'Could not find readable text on this page.');
        this.showSheet('Summary', 'Summarizing…');
        const out = await summarizer.summarize(text, {
          context: 'Summarize for a general audience in plain language.',
        });
        summarizer.destroy?.();
        this.showSheet('Summary', out || 'No summary produced.');
        if (speakResult && out) reader.start(out);
      } catch (err) {
        this.showSheet('Summary', this.errorMessage(err));
      } finally {
        this.busy = false;
      }
    },
    async simplify(speakResult) {
      if (this.busy) return;
      const sel = norm(String(window.getSelection?.().toString() || ''));
      if (!sel) {
        return this.showSheet('Plain language', 'Select some text first, then try simplify again.');
      }
      this.busy = true;
      this.showSheet('Plain language', 'Rewriting in plain language…');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'a11y-simplify', text: sel.slice(0, 4000) });
        const out = res?.ok ? res.text : null;
        this.showSheet('Plain language', out || res?.error || 'Simplify is unavailable.');
        if (speakResult && out) reader.start(out);
      } catch (err) {
        this.showSheet('Plain language', this.errorMessage(err));
      } finally {
        this.busy = false;
      }
    },
  };

  function pageText(maxLen) {
    let out = '';
    for (const b of reader.collect()) {
      if (out.length >= maxLen) break;
      out += b.text + '\n';
    }
    return out.slice(0, maxLen).trim();
  }

  // Pause autoplaying video once per element; if the user starts it again
  // we leave it alone.
  const motionPaused = new WeakSet();
  function pauseAutoplayMedia() {
    if (!effectiveReduceMotion()) return;
    document.querySelectorAll('video[autoplay]').forEach((v) => {
      if (!v.paused && !motionPaused.has(v)) {
        motionPaused.add(v);
        try { v.pause(); } catch {}
      }
    });
  }

  // ─── Keyboard navigation ────────────────────────────────────────────
  function isVisible(el) {
    return (
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !host?.contains(el)
    );
  }
  // Widgets that handle arrow keys themselves — we must not hijack them.
  const ARROW_WIDGETS =
    '[role="menu"], [role="menubar"], [role="listbox"], [role="grid"], [role="tree"], [role="treegrid"], [role="tablist"], [role="slider"], [role="spinbutton"], [contenteditable]';
  const kbd = {
    current: null,
    bound: null,
    focusinBound: null,
    mousedownBound: null,
    focusables() {
      return Array.from(
        document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(isVisible);
    },
    init() {
      if (this.bound) return;
      this.bound = this.onKey.bind(this);
      document.addEventListener('keydown', this.bound, true);
      // Keep our ring in sync with where focus really is: if the user clicks or
      // tabs elsewhere, drop the stale ring instead of leaving it behind.
      this.focusinBound = (e) => {
        if (!this.current || e.target === this.current || host?.contains(e.target)) return;
        this.current.classList.remove('__a11y-focused');
        this.current = null;
      };
      this.mousedownBound = () => {
        if (this.current) { this.current.classList.remove('__a11y-focused'); this.current = null; }
      };
      document.addEventListener('focusin', this.focusinBound, true);
      document.addEventListener('mousedown', this.mousedownBound, true);
      // Do NOT auto-focus the first control — that steals the site's own
      // autofocus. We only move focus when the user issues a move command.
    },
    disable() {
      if (this.bound) document.removeEventListener('keydown', this.bound, true);
      if (this.focusinBound) document.removeEventListener('focusin', this.focusinBound, true);
      if (this.mousedownBound) document.removeEventListener('mousedown', this.mousedownBound, true);
      this.bound = this.focusinBound = this.mousedownBound = null;
      if (this.current) this.current.classList.remove('__a11y-focused');
      this.current = null;
    },
    onKey(e) {
      // Don't hijack typing inside form fields…
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      // …or arrow-driven ARIA widgets (menus, sliders, grids, tablists).
      if (t?.closest && t.closest(ARROW_WIDGETS)) return;
      // Only consume (and preventDefault) the keys we actually act on.
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.move(-1); }
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
      el.scrollIntoView({ behavior: effectiveReduceMotion() ? 'auto' : 'smooth', block: 'center' });
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
      .__a11y-reading-now { outline: 3px solid #2563eb !important; outline-offset: 2px !important; background: rgba(37, 99, 235, 0.08) !important; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ─── Voice commands ─────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
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
        try { this.handle(transcript); } catch (err) { console.warn('[a11y] voice handler:', err); }
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
      if (!this.rec) return;
      // Pick up a changed recognition language on the next (re)start.
      this.rec.lang = settings.voiceLang || 'en-US';
      if (this.listening) return;
      try { this.rec.start(); this.listening = true; } catch {}
    },
    stop() {
      if (this.rec && this.listening) {
        try { this.rec.stop(); } catch {}
      }
      this.listening = false;
    },
    handle(t) {
      // "click <something>" — find a link/button whose text matches and click it
      const clickMatch = t.match(/^(?:click|press|tap|open) (.+)$/);
      if (clickMatch) return this.clickByText(clickMatch[1]);

      // Commands must be the WHOLE utterance (after stripping a short leading
      // filler), so words like "reload" or "go back" inside an ordinary
      // sentence ("I need to reload my notes") can't fire a destructive action.
      const u = t.replace(/^(please|okay|ok|hey|now|could you|can you)\s+/i, '').trim();
      const phrase = (p, fn) => (u === p) && (fn(), true);
      phrase('scroll down', () => window.scrollBy(0, 400)) ||
      phrase('scroll up', () => window.scrollBy(0, -400)) ||
      phrase('top of page', () => window.scrollTo(0, 0)) ||
      phrase('top', () => window.scrollTo(0, 0)) ||
      phrase('bottom of page', () => window.scrollTo(0, document.documentElement.scrollHeight)) ||
      phrase('bottom', () => window.scrollTo(0, document.documentElement.scrollHeight)) ||
      phrase('go back', () => history.back()) ||
      phrase('go forward', () => history.forward()) ||
      phrase('reload', () => location.reload()) ||
      phrase('reload page', () => location.reload()) ||
      phrase('where am i', () => screenReader.readPageInfo()) ||
      phrase('page info', () => screenReader.readPageInfo()) ||
      phrase('read url', () => screenReader.readPageInfo()) ||
      phrase('read page', () => reader.start()) ||
      phrase('stop reading', () => { reader.stop(); screenReader.stop(); }) ||
      phrase('stop', () => { reader.stop(); screenReader.stop(); }) ||
      phrase('next paragraph', () => reader.skip(1)) ||
      phrase('previous paragraph', () => reader.skip(-1)) ||
      phrase('pause', () => { if (reader.active && !reader.paused) reader.pauseToggle(); }) ||
      phrase('resume', () => { if (reader.active && reader.paused) reader.pauseToggle(); }) ||
      phrase('continue', () => { if (reader.active && reader.paused) reader.pauseToggle(); }) ||
      phrase('summarize', () => ai.summarize(true)) ||
      phrase('simplify', () => ai.simplify(true)) ||
      phrase('bigger text', () => actions.fontSize(10)) ||
      phrase('smaller text', () => actions.fontSize(-10)) ||
      phrase('reading mode', () => actions.toggle('readingMode')) ||
      phrase('ruler', () => actions.toggle('ruler')) ||
      phrase('reduce motion', () => actions.toggle('reduceMotion')) ||
      phrase('dark mode', () => actions.setColor('invert')) ||
      phrase('high contrast', () => actions.setColor('high-contrast')) ||
      phrase('default colors', () => actions.setColor('default')) ||
      phrase('next', () => kbd.move(1)) ||
      phrase('previous', () => kbd.move(-1));
    },
    clickByText(query) {
      const q = query.toLowerCase().trim();
      if (!q) return;
      const candidates = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"]');
      const wordRe = new RegExp(`\\b${escapeRegex(q)}\\b`);
      let exactEl = null, wordEl = null, wordLen = Infinity, subEl = null, subLen = Infinity;
      for (const el of candidates) {
        if (host?.contains(el)) continue;
        if (!isVisible(el)) continue; // don't "click" hidden/offscreen controls
        const label = (
          el.getAttribute('aria-label') ||
          el.innerText ||
          el.value ||
          el.title ||
          ''
        ).toLowerCase().trim();
        if (!label) continue;
        if (label === q) { exactEl = el; break; }
        // Prefer whole-word matches, then the shortest containing label.
        if (wordRe.test(label) && label.length < wordLen) { wordEl = el; wordLen = label.length; }
        else if (!wordEl && label.includes(q) && label.length < subLen) { subEl = el; subLen = label.length; }
      }
      const best = exactEl || wordEl || subEl;
      if (best) {
        best.scrollIntoView({ behavior: effectiveReduceMotion() ? 'auto' : 'smooth', block: 'center' });
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
      // (1.6 - 0.1 is not 1.5 in floating point). Both keys persist in one write.
      const letterSpacing = Math.round(Math.max(0, settings.letterSpacing + delta * 0.5) * 100) / 100;
      const lineHeight = Math.round(Math.max(1, settings.lineHeight + delta * 0.1) * 100) / 100;
      saveSettings({ letterSpacing, lineHeight });
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
      syncFeatureState();
      applyAllStyles();
    },
    reset() {
      // One batched write per storage namespace instead of ~18 separate writes.
      const base = { ...DEFAULTS };
      if (siteEntry && siteEntry.scoped) {
        const overrides = { ...DEFAULTS };
        delete overrides.toolbarVisible; // visibility stays global
        siteEntry.overrides = overrides;
        globalSettings.toolbarVisible = DEFAULTS.toolbarVisible;
        Object.assign(settings, DEFAULTS);
        computeEffective();
        persistGlobal({ toolbarVisible: DEFAULTS.toolbarVisible });
        persistScoped(overrides);
      } else {
        globalSettings = { ...DEFAULTS };
        Object.assign(settings, DEFAULTS);
        computeEffective();
        persistGlobal(base);
      }
      syncFeatureState();
      reader.stop();
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
    ruler.sync();
    syncFeatureObserver();
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
        .sheet {
          position: absolute;
          bottom: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%);
          width: min(560px, calc(100vw - 48px));
          max-height: 50vh;
          overflow: auto;
          background: #fff;
          color: #0f172a;
          border: 1px solid rgba(15, 23, 42, 0.12);
          border-radius: 14px;
          box-shadow: 0 16px 48px rgba(15, 23, 42, 0.25);
          padding: 12px 16px 16px;
          font-family: -apple-system, system-ui, sans-serif;
        }
        .sheet:focus { outline: 2px solid #2563eb; }
        .sheet-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        .sheet-head strong { flex: 1; font-size: 13px; }
        .sheet-body { font-size: 14px; line-height: 1.55; white-space: pre-wrap; }
        /* !important so it also beats button.chip's higher specificity */
        .hidden { display: none !important; }
      </style>
      <div class="panel" id="panel" role="group" aria-label="A11y Companion accessibility toolbar">
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
          <button class="chip feat" id="t-ruler" title="Reading ruler" aria-label="Reading ruler">
            <span class="ico">📏</span><span class="lbl">Ruler</span>
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
          <button class="chip feat" id="ai-summary" title="Summarize page (on-device AI)" aria-label="Summarize page with on-device AI">
            <span class="ico">✨</span><span class="lbl">Sum</span>
          </button>
        </div>

        <div class="divider"></div>

        <div class="group" aria-label="Read aloud">
          <button class="chip feat" id="read-play" title="Read page aloud" aria-label="Read page aloud">
            <span class="ico" id="read-play-ico">▶</span><span class="lbl" id="read-play-lbl">Play</span>
          </button>
          <button class="chip label hidden" id="read-pause" title="Pause reading" aria-label="Pause reading">⏸</button>
          <button class="chip label hidden" id="read-skip" title="Skip to next block" aria-label="Skip to next block">⏭</button>
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
      <div class="sheet hidden" id="sheet" role="dialog" aria-modal="true" aria-label="A11y Companion result" tabindex="-1">
        <div class="sheet-head">
          <strong id="sheet-title">Summary</strong>
          <button class="chip label" id="sheet-speak" title="Read result aloud" aria-label="Read result aloud">🔊</button>
          <button class="close" id="sheet-close" title="Close" aria-label="Close">×</button>
        </div>
        <div class="sheet-body" id="sheet-body"></div>
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

    ['dyslexiaFont', 'readingMode', 'ruler', 'keyboardNav', 'screenReader', 'voiceInput'].forEach((k) => {
      $('#t-' + k).onclick = () => actions.toggle(k);
    });

    $('#pageInfo').onclick = () => screenReader.readPageInfo();

    $('#read-play').onclick = () => (reader.active ? reader.stop() : reader.start());
    $('#read-pause').onclick = () => reader.pauseToggle();
    $('#read-skip').onclick = () => reader.skip(1);

    $('#ai-summary').onclick = () => ai.summarize();
    $('#sheet-close').onclick = () => ai.hideSheet();
    $('#sheet-speak').onclick = () => {
      const text = $('#sheet-body').textContent;
      if (text) reader.start(text);
    };
    // Modal sheet: Escape closes; Tab/Shift+Tab is trapped among its controls.
    $('#sheet').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ai.hideSheet(); return; }
      if (e.key !== 'Tab') return;
      const focusables = [$('#sheet-speak'), $('#sheet-close')].filter(
        (el) => el && !el.classList.contains('hidden') && !el.disabled
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = shadow.activeElement;
      if (e.shiftKey && (active === first || active === $('#sheet'))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    });

    $('#colorMode').onchange = (e) => actions.setColor(e.target.value);
  }

  function updateUI() {
    if (!shadow) return;
    const $ = (s) => shadow.querySelector(s);
    $('#panel').classList.toggle('hidden', !settings.toolbarVisible);
    $('#fab').classList.toggle('hidden', settings.toolbarVisible);
    $('#fontval').textContent = settings.fontSize + '%';
    $('#colorMode').value = settings.colorMode;
    ['dyslexiaFont', 'readingMode', 'ruler', 'keyboardNav', 'screenReader', 'voiceInput'].forEach((k) => {
      $('#t-' + k).setAttribute('aria-pressed', String(!!settings[k]));
    });
    updateReadUI();
  }

  function updateReadUI() {
    if (!shadow) return;
    const $ = (s) => shadow.querySelector(s);
    const play = $('#read-play');
    if (!play) return;
    // A toggle button with a changing accessible name should NOT also carry
    // aria-pressed (AT would announce "Stop reading, pressed") — the name
    // alone conveys state.
    play.setAttribute('aria-label', reader.active ? 'Stop reading' : 'Read page aloud');
    play.title = reader.active ? 'Stop reading' : 'Read page aloud';
    $('#read-play-ico').textContent = reader.active ? '⏹' : '▶';
    $('#read-play-lbl').textContent = reader.active ? 'Stop' : 'Play';
    const pause = $('#read-pause');
    pause.classList.toggle('hidden', !reader.active);
    pause.textContent = reader.paused ? '▶' : '⏸';
    pause.setAttribute('aria-label', reader.paused ? 'Resume reading' : 'Pause reading');
    pause.title = reader.paused ? 'Resume reading' : 'Pause reading';
    $('#read-skip').classList.toggle('hidden', !reader.active);
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
      reader.stop();
      ruler.disable();
      unwatchBaseFont();
      syncFeatureObserver();
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(HELPER_STYLE_ID)?.remove();
      document
        .querySelectorAll('.__a11y-reading-dim, .__a11y-reading-main, .__a11y-focused, .__a11y-reading-now')
        .forEach((el) =>
          el.classList.remove('__a11y-reading-dim', '__a11y-reading-main', '__a11y-focused', '__a11y-reading-now')
        );
      readingApplied = false;
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
    let external = false; // a change that did NOT originate from this tab
    for (const [k, c] of Object.entries(changes)) {
      const isSelf = selfWrites.delete(k);
      if (k === SITE_KEY) {
        siteEntry = c.newValue || null;
        touched = true;
        if (!isSelf) external = true;
      } else if (STORAGE_KEYS.includes(k)) {
        if (c.newValue === undefined) delete globalSettings[k];
        else globalSettings[k] = c.newValue;
        touched = true;
        if (!isSelf) external = true;
      }
    }
    if (!touched) return;
    computeEffective();
    applyEnabledState();
    if (siteDisabled) return;
    // Our own echoed writes were already applied by the action that made them —
    // just refresh the chips. Only external changes (popup, options, other
    // devices) need the full re-apply.
    if (!external) { if (shadow) updateUI(); return; }
    buildToolbar(); // first enable on a tab that loaded while disabled
    applyAllStyles();
    updateUI();
    syncFeatureState();
  });

  // ─── SPA support ─────────────────────────────────────────────────────
  // 1. A cheap, always-on observer keeps the toolbar + ruler attached. The host
  //    and ruler are direct children of <html>, so childList (no subtree) on
  //    documentElement is enough to notice their removal — far less work than a
  //    subtree observer on never-idle SPAs (Docs, Figma, Gmail).
  let hostReattachStart = 0, hostReattachCount = 0, hostGiveUpUntil = 0;
  function reattachHost() {
    const now = performance.now();
    if (now < hostGiveUpUntil) return;
    if (now - hostReattachStart > 3000) { hostReattachStart = now; hostReattachCount = 0; }
    if (++hostReattachCount > 30) { hostGiveUpUntil = now + 5000; return; } // hostile page back-off
    // Disconnect around our own append so it doesn't enqueue a no-op callback.
    attachObserver.disconnect();
    document.documentElement.appendChild(host);
    attachObserver.observe(document.documentElement, { childList: true });
  }
  const attachObserver = new MutationObserver(() => {
    if (siteDisabled || orphaned) return;
    if (host && !document.documentElement.contains(host)) reattachHost();
    if (ruler.el && !document.documentElement.contains(ruler.el)) {
      document.documentElement.appendChild(ruler.el);
    }
    if (location.href !== lastHref) fireUrlChange();
  });
  attachObserver.observe(document.documentElement, { childList: true });

  // 2. A feature observer (subtree) re-applies reading mode / pauses autoplay as
  //    SPA content swaps in. It's connected ONLY while a feature that needs it
  //    is active, and skips batches with no element add/remove.
  let readingDebounce, motionDebounce, featureObserverOn = false;
  const featureObserver = new MutationObserver((mutations) => {
    if (siteDisabled || orphaned) return;
    let elementChange = false;
    for (const m of mutations) {
      if (m.addedNodes.length || m.removedNodes.length) { elementChange = true; break; }
    }
    if (!elementChange) return;
    if (location.href !== lastHref) fireUrlChange();
    if (settings.readingMode) {
      clearTimeout(readingDebounce);
      readingDebounce = setTimeout(applyReadingMode, 400);
    }
    if (effectiveReduceMotion()) {
      clearTimeout(motionDebounce);
      motionDebounce = setTimeout(pauseAutoplayMedia, 400);
    }
  });
  function syncFeatureObserver() {
    const need = !siteDisabled && !orphaned && (settings.readingMode || effectiveReduceMotion());
    if (need && !featureObserverOn) {
      featureObserver.observe(document.documentElement, { childList: true, subtree: true });
      featureObserverOn = true;
    } else if (!need && featureObserverOn) {
      featureObserver.disconnect();
      featureObserverOn = false;
    }
  }

  // 3. SPA navigation detection. The content script runs in an isolated world,
  //    so patching history.pushState here does NOT see the page's own calls.
  //    The Navigation API's currententrychange + hashchange + popstate ARE
  //    cross-world, so they reliably catch route changes; the observer href
  //    check above is a final backstop. (The history patch is kept only as a
  //    harmless same-world fallback.)
  let lastHref = location.href;
  const fireUrlChange = () => {
    if (orphaned) return; // stale closures must not run after an extension reload
    // Many sites call replaceState for scroll/analytics state without
    // navigating — only react when the URL really changed.
    if (location.href === lastHref) return;
    lastHref = location.href;
    reader.stop(); // the content under the reading queue is changing
    setTimeout(() => {
      if (orphaned || siteDisabled) return;
      if (settings.readingMode) applyReadingMode();
      // Don't steal focus on navigation; just drop a stale ring if its element
      // is gone, so the next user move starts cleanly.
      if (kbd.current && !document.documentElement.contains(kbd.current)) {
        kbd.current.classList.remove('__a11y-focused');
        kbd.current = null;
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
  window.addEventListener('hashchange', fireUrlChange);
  if (window.navigation && window.navigation.addEventListener) {
    try { window.navigation.addEventListener('currententrychange', fireUrlChange); } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Test seam — inert on real sites. Only exposed when a page explicitly opts
  // in with <html data-a11y-test="1">, which the automated test harness sets
  // and no real site does. Deliberately read-mostly: it never exposes settings
  // mutation, so an opting-in page can't tamper with the user's preferences.
  if (document.documentElement.getAttribute('data-a11y-test') === '1') {
    window.__a11yTest = {
      readableText,
      splitChunks,
      pickLargestTextBlock,
      voiceHandle: (t) => voice.handle(t),
      clickByText: (q) => voice.clickByText(q),
      getSettings: () => ({ ...settings }),
    };
  }
})();
