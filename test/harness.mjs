// Test harness: boots a headless browser and loads test fixtures that run the
// REAL extension source (extension/shared.js + extension/content.js) via the
// same chrome-shim the demo uses. Tests therefore exercise the exact code that
// ships — not a copy — so a green suite means the shipped content script works.
import { serve } from '../scripts/static-server.mjs';
import { launch } from '../scripts/launch.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Scripts every fixture loads, in manifest order: shim first (provides chrome.*),
// then shared constants, then the content script. Served from the repo root so
// the tests run extension/*.js directly.
const BOOT_SCRIPTS = [
  '/demo/chrome-shim.js',
  '/extension/shared.js',
  '/extension/content.js',
];

export async function startHarness() {
  const { server, url } = await serve(root);
  const browser = await launch({ headless: true });
  return {
    url,
    browser,
    async close() {
      await browser.close();
      server.close();
    },
    // Open a fresh, isolated page (own storage) whose <body> is `bodyHtml`,
    // with the real content script booted into it. Resolves once the toolbar
    // shadow host has mounted (or `opts.waitForToolbar: false` to skip).
    async newFixture(bodyHtml, opts = {}) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
      });
      // Pre-seed the shim's localStorage (namespace 'a11y-demo:') BEFORE any
      // script runs, so the content script boots with these stored settings —
      // e.g. a site-scoped per-host entry.
      if (opts.seedStorage) {
        await context.addInitScript((seed) => {
          for (const [k, v] of Object.entries(seed)) {
            localStorage.setItem('a11y-demo:' + k, JSON.stringify(v));
          }
        }, opts.seedStorage);
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.__errors = errors;

      const scriptTags = BOOT_SCRIPTS.map((s) => `<script src="${url}${s}"></script>`).join('\n');
      const head = opts.head || '';
      // data-a11y-test opts into the content script's read-only test seam.
      const html = `<!doctype html><html lang="${opts.lang || 'en'}" data-a11y-test="1"><head><meta charset="utf-8">${head}</head>` +
        `<body>${bodyHtml}</body>${scriptTags}</html>`;

      // Load over http (not setContent) so the shim's getURL and relative
      // resource resolution behave like a real navigation.
      await page.route('**/__fixture__', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      );
      await page.goto(`${url}/__fixture__`, { waitUntil: 'domcontentloaded' });

      if (opts.waitForToolbar !== false) {
        await page.waitForFunction(
          () => !!document.getElementById('__a11y-companion-host')?.shadowRoot,
          null,
          { timeout: 8000 }
        );
      }
      page.__context = context;
      return page;
    },
  };
}

// Convenience: run a fn against the toolbar shadow root inside the page.
export const shadowEval = (page, fn, ...args) =>
  page.evaluate(
    ({ fnStr, args }) => {
      const sr = document.getElementById('__a11y-companion-host')?.shadowRoot;
      // eslint-disable-next-line no-new-func
      return new Function('sr', 'args', `return (${fnStr})(sr, ...args)`)(sr, args);
    },
    { fnStr: fn.toString(), args }
  );
