# A11y Companion

A personal accessibility toolbar that works on **any** website. Install it once and it
follows you across the web, applying your reading and vision preferences on every page.

> This is not just for blind users. It is for anyone with dyslexia, ADHD, low vision,
> color blindness, light sensitivity, aging eyes, or anyone who simply wants the web to
> be easier to read.

---

## Features

### Text & reading

- **Text size and spacing** — adjust font size, letter spacing, and line height. Size
  scales the site's own root font size instead of overwriting it, so rem-based layouts
  survive; nothing is emitted at default values, so an idle toolbar never restyles a page.
- **Dyslexia-friendly font** — switch the whole page to OpenDyslexic.
- **Reading mode** — strips a page down to its main content. It finds the main article
  (`<main>`, `[role="main"]`, `<article>`, or the largest text block), dims everything
  else, and reflows the content into a clean, centered reading column.
- **Reading ruler** — a line-focus band that follows your pointer and dims the rest of
  the page. Height is configurable in options.
- **Reduce motion** — freezes CSS animations/transitions and pauses autoplaying videos.

### Color

- **Color modes** — grayscale, invert/dark, high contrast, plus real `feColorMatrix`
  simulations of protanopia, deuteranopia, and tritanopia. High-contrast mode keeps
  floating UI (menus, modals) on solid backgrounds so it stays readable.

### Speech

- **Screen reader (hover to read)** — point your mouse at anything; after a short
  (configurable) pause it speaks the text under the cursor. It climbs to the nearest
  control so buttons read their accessible name, reads genuine text blocks in full, and
  stays quiet over empty layout containers.
- **Read page aloud** — reads the main content in sentence-sized chunks with a moving
  highlight, with pause / resume / skip controls on the toolbar and by voice. Chunking
  also works around Chrome's notorious stall on long utterances.
- **Speech settings** — pick the voice and speaking rate in options.
- **Read page info** — speak the current page title and site on demand.

### Control

- **Voice commands** — control the page hands-free (see the list below). Recognition
  language is configurable; command matching is whole-word so ordinary speech doesn't
  misfire.
- **Keyboard navigation** — walk focusable elements with the arrow keys and a visible
  focus ring; press Enter to activate.
- **Keyboard shortcuts** — `Alt+Shift+A` toolbar, `Alt+Shift+S` screen reader,
  `Alt+Shift+R` reading mode (rebindable at `chrome://extensions/shortcuts`).

### Personalization

- **Presets** — one-tap starting points in options: Dyslexia, Low vision, ADHD/Focus,
  Light sensitivity.
- **Per-site settings** — from the popup: turn the extension off on a site entirely, or
  give a site its own settings (seeded from your current setup).
- **Cross-site sync** — change a setting once and it follows you to every site and every
  Chrome install, via `chrome.storage.sync`.

### On-device AI (experimental)

- **Summarize page** (✨ toolbar button or say "summarize") — key-points summary using
  Chrome's built-in Gemini Nano model.
- **Simplify selection** (say "simplify") — rewrites the selected text in plain language.

Both run **entirely on your device** via Chrome's built-in AI APIs (Chrome 138+ on
supported hardware; the model downloads once on first use). No API keys, no servers —
if the model isn't available, the features say so and do nothing else.

### Voice commands

When voice commands are on, the toolbar listens for:

- "scroll down" / "scroll up", "top of page" / "bottom of page"
- "read page", "stop reading", "pause", "resume", "next paragraph" / "previous paragraph"
- "summarize", "simplify" (on-device AI)
- "where am I", "page info", "read url"
- "bigger text" / "smaller text", "reading mode", "ruler", "reduce motion"
- "dark mode", "high contrast", "default colors"
- "go back" / "go forward", "reload"
- "next" / "previous" (move keyboard focus — exact word only)
- "click [text]" — for example "click sign in" activates a matching link or button

---

## Install (development)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` directory.

### Using it

- The toolbar appears as a horizontal bar along the bottom of every page.
- Press **Alt + Shift + A** to toggle the toolbar.
- Click the extensions (puzzle-piece) icon, then **A11y Companion**, for the popup:
  global show/hide, reset, per-site controls, and a link to the full settings page.
- The options page (popup → **All settings…**) holds presets, speech and voice settings,
  the reading-ruler height, reduce motion, and the per-site list.

After changing any code, click the reload icon on the extension card in
`chrome://extensions`, then reload any open tabs so they pick up the new content script.

---

## Architecture

```
extension/
├── manifest.json   # Manifest V3, runs on <all_urls>
├── shared.js       # Defaults, storage keys, presets — loaded by every context
├── content.js      # Toolbar and all features, inside a Shadow DOM
├── background.js   # Service worker: defaults, keyboard commands, on-device AI bridge
├── popup.html/.js  # Browser action popup (global + per-site controls)
├── options.html/.js# Full settings page
├── fonts/          # OpenDyslexic woff2
└── icons/          # 16 / 48 / 128 PNGs
```

The toolbar lives in a **Shadow DOM** so host-page CSS cannot break it. Settings persist
via `chrome.storage.sync`; per-site entries are stored as `site:<hostname>` items next to
the global keys. Every context reconciles live through `storage.onChanged`, so changes
made in the popup, the options page, a keyboard shortcut, or another device take effect
immediately in open tabs.

### Single-page app support

Most modern sites are single-page apps. The content script:

- Patches `history.pushState` / `replaceState` to detect client-side navigation (and
  ignores the no-op `replaceState` calls sites make for scroll/analytics state).
- Uses a `MutationObserver` to re-apply reading mode, re-attach the toolbar and ruler,
  re-mark high-contrast surfaces, and re-pause autoplaying media after route changes.

### Resilience

When the extension is reloaded, updated, or disabled, content scripts already running in
open tabs become orphaned and their `chrome.*` APIs are severed. The content script detects
this ("Extension context invalidated") and goes quiet — it stops its observers and
listeners instead of throwing errors. It also removes any stale style elements a previous
orphaned script left behind before measuring the page. The next fresh page load runs
cleanly.

---

## Publishing to the Chrome Web Store

### 1. Package the extension

Create a zip of the **contents** of `extension/` (the `manifest.json` must sit at the root
of the zip, not inside a nested folder):

```sh
cd extension
zip -r ../a11y-companion.zip . -x "*.DS_Store"
```

### 2. Register as a developer

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Pay the one-time **$5** developer registration fee (covers the account, not per item).

### 3. Create the listing

1. Click **Add new item** and upload the zip.
2. Fill in the listing details:
   - Description (the manifest description is a good starting point).
   - Category: **Accessibility**.
   - At least one **screenshot** (1280x800 or 640x400).
   - The 128x128 store icon (included).
3. Complete the **Privacy practices** tab:
   - Declare data usage. This extension stores only user settings in
     `chrome.storage.sync` and collects no personal data.
   - Justify the broad permissions. The toolbar requests `<all_urls>` because it must run
     on every site the user visits to provide accessibility features.
   - Add a privacy policy URL (required when requesting broad host permissions) — see
     `PRIVACY.md`.

### 4. Submit for review

Submit and wait for review. Extensions that request `<all_urls>` typically get extra
scrutiny, so the first review can take longer than usual and may include a clarification
request. Each new upload must use a higher `version` number in `manifest.json`.

---

## Permissions

| Permission   | Why it is needed                                                          |
| ------------ | ------------------------------------------------------------------------- |
| `storage`    | Persist and sync the user's accessibility settings.                       |
| `activeTab`  | Let the popup show per-site controls for the tab you have open.           |
| `<all_urls>` | The toolbar must work on every website the user visits.                   |

The extension also requests microphone access at runtime (via the Web Speech API) only
when voice commands are turned on. The experimental AI features use Chrome's built-in
on-device model; page text never leaves the device.

---

## Project history

This started as a college capstone project: a WordPress accessibility plugin built for
[Lasagna Love](https://lasagnalove.org/). That organization is no longer using it, so the
project has been rebuilt and refocused as a standalone Chrome extension that works on any
site. Along the way it gained:

- A Shadow-DOM toolbar that host-page CSS cannot break.
- Real colorblind filters using SVG `feColorMatrix` instead of `hue-rotate` hacks.
- A reworked reading mode that handles nested modern layouts.
- Hover-to-read screen reading that follows the mouse.
- Chunked read-aloud with pause/resume/skip and a moving highlight.
- A reading ruler, reduce-motion mode, presets, and per-site settings.
- Voice commands, including "click [text]" for hands-free activation.
- Cross-site settings sync via `chrome.storage.sync`.
- Experimental on-device AI summaries and plain-language rewrites.

---

## Roadmap

- Real, designed PNG icons and store screenshots.
- Draggable toolbar with remembered position.
- Colorblind **correction** (daltonization) filters alongside the simulations.
- More bundled fonts (Atkinson Hyperlegible, Lexend).
- AI-powered alt text for images (Prompt API multimodal).
- Firefox build (the manifest is largely compatible).
- Build tooling, lint, and an automated extension test harness.

---

## License

MIT
