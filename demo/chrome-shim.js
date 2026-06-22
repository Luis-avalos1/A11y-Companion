// chrome-shim.js — lets the REAL extension content script run on a plain web
// page (this demo site) with no extension installed.
//
// The content script (lib/content.js) only touches the extension platform in a
// few isolated places: chrome.runtime.id, chrome.runtime.getURL,
// chrome.storage.sync (get/set/remove + onChanged), and one chrome.runtime
// .sendMessage call for the on-device "simplify" feature. We provide all of
// those here, backed by localStorage, so the page behaves like a tab that has
// the extension installed — same code, no Chrome Web Store required.
//
// This shim must load BEFORE lib/shared.js and lib/content.js.
(function () {
  'use strict';
  if (window.chrome && window.chrome.storage && window.chrome.runtime?.id) return;

  const NS = 'a11y-demo:'; // localStorage namespace for this demo
  const onChangedListeners = [];

  function readKey(key) {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }
  function writeKey(key, value) {
    localStorage.setItem(NS + key, JSON.stringify(value));
  }
  function allKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS)) keys.push(k.slice(NS.length));
    }
    return keys;
  }
  function fireChanged(changes) {
    if (!Object.keys(changes).length) return;
    // Async, like the real chrome.storage event, to avoid reentrancy surprises.
    setTimeout(() => {
      for (const fn of onChangedListeners) {
        try { fn(changes, 'sync'); } catch (e) { console.error('[a11y-demo] onChanged listener', e); }
      }
    }, 0);
  }

  // Resolve a request spec (array | string | null/undefined | {key:default})
  // into the same shape chrome.storage.sync.get returns.
  function resolveGet(request) {
    const out = {};
    if (request == null) {
      for (const k of allKeys()) out[k] = readKey(k);
      return out;
    }
    if (typeof request === 'string') {
      const v = readKey(request);
      if (v !== undefined) out[request] = v;
      return out;
    }
    if (Array.isArray(request)) {
      for (const k of request) {
        const v = readKey(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    // object form: { key: defaultValue }
    for (const [k, def] of Object.entries(request)) {
      const v = readKey(k);
      out[k] = v === undefined ? def : v;
    }
    return out;
  }

  const storageSync = {
    get(request) {
      return Promise.resolve(resolveGet(request));
    },
    set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        const oldValue = readKey(k);
        writeKey(k, v);
        changes[k] = { oldValue, newValue: v };
      }
      fireChanged(changes);
      return Promise.resolve();
    },
    remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of list) {
        const oldValue = readKey(k);
        if (oldValue !== undefined) {
          localStorage.removeItem(NS + k);
          changes[k] = { oldValue, newValue: undefined };
        }
      }
      fireChanged(changes);
      return Promise.resolve();
    },
  };

  // ── On-device AI fallback ────────────────────────────────────────────
  // The packaged extension uses Chrome's built-in Gemini Nano (Summarizer +
  // Prompt APIs). Those need Chrome 138+ with the model downloaded, which we
  // can't guarantee on a visitor's machine. So for the demo we hand back a
  // labelled sample result, while clearly noting what the real extension does.
  const SAMPLE_SUMMARY =
    "✨ On-device AI summary (demo sample)\n\n" +
    "• The web is full of barriers for people with dyslexia, low vision, " +
    "color blindness, ADHD, and light sensitivity.\n" +
    "• A11y Companion is a personal toolbar that follows you across every site " +
    "and applies your reading and vision preferences automatically.\n" +
    "• It can resize and re-space text, switch to a dyslexia-friendly font, and " +
    "strip a page down to a clean reading column.\n" +
    "• Color tools include dark mode, high contrast, and true color-blindness " +
    "simulations.\n" +
    "• It can read the page aloud, speak whatever your pointer rests on, and " +
    "take voice commands — all hands-free.\n\n" +
    "In the installed extension this summary is generated on your own device by " +
    "Chrome's built-in model. No text ever leaves your computer.";

  const SAMPLE_SIMPLIFY =
    "(Demo sample) Plain-language version:\n\n" +
    "This tool makes websites easier to read. You can make text bigger, change " +
    "the font, turn on dark mode, and have the page read out loud. In the real " +
    "extension, this rewrite is done on your own computer — your text is never " +
    "sent anywhere.";

  // A drop-in mock of the Summarizer web API. We install it UNCONDITIONALLY so
  // the demo is deterministic: on machines where Chrome exposes the real
  // Summarizer but the on-device model isn't downloaded, the genuine API would
  // report "unavailable" and the ✨ button would show an error. The mock always
  // returns a labelled sample, so the demo looks the same everywhere. (The
  // packaged extension uses the real on-device model — see chrome-shim notes.)
  const summarizerMock = {
    availability: async () => 'available',
    create: async () => ({
      summarize: async () => {
        await new Promise((r) => setTimeout(r, 650)); // feel like real inference
        return SAMPLE_SUMMARY;
      },
      destroy() {},
    }),
  };
  try {
    Object.defineProperty(self, 'Summarizer', { configurable: true, writable: true, value: summarizerMock });
  } catch {
    try { self.Summarizer = summarizerMock; } catch { /* leave the real one */ }
  }

  window.chrome = {
    runtime: {
      id: 'a11y-companion-demo',
      // Map extension resource paths (e.g. 'fonts/OpenDyslexic-Regular.woff2')
      // to where they actually live in the demo (demo/lib/...).
      getURL(path) {
        return new URL('lib/' + path, document.baseURI).href;
      },
      // The content script asks the (nonexistent) service worker to simplify
      // selected text. We answer locally with a labelled sample.
      sendMessage(msg) {
        if (msg && msg.type === 'a11y-simplify') {
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, text: SAMPLE_SIMPLIFY }), 650)
          );
        }
        return Promise.resolve(undefined);
      },
      onMessage: { addListener() {}, removeListener() {} },
      lastError: undefined,
    },
    storage: {
      sync: storageSync,
      local: storageSync,
      onChanged: {
        addListener(fn) { onChangedListeners.push(fn); },
        removeListener(fn) {
          const i = onChangedListeners.indexOf(fn);
          if (i >= 0) onChangedListeners.splice(i, 1);
        },
      },
    },
  };
})();
