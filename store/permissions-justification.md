# Chrome Web Store — permission justifications

The dashboard's **Privacy practices** tab asks you to justify the single purpose
and every permission. Paste these in. They match `extension/manifest.json`
(`permissions: ["storage", "activeTab"]`, `host_permissions: ["<all_urls>"]`).

---

## Single purpose (required)

```
A11y Companion is a single-purpose accessibility tool. Its one purpose is to let users apply personal accessibility and readability adjustments — text size and spacing, a dyslexia-friendly font, color and contrast modes, color-blindness simulations, reading mode, a reading ruler, read-aloud and hover-to-read speech, voice commands, and keyboard navigation — to the web pages they visit.
```

## `storage`

```
Used to save the user's accessibility preferences (text size, font, color mode, speech and reading settings, and per-site choices) and to sync them across the user's own devices via chrome.storage.sync. No browsing data or personal information is stored.
```

## `activeTab`

```
Used only when the user opens the extension's popup, to read the active tab's hostname so the popup can show per-site controls (turn the toolbar off on this site, or give this site its own settings). It is not used to read page content.
```

## Host permission — `<all_urls>` (required justification)

```
The extension is an accessibility toolbar whose entire value is that it works on every website the user visits. It injects the toolbar and applies the user's reading/vision adjustments to the page they are currently viewing. It needs host access to all sites because the user may need accessibility help on any site; it cannot know in advance which sites that will be. The extension does not read, collect, or transmit page content anywhere — page text is only used locally, in the browser, to restyle it or speak it aloud.
```

## Remote code

```
No. The extension executes no remote code. All JavaScript is included in the package. The optional AI features use Chrome's built-in on-device model APIs (Summarizer and Prompt) — they download no code and call no external server.
```

## Are you using the smallest set of permissions necessary?

```
Yes. storage is required to persist settings; activeTab (instead of the broad "tabs" permission) is the minimal way for the popup to read the current host; and <all_urls> is intrinsic to an accessibility tool that must function on any site. Microphone access is requested by the browser at runtime only when the user turns on voice commands.
```

---

### Note on the first review

Extensions that request `<all_urls>` get extra scrutiny and the first review can
take longer (sometimes a week or more), occasionally with a clarification email.
The privacy policy URL is **required** because of the broad host permission —
make sure it is live (see `submission-checklist.md`) before submitting.
