# Chrome Web Store — listing copy

Copy/paste these fields into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
when creating the item. Character limits are noted where the store enforces them.

---

## Item name  (max 75 chars)

```
A11y Companion — Accessibility Toolbar
```

## Summary / short description  (max 132 chars)

```
A personal accessibility toolbar for every site: dyslexia font, color & contrast modes, reading mode, read-aloud, and voice control.
```

## Category

```
Accessibility
```

## Language

```
English (United States)
```

---

## Detailed description  (max 16,000 chars)

```
A11y Companion is a personal accessibility toolbar that works on ANY website. Install it once and it follows you across the web, applying your reading and vision preferences on every page.

This isn't only for blind users. It's for anyone with dyslexia, ADHD, low vision, color blindness, light sensitivity, aging eyes — or anyone who simply wants the web to be easier to read.

▶ TRY IT LIVE (no install): https://luis-avalos1.github.io/accessibility-plugin/

— TEXT & READING —
• Bigger text & spacing — adjust font size, letter spacing, and line height. Size scales the site's own root font, so layouts don't break.
• Dyslexia-friendly font — switch the whole page to OpenDyslexic in one tap.
• Reading mode — strip a page down to just the article, dim everything else, and reflow it into a clean, centered column.
• Reading ruler — a focus band that follows your pointer and dims the rest, so you never lose your line.
• Reduce motion — freeze animations and pause autoplaying video.

— COLOR & VISION —
• Color modes — grayscale, invert / dark, and high contrast.
• True color-blindness simulations — protanopia, deuteranopia, and tritanopia, built on real color-matrix filters (great for people who need them and for designers checking their work).

— SPEECH & CONTROL —
• Screen reader (hover to read) — point at anything and hear the text under your cursor.
• Read page aloud — hear the main content in sentence-sized chunks with a moving highlight, plus pause / resume / skip controls.
• Voice commands — go hands-free: "scroll down", "reading mode", "read page", even "click sign in".
• Keyboard navigation — walk every link and button with the arrow keys and a visible focus ring; press Enter to activate.

— PERSONALIZATION —
• Presets — one-tap starting points: Dyslexia, Low vision, ADHD / Focus, Light sensitivity.
• Per-site settings — turn the toolbar off on a site, or give a site its own settings.
• Cross-device sync — change a setting once and it follows you to every site and every Chrome you're signed in to.

— ON-DEVICE AI (experimental) —
• Summarize page and Simplify selection use Chrome's built-in on-device model (Chrome 138+ on supported hardware). Text is processed entirely on your own device — no servers, no API keys.

— PRIVACY —
A11y Companion has no servers and no analytics. It stores only your accessibility settings (via Chrome sync) and never collects names, browsing history, page content, or any personal data. The broad site access exists solely so the toolbar can work on every site you visit. Full policy: https://luis-avalos1.github.io/accessibility-plugin/privacy.html

— SHORTCUTS —
• Alt+Shift+A — toggle the toolbar
• Alt+Shift+S — toggle the hover-to-read screen reader
• Alt+Shift+R — toggle reading mode
(Rebind at chrome://extensions/shortcuts)

Open source (MIT): https://github.com/Luis-avalos1/accessibility-plugin
```

---

## Store assets to upload

| Asset                | File                                                | Size       | Required |
| -------------------- | --------------------------------------------------- | ---------- | -------- |
| Store icon           | `extension/icons/icon128.png`                       | 128×128    | yes      |
| Screenshots (1–5)    | `store/screenshots/01..05-*.png`                    | 1280×800   | ≥1       |
| Small promo tile     | `store/promo/small-tile-440x280.png`                | 440×280    | optional |
| Marquee promo tile   | `store/promo/marquee-1400x560.png`                  | 1400×560   | optional |

Recommended screenshot order for the store (the first is the thumbnail):
1. `01-toolbar.png` — one toolbar, every website
2. `02-readable-text.png` — dyslexia font + bigger text
3. `03-reading-mode.png` — reading mode
4. `04-high-contrast.png` — dark / high contrast
5. `05-colorblind.png` — color-blindness filters

(`06-read-aloud.png` and `07-ai-summary.png` are extras — swap any in, or use them in the README / portfolio.)

> **Before publishing:** set the real Chrome Web Store URL in `demo/demo.js` (`STORE_URL`)
> and in this file's links once the listing is live.
