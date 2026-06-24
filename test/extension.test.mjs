// Behavioral tests for the A11y Companion content script, run in headless
// Chromium against the REAL extension source via the chrome-shim (see
// harness.mjs). These assert invariants that must hold on ANY website.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

// Small helpers run inside the page.
const styleText = (page) =>
  page.evaluate(() => document.getElementById('__a11y-companion-style')?.textContent || '');
const clickChip = (page, sel) =>
  page.evaluate((s) => document.getElementById('__a11y-companion-host').shadowRoot.querySelector(s)?.click(), sel);
const setColor = (page, mode) =>
  page.evaluate((m) => {
    const el = document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#colorMode');
    el.value = m;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, mode);

const ARTICLE = `
  <header><nav><a href="#a">Nav A</a><a href="#b">Nav B</a></nav></header>
  <main>
    <h1>Main Heading</h1>
    <p>First readable paragraph with enough text to be meaningful for the reader.</p>
    <p>Second paragraph follows with additional sentences. It keeps going so the
       reader has multiple chunks to walk through during read-aloud.</p>
    <ul><li>List item one</li><li>List item two</li></ul>
  </main>
  <aside>Sidebar content that reading mode should dim.</aside>
  <footer>Footer text.</footer>`;

describe('boot + invariants', () => {
  test('mounts the toolbar in a shadow root on a normal page', async () => {
    const page = await h.newFixture(ARTICLE);
    const mounted = await page.evaluate(
      () => !!document.getElementById('__a11y-companion-host')?.shadowRoot?.querySelector('.panel')
    );
    assert.ok(mounted, 'shadow toolbar panel should exist');
    assert.equal(page.__errors.length, 0, 'no page errors on boot');
    await page.__context.close();
  });

  test('idle extension at defaults injects NO page styles', async () => {
    const page = await h.newFixture(ARTICLE);
    const css = await styleText(page);
    assert.equal(css.trim(), '', 'default settings must not restyle the page');
    await page.__context.close();
  });

  test('boots without throwing when document.body is replaced/missing patterns exist', async () => {
    // A page that mutates <body> aggressively right after load.
    const page = await h.newFixture(ARTICLE, { head: '<script>setTimeout(()=>{document.body.appendChild(document.createElement("div"))},0)</script>' });
    assert.equal(page.__errors.length, 0);
    await page.__context.close();
  });
});

describe('text + spacing', () => {
  test('font+ scales the root font relative to the site base, then reset clears it', async () => {
    const page = await h.newFixture(ARTICLE);
    await clickChip(page, '[data-act="font+"]');
    let css = await styleText(page);
    assert.match(css, /html\s*\{\s*font-size:\s*[\d.]+px/, 'font+ should emit a root font-size');
    await clickChip(page, '#reset');
    css = await styleText(page);
    assert.doesNotMatch(css, /font-size:/, 'reset should remove the font-size rule');
    await page.__context.close();
  });
});

describe('color modes', () => {
  test('high-contrast then back to default fully cleans up', async () => {
    const page = await h.newFixture(ARTICLE);
    await setColor(page, 'high-contrast');
    let css = await styleText(page);
    assert.match(css, /background-color:\s*#000/i, 'high-contrast emits a solid dark background');
    await setColor(page, 'default');
    css = await styleText(page);
    assert.doesNotMatch(css, /#000/i, 'default removes the high-contrast rules');
    await page.__context.close();
  });

  // Regression for the highest-severity finding: color filters must scope to
  // <body>, never <html>, or the cascade tints the toolbar host itself.
  test('deuteranopia filters <body>, not <html> (toolbar host stays clean)', async () => {
    const page = await h.newFixture(ARTICLE);
    await setColor(page, 'deuteranopia');
    const { htmlFilter, bodyFilter, hostFilter } = await page.evaluate(() => ({
      htmlFilter: getComputedStyle(document.documentElement).filter,
      bodyFilter: getComputedStyle(document.body).filter,
      hostFilter: getComputedStyle(document.getElementById('__a11y-companion-host')).filter,
    }));
    assert.match(bodyFilter, /deuteranopia/, 'filter applied to body');
    assert.doesNotMatch(htmlFilter, /deuteranopia/, 'filter NOT on html');
    assert.doesNotMatch(hostFilter, /deuteranopia/, 'toolbar host is not filtered');
    await page.__context.close();
  });
});

describe('reading mode', () => {
  test('marks main content and dims siblings, cleans up on toggle off', async () => {
    const page = await h.newFixture(ARTICLE);
    await clickChip(page, '#t-readingMode');
    let state = await page.evaluate(() => ({
      main: document.querySelectorAll('.__a11y-reading-main').length,
      dim: document.querySelectorAll('.__a11y-reading-dim').length,
    }));
    assert.equal(state.main, 1, 'exactly one main marked');
    assert.ok(state.dim > 0, 'siblings dimmed');
    await clickChip(page, '#t-readingMode');
    state = await page.evaluate(() => ({
      main: document.querySelectorAll('.__a11y-reading-main').length,
      dim: document.querySelectorAll('.__a11y-reading-dim').length,
    }));
    assert.equal(state.main, 0, 'main marker removed on off');
    assert.equal(state.dim, 0, 'dim markers removed on off');
    await page.__context.close();
  });
});

describe('SPA navigation', () => {
  test('survives history.pushState route changes without errors', async () => {
    const page = await h.newFixture(ARTICLE);
    await clickChip(page, '#t-readingMode');
    await page.evaluate(() => {
      history.pushState({}, '', '/route-2');
      history.pushState({}, '', '/route-3');
    });
    await page.waitForTimeout(700);
    const stillMounted = await page.evaluate(
      () => !!document.getElementById('__a11y-companion-host')?.shadowRoot
    );
    assert.ok(stillMounted, 'toolbar survives SPA navigation');
    assert.equal(page.__errors.length, 0, 'no errors during SPA navigation');
    await page.__context.close();
  });

  test('re-injects the toolbar if the page removes the host node', async () => {
    const page = await h.newFixture(ARTICLE);
    await page.evaluate(() => document.getElementById('__a11y-companion-host')?.remove());
    // The MutationObserver should put it back.
    await page.waitForFunction(() => !!document.getElementById('__a11y-companion-host'), null, { timeout: 4000 });
    await page.__context.close();
  });
});

describe('hostile / weird pages', () => {
  test('boots on a page that overrides Array/Object prototypes', async () => {
    const page = await h.newFixture(ARTICLE, {
      head: `<script>
        Array.prototype.forEach = Array.prototype.forEach; // identity, but define enumerable junk:
        Object.defineProperty(Object.prototype, 'polluted', { value: 1, enumerable: true, configurable: true });
      </script>`,
    });
    const mounted = await page.evaluate(() => !!document.getElementById('__a11y-companion-host')?.shadowRoot);
    assert.ok(mounted, 'boots despite prototype pollution');
    await page.__context.close();
  });

  test('handles a large DOM without hanging', async () => {
    const big = '<main>' + '<p>paragraph text node here</p>'.repeat(4000) + '</main>';
    const page = await h.newFixture(big);
    // Toggle reading mode + high contrast — the heaviest passes — and ensure
    // they complete within a reasonable budget.
    const start = Date.now();
    await clickChip(page, '#t-readingMode');
    await setColor(page, 'high-contrast');
    await page.waitForTimeout(200);
    assert.ok(Date.now() - start < 6000, 'heavy passes complete in time');
    assert.equal(page.__errors.length, 0);
    await page.__context.close();
  });
});
