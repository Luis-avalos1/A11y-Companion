// Browser action popup — global toggles plus per-site controls for the
// current tab's host. activeTab (granted by opening the popup) supplies the
// tab URL without needing the broad "tabs" permission.

let siteKey = null;

async function getSiteEntry() {
  const stored = await chrome.storage.sync.get(siteKey);
  return stored[siteKey] || {};
}

async function initSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (!url || !/^https?:$/.test(url.protocol)) return;
    siteKey = a11ySiteKey(url.hostname);
    const entry = await getSiteEntry();
    document.getElementById('siteName').textContent = url.hostname;
    document.getElementById('siteOff').checked = !!entry.disabled;
    document.getElementById('siteScoped').checked = !!entry.scoped;
    document.getElementById('site').hidden = false;
  } catch {
    // Tab URL not available (chrome:// pages etc.) — leave the section hidden.
  }
}

async function patchSiteEntry(patch) {
  const entry = { ...(await getSiteEntry()), ...patch };
  if (entry.scoped && !entry.overrides) {
    // Seed overrides with the current global settings so flipping the
    // checkbox doesn't visibly change the page.
    const globals = await chrome.storage.sync.get(A11Y_KEYS);
    const seeded = { ...A11Y_DEFAULTS, ...globals };
    delete seeded.toolbarVisible; // visibility stays global
    entry.overrides = seeded;
  }
  if (!entry.scoped) delete entry.overrides;
  if (!entry.disabled && !entry.scoped) await chrome.storage.sync.remove(siteKey);
  else await chrome.storage.sync.set({ [siteKey]: entry });
}

document.getElementById('siteOff').addEventListener('change', (e) =>
  patchSiteEntry({ disabled: e.target.checked })
);
document.getElementById('siteScoped').addEventListener('change', (e) =>
  patchSiteEntry({ scoped: e.target.checked })
);

document.getElementById('toggle').addEventListener('click', async () => {
  const { toolbarVisible } = await chrome.storage.sync.get('toolbarVisible');
  await chrome.storage.sync.set({ toolbarVisible: !toolbarVisible });
  window.close();
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('reset').addEventListener('click', async () => {
  const all = await chrome.storage.sync.get(null);
  const siteKeys = Object.keys(all).filter((k) => k.startsWith('site:'));
  if (siteKeys.length) await chrome.storage.sync.remove(siteKeys);
  await chrome.storage.sync.set(A11Y_DEFAULTS);
  window.close();
});

initSite();
