// demo.js — wires up the demo page chrome (presets, CTAs, video, tour trigger).
// The accessibility features themselves come from the real content script
// (lib/content.js); this file only drives the marketing/demo surface.
(function () {
  'use strict';

  // Not on the Chrome Web Store yet. When a listing exists, set this URL and add
  // an "Add to Chrome" link wherever it belongs — for now the demo points people
  // at the source and the guided tour instead of a non-existent store page.
  const STORE_URL = '';

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

  // ── Guided tour triggers (header CTA + the "Get A11y Companion" box) ──
  document.querySelectorAll('#play-tour, #play-tour-2').forEach((btn) => {
    btn.addEventListener('click', () => window.A11yTour && window.A11yTour.start());
  });

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
          '<div class="video-missing">The recorded tour will appear here.<br>' +
          'Run <code>npm run record</code> to generate it, or press ' +
          '<b>▶ Play the 90-second tour</b> above to watch it live.</div>';
      }
    });
  }
})();
