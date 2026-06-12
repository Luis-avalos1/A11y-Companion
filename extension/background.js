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
