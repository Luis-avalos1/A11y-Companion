// Background service worker — install defaults and keyboard commands.

importScripts('shared.js');

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(A11Y_KEYS);
  const merged = { ...A11Y_DEFAULTS, ...existing };
  // Older versions stored unrounded spacing steps (e.g. 1.5000000000000002);
  // round them so "is this still the default?" comparisons work again.
  merged.letterSpacing = Math.round(merged.letterSpacing * 100) / 100;
  merged.lineHeight = Math.round(merged.lineHeight * 100) / 100;
  await chrome.storage.sync.set(merged);
});

// Commands flip the global setting; content scripts react via storage events.
const COMMAND_KEYS = {
  'toggle-toolbar': 'toolbarVisible',
  'toggle-screen-reader': 'screenReader',
  'toggle-reading-mode': 'readingMode',
};

chrome.commands.onCommand.addListener(async (command) => {
  const key = COMMAND_KEYS[command];
  if (!key) return;
  const stored = await chrome.storage.sync.get(key);
  const current = key in stored ? stored[key] : A11Y_DEFAULTS[key];
  await chrome.storage.sync.set({ [key]: !current });
});

// On-device AI bridge: the Prompt API (LanguageModel) is extension-only, so
// content scripts ask the service worker to do the rewrite. Inference runs
// locally via Chrome's built-in model; the text never leaves the device.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'a11y-simplify') return;
  (async () => {
    if (!('LanguageModel' in self)) {
      sendResponse({
        ok: false,
        error: 'On-device AI is not available in this Chrome (needs 138+ with the built-in model).',
      });
      return;
    }
    try {
      const availability = await LanguageModel.availability();
      if (availability === 'unavailable') {
        sendResponse({ ok: false, error: 'This device cannot run the on-device AI model.' });
        return;
      }
      const session = await LanguageModel.create({
        initialPrompts: [{
          role: 'system',
          content:
            'You rewrite text in plain, simple language at roughly a 5th-grade reading level. ' +
            'Keep the meaning and any key facts, keep it brief, and output only the rewritten text.',
        }],
      });
      const text = await session.prompt(msg.text);
      session.destroy?.();
      sendResponse({ ok: true, text });
    } catch (err) {
      sendResponse({ ok: false, error: 'Simplify failed: ' + (err?.message || err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
