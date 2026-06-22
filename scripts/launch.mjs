// Shared browser launcher. Prefers the system Google Chrome (channel "chrome")
// so on-device APIs and real fonts/voices are available; falls back to the
// Playwright-bundled Chromium if Chrome isn't usable.
import { chromium } from 'playwright';

export async function launch(opts = {}) {
  const base = { headless: opts.headless ?? true, args: ['--autoplay-policy=no-user-gesture-required'] };
  try {
    return await chromium.launch({ channel: 'chrome', ...base, ...opts });
  } catch (e) {
    console.warn('[launch] system Chrome unavailable, using bundled Chromium:', e.message);
    return await chromium.launch({ ...base, ...opts });
  }
}
