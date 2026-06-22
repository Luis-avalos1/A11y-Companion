# Chrome Web Store — data-usage disclosures

Answers for the **Privacy practices → Data usage** section of the dashboard.

## Privacy policy URL (required)

```
https://luis-avalos1.github.io/accessibility-plugin/privacy.html
```

This URL must be live before you submit. It is served by GitHub Pages from
`demo/privacy.html` (see `submission-checklist.md`). The source is `PRIVACY.md`.

---

## "What user data do you plan to collect?"

Leave **every** category UNCHECKED. A11y Companion collects none of them:

- ☐ Personally identifiable information
- ☐ Health information
- ☐ Financial and payment information
- ☐ Authentication information
- ☐ Personal communications
- ☐ Location
- ☐ Web history
- ☐ User activity
- ☐ Website content

> The extension stores only the user's own accessibility **settings** (text
> size, font, color mode, speech/reading preferences, and per-site choices) via
> `chrome.storage.sync`. These are configuration values, not collected user
> data, and they never leave the user's Google/Chrome account. Page text read by
> reading mode / read-aloud / the on-device AI is processed locally and is never
> stored or transmitted.

---

## Certifications (check all three)

- ☑ I do **not** sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do **not** use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do **not** use or transfer user data to determine creditworthiness or for lending purposes.

---

## Notes for the reviewer (optional "remote code" / data fields)

- **Remote code:** none. All code ships in the package.
- **Microphone:** requested by the browser at runtime only when the user enables
  voice commands; audio is handled by the browser's Web Speech API and is never
  recorded, stored, or transmitted by the extension.
- **On-device AI:** uses Chrome's built-in model (Summarizer + Prompt APIs);
  no data leaves the device and there is no cloud fallback.
