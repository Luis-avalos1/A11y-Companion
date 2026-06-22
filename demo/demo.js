// demo.js — wires up the demo page chrome (presets, CTAs, video, tour trigger).
// The accessibility features themselves come from the real content script
// (lib/content.js); this file only drives the marketing/demo surface.
(function () {
  'use strict';

  // When the extension is published, set this to the Chrome Web Store URL and
  // both "Add to Chrome" buttons will point at it.
  const STORE_URL = '';

  if (STORE_URL) {
    document.querySelectorAll('#cta-store, .newsletter button').forEach((el) => {
      if (el.tagName === 'A') { el.href = STORE_URL; el.target = '_blank'; el.rel = 'noopener'; }
      else el.addEventListener('click', () => window.open(STORE_URL, '_blank', 'noopener'));
    });
  }

  // ── One-tap presets: write straight to the shimmed chrome.storage.sync, the
  //    same store the toolbar reads. The content script reacts via onChanged. ──
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.preset;
      if (key === '__reset') {
        const all = await chrome.storage.sync.get(null);
        const siteKeys = Object.keys(all).filter((k) => k.startsWith('site:'));
        if (siteKeys.length) await chrome.storage.sync.remove(siteKeys);
        await chrome.storage.sync.set({ ...A11Y_DEFAULTS });
        return;
      }
      const preset = A11Y_PRESETS[key];
      if (!preset) return;
      await chrome.storage.sync.set({ ...A11Y_PRESET_BASE, ...preset.settings });
    });
  });

  // ── Guided tour trigger ──
  const tourBtn = document.getElementById('play-tour');
  if (tourBtn) {
    tourBtn.addEventListener('click', () => window.A11yTour && window.A11yTour.start());
  }

  // Auto-start the tour when asked (used by the video recorder: ?tour=1).
  const params = new URLSearchParams(location.search);
  if (params.has('tour') || params.has('record')) {
    const start = () => window.A11yTour && window.A11yTour.start({ record: params.has('record') });
    if (document.readyState === 'complete') setTimeout(start, 600);
    else window.addEventListener('load', () => setTimeout(start, 600));
  }

  // ── Video: show a friendly placeholder until the recording exists ──
  const video = document.getElementById('demo-video');
  const frame = document.getElementById('video-frame');
  if (video && frame) {
    let ok = false;
    const sources = [...video.querySelectorAll('source')].map((s) => s.src);
    Promise.all(
      sources.map((src) =>
        fetch(src, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
      )
    ).then((results) => {
      ok = results.some(Boolean);
      if (!ok) {
        frame.innerHTML =
          '<div class="video-missing">🎬 The recorded tour will appear here.<br>' +
          'Run <code>npm run record</code> to generate it, or press ' +
          '<b>▶ Play the guided tour</b> above to watch it live.</div>';
      }
    });
  }
})();
