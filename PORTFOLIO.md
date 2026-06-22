# A11y Companion — portfolio case study

A ready-to-adapt writeup for your portfolio. Swap in your real links once the
extension is published and GitHub Pages is live.

- **Live demo (no install):** https://luis-avalos1.github.io/accessibility-plugin/
- **Source:** https://github.com/Luis-avalos1/accessibility-plugin
- **Chrome Web Store:** _add the listing URL once published_
- **Role:** Solo — design, engineering, and packaging
- **Stack:** Manifest V3 Chrome extension · vanilla JS · Shadow DOM · Web Speech API · Chrome built-in (on-device) AI

---

## One-liner

A personal accessibility toolbar that works on **any** website — and a live,
zero-install demo of it running on a real page, recorded end to end.

## The problem

Most of the web ships small, low-contrast, tightly packed text. For readers with
dyslexia, low vision, color blindness, ADHD, or light sensitivity, that turns
ordinary pages into walls. Waiting for every site to fix itself isn't a plan, so
A11y Companion flips the model: the **reader** carries their preferences and
applies them to whatever page they land on.

## What I built

A Manifest V3 extension that injects an accessibility toolbar into every page and
adjusts it live:

- **Reading & text** — text size and spacing that scale the site's own root font
  (so rem layouts survive), a one-tap OpenDyslexic font, a reading mode that
  strips a page to its article, a pointer-following reading ruler, and reduce-motion.
- **Color & vision** — grayscale, invert/dark, high contrast, and **true
  color-blindness simulations** (protanopia/deuteranopia/tritanopia) built on SVG
  `feColorMatrix` filters rather than `hue-rotate` hacks.
- **Speech & control** — hover-to-read screen reading, chunked read-aloud with a
  moving highlight and pause/skip, voice commands (including "click <text>"), and
  arrow-key navigation with a visible focus ring.
- **Personalization** — presets, per-site settings, and cross-device sync via
  `chrome.storage.sync`.
- **On-device AI** — summarize/simplify using Chrome's built-in Gemini Nano;
  page text never leaves the device.

## The interesting engineering

- **Shadow-DOM toolbar** so host-page CSS can't break it, and the page's CSS
  can't leak in.
- **Do-no-harm styling** — nothing is emitted at default values, so an idle
  toolbar never restyles a page; spacing only targets inheritable parents to
  avoid breaking icon fonts and flex layouts.
- **SPA-resilient** — patches `history.pushState/replaceState` and uses a
  `MutationObserver` to re-apply reading mode and re-attach the toolbar after
  client-side navigation.
- **Orphan-safe** — when the extension reloads, already-running content scripts
  detect the severed context and go quiet instead of throwing.
- **A live demo that runs the *real* code.** A Chrome extension normally can't
  run on a plain website, so I wrote a ~150-line `chrome.*` shim (backed by
  `localStorage`) that lets the **unmodified** content script run on a normal
  page. The demo isn't a reimplementation — it's the shipping code, so it can't
  drift from the extension.
- **Automated demo capture.** A Playwright harness drives the same guided tour a
  visitor sees, records it to MP4/WebM, and generates the 1280×800 Chrome Web
  Store screenshots and promo tiles — all reproducible with `npm run assets`.

## Demo video

```html
<!-- Self-hosted MP4 with WebM fallback and a poster -->
<video controls playsinline poster="poster.png" style="width:100%;border-radius:12px">
  <source src="a11y-companion-demo.mp4" type="video/mp4">
  <source src="a11y-companion-demo.webm" type="video/webm">
</video>
```

Files: `demo/assets/a11y-companion-demo.mp4` (~90s, 1280×800), `.webm`, and
`poster.png`. For GitHub, you can drag the MP4 into a README or a release and
embed the resulting URL.

## Screenshots

`store/screenshots/01..07-*.png` — toolbar on a real page, dyslexia/readable
text, reading mode, high contrast, color-blindness filters, read-aloud, and
on-device AI.

## What I'd do next

Draggable toolbar with remembered position, colorblind **correction**
(daltonization), more bundled fonts (Atkinson Hyperlegible, Lexend), AI alt-text
for images, and a Firefox build.
