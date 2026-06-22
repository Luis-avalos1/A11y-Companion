// Empirically verifies the demo: loads it in a real browser and checks that the
// REAL content script mounts and that each feature actually changes the page.
import { serve } from './static-server.mjs';
import { launch } from './launch.mjs';

const checks = [];
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log(cond ? '  ✓' : '  ✗', name); };

const { server, url } = await serve('demo');
const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(url, { waitUntil: 'networkidle' });

  // Toolbar mounts via the real content script + shim.
  await page.waitForFunction(() => !!document.getElementById('__a11y-companion-host')?.shadowRoot, null, { timeout: 8000 });
  ok('toolbar host + shadow root present', true);

  const helpers = () => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    return {
      click: (sel) => tb.querySelector(sel)?.click(),
      setColor: (m) => { const s = tb.querySelector('#colorMode'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); },
      styleText: () => document.getElementById('__a11y-companion-style')?.textContent || '',
      htmlFilter: () => getComputedStyle(document.documentElement).filter,
    };
  };

  // Font size up changes the injected <style>.
  const fontApplied = await page.evaluate(() => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    tb.querySelector('[data-act="font+"]').click();
    tb.querySelector('[data-act="font+"]').click();
    const s = document.getElementById('__a11y-companion-style').textContent;
    return /html\s*\{\s*font-size:/.test(s);
  });
  ok('font+ injects a root font-size rule', fontApplied);

  // Dyslexia font.
  const dys = await page.evaluate(() => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    tb.querySelector('#t-dyslexiaFont').click();
    return document.getElementById('__a11y-companion-style').textContent.includes('OpenDyslexic');
  });
  ok('dyslexia toggle injects OpenDyslexic @font-face', dys);

  // OpenDyslexic font file actually loads (via shim getURL → lib/fonts).
  const fontUrl = await page.evaluate(() => {
    const s = document.getElementById('__a11y-companion-style').textContent;
    const m = s.match(/url\('([^']*OpenDyslexic-Regular[^']*)'\)/);
    return m ? m[1] : null;
  });
  let fontOk = false;
  if (fontUrl) { const r = await page.request.get(fontUrl); fontOk = r.ok(); }
  ok('OpenDyslexic-Regular.woff2 resolves & loads (200)', fontOk);

  // Color: deuteranopia applies the SVG filter on <html>.
  const deuter = await page.evaluate(() => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    const s = tb.querySelector('#colorMode'); s.value = 'deuteranopia'; s.dispatchEvent(new Event('change', { bubbles: true }));
    return getComputedStyle(document.documentElement).filter.includes('deuteranopia');
  });
  ok('deuteranopia applies an SVG color filter to <html>', deuter);

  // Reading mode marks the <main> and dims siblings.
  const reading = await page.evaluate(() => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    const s = tb.querySelector('#colorMode'); s.value = 'default'; s.dispatchEvent(new Event('change', { bubbles: true }));
    tb.querySelector('#t-readingMode').click();
    return !!document.querySelector('.__a11y-reading-main') && !!document.querySelector('.__a11y-reading-dim');
  });
  ok('reading mode marks main + dims other content', reading);

  // Ruler appears on toggle.
  const ruler = await page.evaluate(() => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    tb.querySelector('#t-readingMode').click(); // off
    tb.querySelector('#t-ruler').click();
    return !!document.getElementById('__a11y-companion-ruler');
  });
  ok('reading ruler element appears', ruler);

  // Read-aloud builds a queue and highlights a block.
  const readAloud = await page.evaluate(async () => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    tb.querySelector('#t-ruler').click(); // off
    tb.querySelector('#read-play').click();
    await new Promise((r) => setTimeout(r, 400));
    const hl = !!document.querySelector('.__a11y-reading-now');
    tb.querySelector('#read-skip').click();
    await new Promise((r) => setTimeout(r, 300));
    tb.querySelector('#read-play').click(); // stop
    return hl;
  });
  ok('read-aloud highlights a block', readAloud);

  // On-device AI summary sheet shows (shim sample).
  const ai = await page.evaluate(async () => {
    const tb = document.getElementById('__a11y-companion-host').shadowRoot;
    tb.querySelector('#ai-summary').click();
    await new Promise((r) => setTimeout(r, 1200));
    const body = tb.querySelector('#sheet-body').textContent || '';
    const visible = !tb.querySelector('#sheet').classList.contains('hidden');
    // Must be the actual sample summary, not an "unavailable" error message.
    return visible && /demo sample/i.test(body);
  });
  ok('on-device AI summary sheet renders the sample summary', ai);

  // Presets via storage are picked up by the content script.
  const preset = await page.evaluate(async () => {
    document.querySelector('[data-preset="dyslexia"]').click();
    await new Promise((r) => setTimeout(r, 500));
    return document.getElementById('__a11y-companion-style').textContent.includes('OpenDyslexic');
  });
  ok('one-tap preset (storage write) reaches the toolbar', preset);

  // The guided tour is available.
  ok('A11yTour API present', await page.evaluate(() => !!window.A11yTour));

  ok('no uncaught page errors', errors.length === 0);
  if (errors.length) console.log('  errors:\n   ', errors.join('\n    '));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
