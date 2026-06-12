// Background service worker — handles toolbar toggle command and install defaults.

const DEFAULT_SETTINGS = {
  toolbarVisible: true,
  fontSize: 100,
  letterSpacing: 0,
  lineHeight: 1.5,
  dyslexiaFont: false,
  colorMode: 'default',
  screenReader: false,
  voiceInput: false,
  keyboardNav: false,
  readingMode: false,
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.sync.set(merged);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-toolbar') return;
  const { toolbarVisible } = await chrome.storage.sync.get('toolbarVisible');
  await chrome.storage.sync.set({ toolbarVisible: !toolbarVisible });
});
