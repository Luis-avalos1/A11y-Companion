// Shared constants for every extension context (content script, service
// worker, popup, options page). Loaded before the context's own script.

const A11Y_DEFAULTS = {
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
  ruler: false,
  rulerHeight: 80,
  reduceMotion: false,
  speechRate: 1,
  speechVoice: '',
  hoverDelay: 400,
  voiceLang: 'en-US',
};

const A11Y_KEYS = Object.keys(A11Y_DEFAULTS);

// The visual settings a preset replaces. Modal toggles (screen reader, voice
// control, keyboard nav) and toolbar visibility are deliberately left alone.
const A11Y_PRESET_BASE = {
  fontSize: 100,
  letterSpacing: 0,
  lineHeight: 1.5,
  dyslexiaFont: false,
  colorMode: 'default',
  readingMode: false,
  ruler: false,
  reduceMotion: false,
};

const A11Y_PRESETS = {
  dyslexia: {
    label: 'Dyslexia',
    settings: { dyslexiaFont: true, fontSize: 110, letterSpacing: 1, lineHeight: 1.8, ruler: true },
  },
  'low-vision': {
    label: 'Low vision',
    settings: { fontSize: 150, letterSpacing: 0.5, lineHeight: 1.6, colorMode: 'high-contrast' },
  },
  adhd: {
    label: 'ADHD / Focus',
    settings: { ruler: true, reduceMotion: true, lineHeight: 1.7 },
  },
  'light-sensitivity': {
    label: 'Light sensitivity',
    settings: { colorMode: 'invert', reduceMotion: true },
  },
};

// Per-site entries live next to the global keys as `site:<hostname>` items:
// { disabled?: boolean, scoped?: boolean, overrides?: {<setting>: value} }.
function a11ySiteKey(hostname) {
  return 'site:' + hostname;
}
