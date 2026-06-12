// Options page — presets, speech, voice language, reading aids, and the
// per-site list. Everything persists straight to chrome.storage.sync; open
// tabs react through their storage listeners.

const $ = (id) => document.getElementById(id);

const VOICE_LANGS = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['en-AU', 'English (Australia)'],
  ['es-ES', 'Español (España)'],
  ['es-MX', 'Español (México)'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['pt-BR', 'Português (Brasil)'],
  ['nl-NL', 'Nederlands'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['zh-CN', '中文（简体）'],
  ['hi-IN', 'हिन्दी'],
];

let statusTimer;
function announce(msg) {
  const el = $('status');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

// ─── Presets ───────────────────────────────────────────────────────────
for (const preset of Object.values(A11Y_PRESETS)) {
  const b = document.createElement('button');
  b.className = 'preset';
  b.textContent = preset.label;
  b.addEventListener('click', async () => {
    await chrome.storage.sync.set({ ...A11Y_PRESET_BASE, ...preset.settings });
    announce(`${preset.label} preset applied`);
  });
  $('presets').appendChild(b);
}
$('resetVisual').addEventListener('click', async () => {
  await chrome.storage.sync.set({ ...A11Y_PRESET_BASE });
  announce('Visual settings reset');
});

// ─── Speech ────────────────────────────────────────────────────────────
function fillVoices(selected) {
  const sel = $('speechVoice');
  const voices = speechSynthesis.getVoices();
  sel.querySelectorAll('option:not([value=""])').forEach((o) => o.remove());
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
  sel.value = selected && voices.some((v) => v.name === selected) ? selected : '';
}

// ─── Load & bind ───────────────────────────────────────────────────────
async function init() {
  const s = { ...A11Y_DEFAULTS, ...(await chrome.storage.sync.get(A11Y_KEYS)) };

  // Voices load asynchronously; repopulate when the list arrives.
  fillVoices(s.speechVoice);
  speechSynthesis.addEventListener('voiceschanged', () => fillVoices(s.speechVoice));
  $('speechVoice').addEventListener('change', (e) => save('speechVoice', e.target.value));

  // Debounce range saves — a drag fires dozens of input events per second,
  // and chrome.storage.sync rate-limits writes.
  const bindRange = (id, key, fmt) => {
    const input = $(id);
    const out = $(id + 'Out');
    input.value = s[key];
    out.textContent = fmt(s[key]);
    let t;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = fmt(v);
      clearTimeout(t);
      t = setTimeout(() => save(key, v), 250);
    });
  };
  bindRange('speechRate', 'speechRate', (v) => v.toFixed(1) + '×');
  bindRange('hoverDelay', 'hoverDelay', (v) => v + ' ms');
  bindRange('rulerHeight', 'rulerHeight', (v) => v + ' px');

  const langSel = $('voiceLang');
  for (const [code, label] of VOICE_LANGS) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    langSel.appendChild(o);
  }
  if (![...langSel.options].some((o) => o.value === s.voiceLang)) {
    const o = document.createElement('option');
    o.value = s.voiceLang;
    o.textContent = s.voiceLang;
    langSel.appendChild(o);
  }
  langSel.value = s.voiceLang;
  langSel.addEventListener('change', (e) => save('voiceLang', e.target.value));

  $('reduceMotion').checked = !!s.reduceMotion;
  $('reduceMotion').addEventListener('change', (e) => save('reduceMotion', e.target.checked));

  $('shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  renderSites();
}

// ─── Per-site list ─────────────────────────────────────────────────────
async function renderSites() {
  const all = await chrome.storage.sync.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith('site:'))
    .sort(([a], [b]) => a.localeCompare(b));
  const list = $('sites');
  list.textContent = '';
  $('sitesEmpty').hidden = entries.length > 0;
  for (const [key, entry] of entries) {
    const li = document.createElement('li');
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = key.slice('site:'.length);
    li.appendChild(host);
    if (entry.disabled) {
      const b = document.createElement('span');
      b.className = 'badge off';
      b.textContent = 'off';
      li.appendChild(b);
    }
    if (entry.scoped) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'custom';
      li.appendChild(b);
    }
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove per-site settings for ${host.textContent}`);
    rm.addEventListener('click', async () => {
      await chrome.storage.sync.remove(key);
      announce(`Removed settings for ${host.textContent}`);
    });
    li.appendChild(rm);
    list.appendChild(li);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (Object.keys(changes).some((k) => k.startsWith('site:'))) renderSites();
});

init();
