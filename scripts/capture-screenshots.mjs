// Captures Chrome Web Store screenshots (1280x800), promo tiles, and a clean
// video poster — all from the live demo, driving the real toolbar.
import { serve } from './static-server.mjs';
import { launch } from './launch.mjs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 800;
const shotsDir = join(root, 'store', 'screenshots');
const promoDir = join(root, 'store', 'promo');
const assetsDir = join(root, 'demo', 'assets');

// Inject a labelled banner as a direct child of <html> so the high-contrast
// rule (which targets `body *`) can't strip it. Returns nothing.
async function banner(page, title, sub, mode) {
  await page.evaluate(({ title, sub, mode }) => {
    document.getElementById('__shot-banner')?.remove();
    const el = document.createElement('div');
    el.id = '__shot-banner';
    // Cancel the page-wide invert so the banner stays on-brand in dark mode.
    const counter = mode === 'invert' ? 'filter:invert(1) hue-rotate(180deg);' : '';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483600;' +
      'display:flex;align-items:center;gap:14px;' +
      'padding:16px 26px;font-family:-apple-system,system-ui,sans-serif;' +
      'background:linear-gradient(100deg,#0b1220,#13294d);color:#fff;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.35);' + counter;
    el.innerHTML =
      '<img src="assets/icon128.png" width="40" height="40" style="border-radius:9px" alt="">' +
      '<div><div style="font-size:22px;font-weight:800;letter-spacing:-.01em">' + title + '</div>' +
      '<div style="font-size:14px;color:#aecbff;font-weight:600">' + sub + '</div></div>';
    document.documentElement.appendChild(el);
  }, { title, sub, mode });
}

async function reset(page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!document.getElementById('__a11y-companion-host')?.shadowRoot, null, { timeout: 8000 });
  await page.waitForTimeout(300);
}

const tbClick = (page, sel) => page.evaluate((s) => document.getElementById('__a11y-companion-host').shadowRoot.querySelector(s)?.click(), sel);
const setColor = (page, mode) => page.evaluate((m) => { const s = document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#colorMode'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); }, mode);
const scrollToSel = (page, sel, off = 0) => page.evaluate(({ sel, off }) => { const el = document.querySelector(sel); if (el) window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top + off, behavior: 'instant' }); }, { sel, off });

async function main() {
  await mkdir(shotsDir, { recursive: true });
  await mkdir(promoDir, { recursive: true });
  const { server, url } = await serve('demo');
  const browser = await launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!document.getElementById('__a11y-companion-host')?.shadowRoot, null, { timeout: 8000 });

  const shot = (name) => page.screenshot({ path: join(shotsDir, name) });

  // 1 — Toolbar on a real-looking page
  await reset(page);
  await scrollToSel(page, '.masthead', -20);
  await banner(page, 'One toolbar, every website', 'Your reading & vision settings follow you across the web');
  await page.waitForTimeout(200);
  await shot('01-toolbar.png');

  // 2 — Readable text: dyslexia font + size + spacing
  await reset(page);
  await tbClick(page, '[data-act="font+"]'); await tbClick(page, '[data-act="font+"]');
  await tbClick(page, '[data-act="space+"]'); await tbClick(page, '[data-act="space+"]');
  await tbClick(page, '#t-dyslexiaFont');
  await scrollToSel(page, 'article p', -150);
  await banner(page, 'Made for easier reading', 'OpenDyslexic font, bigger text, and looser spacing — one tap each');
  await page.waitForTimeout(300);
  await shot('02-readable-text.png');

  // 3 — Reading mode
  await reset(page);
  await tbClick(page, '#t-readingMode');
  await scrollToSel(page, '.__a11y-reading-main', -40);
  await banner(page, 'Reading mode', 'Strip a page to just the article and dim the rest');
  await page.waitForTimeout(300);
  await shot('03-reading-mode.png');

  // 4 — High contrast
  await reset(page);
  await setColor(page, 'high-contrast');
  await scrollToSel(page, 'article p', -150);
  await banner(page, 'Dark & high-contrast', 'Low-glare dark mode and maximum-contrast viewing');
  await page.waitForTimeout(300);
  await shot('04-high-contrast.png');

  // 5 — Color-blindness filters
  await reset(page);
  await setColor(page, 'deuteranopia');
  await scrollToSel(page, '.inline-figure', -120);
  await banner(page, 'True color-blindness filters', 'Real color-matrix simulations of protanopia, deuteranopia & tritanopia', 'deuteranopia');
  await page.waitForTimeout(300);
  await shot('05-colorblind.png');

  // 6 — Read aloud + highlight
  await reset(page);
  await tbClick(page, '#read-play');
  await page.waitForTimeout(500);
  await tbClick(page, '#read-skip'); await page.waitForTimeout(300);
  await tbClick(page, '#read-skip'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.__a11y-reading-now')?.scrollIntoView({ block: 'center' }));
  await banner(page, 'Read aloud & screen reader', 'Hear the page read in chunks, or point at anything to hear it');
  await page.waitForTimeout(300);
  await shot('06-read-aloud.png');
  await tbClick(page, '#read-play'); // stop

  // 7 — On-device AI
  await reset(page);
  await tbClick(page, '#ai-summary');
  await page.waitForTimeout(1400);
  await banner(page, 'Private on-device AI', 'Summarize or simplify text with Chrome’s built-in model — nothing leaves your device');
  await page.waitForTimeout(300);
  await shot('07-ai-summary.png');

  // Clean poster for the demo video (no banner)
  await reset(page);
  await scrollToSel(page, '.masthead', -20);
  await page.screenshot({ path: join(assetsDir, 'poster.png') });

  // ── Promo tiles (rendered from inline HTML at exact sizes) ──
  const tile = (w, h, opts) => `
    <html><head><meta charset="utf-8"><style>
      *{margin:0;box-sizing:border-box}
      body{width:${w}px;height:${h}px;overflow:hidden;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;
           background:radial-gradient(1200px 500px at 80% -10%, #1d4ed8 0%, transparent 60%),linear-gradient(150deg,#0b1220,#0e2a4d);
           color:#fff;display:flex;align-items:center;gap:${opts.gap}px;padding:${opts.pad}px;}
      .icon{width:${opts.icon}px;height:${opts.icon}px;border-radius:${opts.icon*0.22}px;box-shadow:0 18px 50px rgba(0,0,0,.5);flex:0 0 auto}
      h1{font-size:${opts.title}px;line-height:1.05;letter-spacing:-.02em;font-weight:850}
      p{margin-top:${opts.gap*0.5}px;font-size:${opts.sub}px;color:#bcd2f5;font-weight:600;max-width:${opts.subw}px}
      .pillrow{margin-top:${opts.gap*0.6}px;display:flex;gap:8px;flex-wrap:wrap}
      .p{font-size:${opts.pill}px;font-weight:700;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
         padding:6px 12px;border-radius:999px;color:#e8f0ff}
    </style></head><body>
      <img class="icon" src="${url}/assets/icon128.png">
      <div>
        <h1>A11y Companion</h1>
        <p>An accessibility toolbar for every website — dyslexia font, color modes, reading mode, read-aloud, voice control &amp; on-device AI.</p>
        ${opts.pills ? '<div class="pillrow"><span class="p">Dyslexia font</span><span class="p">Reading mode</span><span class="p">Color-blind filters</span><span class="p">Read aloud</span><span class="p">Voice</span></div>' : ''}
      </div>
    </body></html>`;

  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(tile(440, 280, { gap: 18, pad: 28, icon: 88, title: 30, sub: 15, subw: 280, pill: 10, pills: false }), { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(promoDir, 'small-tile-440x280.png') });

  await page.setViewportSize({ width: 1400, height: 560 });
  await page.setContent(tile(1400, 560, { gap: 48, pad: 90, icon: 220, title: 84, sub: 30, subw: 760, pill: 16, pills: true }), { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(promoDir, 'marquee-1400x560.png') });

  await browser.close();
  server.close();
  console.log('✓ screenshots →', shotsDir);
  console.log('✓ promo tiles →', promoDir);
  console.log('✓ poster →', join(assetsDir, 'poster.png'));
}

main().catch((e) => { console.error(e); process.exit(1); });
