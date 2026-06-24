// Regression tests for the June 2026 stress-test fixes. Each test maps to a
// verified finding and proves the fix on the REAL extension source. Pure logic
// (voice-command anchoring, readableText, clickByText) is driven through the
// content script's read-only test seam (window.__a11yTest), exposed only when
// <html data-a11y-test="1"> — which the harness sets.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

const styleText = (page) =>
  page.evaluate(() => document.getElementById('__a11y-companion-style')?.textContent || '');
const clickChip = (page, sel) =>
  page.evaluate((s) => document.getElementById('__a11y-companion-host').shadowRoot.querySelector(s)?.click(), sel);
const setColor = (page, mode) =>
  page.evaluate((m) => {
    const el = document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#colorMode');
    el.value = m; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, mode);

const ARTICLE = `<main><h1>H</h1><p>${'word '.repeat(40)}</p></main><aside>aside</aside>`;

// ── #1 Color filters scope to <body>, never <html> (toolbar stays clean) ──
describe('color filter isolation (#1)', () => {
  for (const mode of ['invert', 'grayscale', 'protanopia', 'tritanopia']) {
    test(`${mode} filters body and leaves the toolbar host unfiltered`, async () => {
      const page = await h.newFixture(ARTICLE);
      await setColor(page, mode);
      const r = await page.evaluate(() => ({
        html: getComputedStyle(document.documentElement).filter,
        body: getComputedStyle(document.body).filter,
        host: getComputedStyle(document.getElementById('__a11y-companion-host')).filter,
      }));
      assert.notEqual(r.body, 'none', `${mode} applies a body filter`);
      assert.equal(r.host, 'none', 'toolbar host must not be filtered');
      // html may carry a backdrop color for invert, but never the filter itself.
      assert.equal(r.html, 'none', 'filter is not on <html>');
      await page.__context.close();
    });
  }
});

// ── #2 Reading mode must not dim/disable fixed/sticky/dialog overlays ──
describe('reading mode preserves overlays (#2)', () => {
  test('does not dim fixed, sticky, or [role=dialog] siblings', async () => {
    const page = await h.newFixture(`
      <div style="position:fixed" id="fixed">cookie banner</div>
      <div style="position:sticky" id="sticky">sticky nav</div>
      <div role="dialog" id="dialog">modal</div>
      <main><h1>Article</h1><p>${'content '.repeat(40)}</p></main>
      <aside id="plain">plain sidebar</aside>`);
    await clickChip(page, '#t-readingMode');
    const dimmed = await page.evaluate(() => {
      const d = (id) => document.getElementById(id).classList.contains('__a11y-reading-dim');
      return { fixed: d('fixed'), sticky: d('sticky'), dialog: d('dialog'), plain: d('plain') };
    });
    assert.equal(dimmed.fixed, false, 'fixed overlay stays interactive');
    assert.equal(dimmed.sticky, false, 'sticky chrome stays interactive');
    assert.equal(dimmed.dialog, false, 'dialog stays interactive');
    assert.equal(dimmed.plain, true, 'ordinary sibling is dimmed');
    await page.__context.close();
  });

  test('a modal mounted AFTER reading mode is on is not dimmed (observer path)', async () => {
    const page = await h.newFixture(`<main><h1>A</h1><p>${'x '.repeat(60)}</p></main>`);
    await clickChip(page, '#t-readingMode');
    await page.evaluate(() => {
      const m = document.createElement('div');
      m.id = 'late'; m.setAttribute('role', 'dialog'); m.textContent = 'late modal';
      document.body.appendChild(m);
    });
    await page.waitForTimeout(600); // let the debounced observer re-run
    const dimmed = await page.evaluate(() => document.getElementById('late').classList.contains('__a11y-reading-dim'));
    assert.equal(dimmed, false, 'late-mounted modal stays interactive');
    await page.__context.close();
  });
});

// ── #3 pickLargestTextBlock works on landmark-less pages without innerText sweep ──
describe('reading mode fallback (#3)', () => {
  test('selects the largest text block when there is no main/article', async () => {
    const page = await h.newFixture(
      `<div>nav</div><div id="big">${'sentence here. '.repeat(60)}</div><div>foot</div>`
    );
    await clickChip(page, '#t-readingMode');
    const isMain = await page.evaluate(() => document.getElementById('big').classList.contains('__a11y-reading-main'));
    assert.ok(isMain, 'largest div chosen as reading main');
    await page.__context.close();
  });
});

// ── #7 Keyboard nav must not steal focus or hijack widget arrow keys ──
describe('keyboard nav (#7)', () => {
  test('does not steal focus from the page autofocus on enable', async () => {
    const page = await h.newFixture(`<input id="search" autofocus><main><a href="#x">link</a></main>`);
    await clickChip(page, '#t-keyboardNav');
    const active = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    assert.notEqual(active, 'A', 'keyboard nav did not yank focus onto the first link');
    await page.__context.close();
  });

  test('arrow keys are not preventDefaulted inside a role=menu widget', async () => {
    const page = await h.newFixture(`<main><div role="menu"><button id="mi">item</button></div></main>`);
    await clickChip(page, '#t-keyboardNav');
    const defaultPrevented = await page.evaluate(() => {
      const mi = document.getElementById('mi');
      mi.focus();
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      mi.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(defaultPrevented, false, 'arrow key left for the menu widget to handle');
    await page.__context.close();
  });

  test('arrow keys ARE consumed for ordinary content', async () => {
    const page = await h.newFixture(`<main><p id="p">text</p><a href="#a">a</a></main>`);
    await clickChip(page, '#t-keyboardNav');
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      document.getElementById('p').dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, true, 'arrow key consumed to drive keyboard nav');
    await page.__context.close();
  });
});

// ── #23 Destructive voice commands must require the whole utterance ──
describe('voice command anchoring (#23)', () => {
  test('navigation fires on the command but NOT mid-sentence', async () => {
    const page = await h.newFixture(ARTICLE);
    await page.evaluate(() => { window.__back = 0; history.back = () => { window.__back++; }; });
    const back = (t) => page.evaluate((t) => { window.__a11yTest.voiceHandle(t); return window.__back; }, t);

    assert.equal(await back('go back'), 1, '"go back" triggers back()');
    assert.equal(await back('i really need to go back to my notes later'), 1, 'mid-sentence does NOT trigger');
    assert.equal(await back('please go back'), 2, 'leading filler still triggers');
    await page.__context.close();
  });

  test('scroll command tolerates filler but not embedding in a sentence', async () => {
    const page = await h.newFixture(`<main>${'<p>line</p>'.repeat(60)}</main>`);
    const y = () => page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.__a11yTest.voiceHandle('the cat ran down the scroll down street'));
    assert.equal(await y(), 0, 'embedded phrase does not scroll');
    await page.evaluate(() => window.__a11yTest.voiceHandle('scroll down'));
    assert.ok((await y()) > 0, 'exact command scrolls');
    await page.__context.close();
  });
});

// ── #24 clickByText filters to visible controls and ranks matches ──
describe('clickByText targeting (#24)', () => {
  test('prefers an exact, visible match over a hidden or longer one', async () => {
    const page = await h.newFixture(`
      <main>
        <button id="hidden" style="display:none" onclick="window.__hit='hidden'">Submit</button>
        <button id="long" onclick="window.__hit='long'">Submit your application now</button>
        <button id="exact" onclick="window.__hit='exact'">Submit</button>
      </main>`);
    await page.evaluate(() => window.__a11yTest.clickByText('submit'));
    const hit = await page.evaluate(() => window.__hit);
    assert.equal(hit, 'exact', 'clicked the exact visible button, not hidden/longer');
    await page.__context.close();
  });
});

// ── #13 applyAllStyles skips re-parse when CSS is unchanged ──
describe('style stability (#13)', () => {
  test('toggling a non-visual setting does not rewrite the stylesheet', async () => {
    const page = await h.newFixture(ARTICLE);
    const mutations = await page.evaluate(async () => {
      const styleEl = document.getElementById('__a11y-companion-style');
      let n = 0;
      const obs = new MutationObserver(() => n++);
      obs.observe(styleEl, { childList: true, characterData: true, subtree: true });
      const tb = document.getElementById('__a11y-companion-host').shadowRoot;
      tb.querySelector('#t-keyboardNav').click(); // non-visual
      tb.querySelector('#t-keyboardNav').click();
      await new Promise((r) => setTimeout(r, 100));
      obs.disconnect();
      return n;
    });
    assert.equal(mutations, 0, 'stylesheet text not rewritten for non-visual toggles');
    await page.__context.close();
  });
});

// ── #8 reset() performs a single batched storage write ──
describe('reset batching (#8)', () => {
  test('reset issues one storage.sync.set, not one per key', async () => {
    const page = await h.newFixture(ARTICLE);
    const calls = await page.evaluate(async () => {
      const orig = chrome.storage.sync.set.bind(chrome.storage.sync);
      let n = 0;
      chrome.storage.sync.set = (items) => { n++; return orig(items); };
      document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#reset').click();
      await new Promise((r) => setTimeout(r, 100));
      return n;
    });
    assert.ok(calls <= 2, `reset batched writes (got ${calls} set calls)`);
    assert.ok(calls >= 1, 'reset did persist');
    await page.__context.close();
  });
});

// ── #19 reduce-motion honors the OS prefers-reduced-motion preference ──
describe('reduce motion OS preference (#19)', () => {
  test('emits the motion-freeze CSS when the OS prefers reduced motion, even with the toggle off', async () => {
    const page = await h.newFixture(ARTICLE, { reducedMotion: 'reduce' });
    // Nudge a re-style (boot already ran with the preference active).
    await clickChip(page, '#t-keyboardNav');
    const css = await styleText(page);
    assert.match(css, /animation-duration:\s*0\.001s/, 'OS reduced-motion freezes animations');
    await page.__context.close();
  });
});

// ── #22 readableText: own text over ancestor landmark; visually-hidden labels ──
describe('readableText accuracy (#22)', () => {
  test('reads the hovered text, not an ancestor landmark aria-label', async () => {
    const page = await h.newFixture(`<main><section aria-label="Comments"><p id="p">The actual paragraph text</p></section></main>`);
    const txt = await page.evaluate(() => window.__a11yTest.readableText(document.getElementById('p')));
    assert.equal(txt, 'The actual paragraph text');
    await page.__context.close();
  });

  test('captures a visually-hidden label on an icon button via textContent', async () => {
    const page = await h.newFixture(
      `<main><button id="b"><span style="position:absolute;width:1px;height:1px;overflow:hidden">Save document</span><svg></svg></button></main>`
    );
    const txt = await page.evaluate(() => window.__a11yTest.readableText(document.getElementById('b')));
    assert.equal(txt, 'Save document');
    await page.__context.close();
  });
});

// ── #4 High-contrast paints solid (non-transparent) backgrounds ──
describe('high contrast solidity (#4)', () => {
  test('forces solid black backgrounds and white text on page content', async () => {
    const page = await h.newFixture(`<main><div id="card" style="background:#fff;color:#333">Card text</div></main>`);
    await setColor(page, 'high-contrast');
    const r = await page.evaluate(() => {
      const c = getComputedStyle(document.getElementById('card'));
      return { bg: c.backgroundColor, color: c.color };
    });
    assert.equal(r.bg, 'rgb(0, 0, 0)', 'card background forced solid black');
    assert.equal(r.color, 'rgb(255, 255, 255)', 'card text forced white');
    await page.__context.close();
  });
});

// ── #25 SPA navigation stops read-aloud ──
describe('SPA navigation stops the reader (#25)', () => {
  test('pushState route change stops an in-progress read-aloud', async () => {
    const page = await h.newFixture(`<main>${'<p>A sentence to read aloud.</p>'.repeat(8)}</main>`);
    await clickChip(page, '#read-play');
    await page.waitForTimeout(300);
    await page.evaluate(() => history.pushState({}, '', '/next'));
    await page.waitForTimeout(200);
    const label = await page.evaluate(
      () => document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#read-play-lbl').textContent
    );
    assert.equal(label, 'Play', 'reader returned to idle after navigation');
    await page.__context.close();
  });
});

// ── #6 AI result sheet: focus trap + restore focus on close ──
describe('AI sheet focus management (#6)', () => {
  test('Escape closes the sheet and restores focus to the trigger', async () => {
    const page = await h.newFixture(ARTICLE);
    await clickChip(page, '#ai-summary');
    await page.waitForFunction(
      () => !document.getElementById('__a11y-companion-host').shadowRoot.querySelector('#sheet').classList.contains('hidden'),
      null, { timeout: 4000 }
    );
    const restored = await page.evaluate(async () => {
      const sr = document.getElementById('__a11y-companion-host').shadowRoot;
      sr.querySelector('#sheet').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      return {
        hidden: sr.querySelector('#sheet').classList.contains('hidden'),
        active: sr.activeElement?.id,
      };
    });
    assert.equal(restored.hidden, true, 'Escape closed the sheet');
    assert.equal(restored.active, 'ai-summary', 'focus restored to the opening control');
    await page.__context.close();
  });
});

// ── #11/#12 Site-scoped writes route to the host override and merge ──
describe('site-scoped settings (#11/#12)', () => {
  test('a scoped tab writes to the host override, not the global key, and merges', async () => {
    // Boot already site-scoped with one existing override (lineHeight: 2).
    const page = await h.newFixture(ARTICLE, {
      seedStorage: { 'site:127.0.0.1': { scoped: true, overrides: { lineHeight: 2 } } },
    });
    await clickChip(page, '[data-act="font+"]'); // change fontSize on this site
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() => ({
      site: JSON.parse(localStorage.getItem('a11y-demo:site:127.0.0.1') || '{}'),
      global: localStorage.getItem('a11y-demo:fontSize'),
    }));
    assert.equal(stored.global, null, 'global fontSize untouched in scoped mode');
    assert.ok(stored.site.overrides.fontSize > 100, 'fontSize written to the host override');
    assert.equal(stored.site.overrides.lineHeight, 2, 'existing override key not clobbered');
    await page.__context.close();
  });
});

// ── selfWrites must not leak on a no-op write (regression in the rewrite) ──
describe('self-write tracking does not suppress external changes', () => {
  test('an external change still restyles the page after a clamped no-op write', async () => {
    const page = await h.newFixture(ARTICLE); // root font-size defaults to 16px
    await clickChip(page, '[data-act="font-"]'); // 90%
    await clickChip(page, '[data-act="font-"]'); // 80%
    await clickChip(page, '[data-act="font-"]'); // 80% — clamped no-op write
    await page.waitForTimeout(100);
    // Simulate the options page / another device writing the same key.
    await page.evaluate(() => chrome.storage.sync.set({ fontSize: 150 }));
    await page.waitForTimeout(150);
    const px = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    assert.equal(px, '24px', 'page restyled to 150% (16px*1.5) after the external change');
    await page.__context.close();
  });
});

// ── splitChunks sanity (used by read-aloud) ──
describe('splitChunks (read-aloud)', () => {
  test('splits oversized text into bounded chunks', async () => {
    const page = await h.newFixture(ARTICLE);
    const ok = await page.evaluate(() => {
      const chunks = window.__a11yTest.splitChunks('x'.repeat(1000), 220);
      return chunks.length > 1 && chunks.every((c) => c.length <= 220);
    });
    assert.ok(ok, 'long text chunked to <=220 chars');
    await page.__context.close();
  });
});
