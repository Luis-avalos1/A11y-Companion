# Privacy Policy — A11y Companion

_Last updated: June 11, 2026_

A11y Companion is a browser extension that adds a personal accessibility toolbar to web
pages. This policy explains what the extension does and does not do with your data.

## Summary

A11y Companion does **not** collect, transmit, sell, or share any personal data. The
extension has no servers and no analytics. Everything it does happens locally in your
browser.

## What the extension stores

The extension saves only your **accessibility preferences**, such as:

- Whether the toolbar is shown or hidden
- Text size, letter spacing, and line height
- Dyslexia-friendly font on/off
- Color mode (grayscale, invert, high contrast, colorblind simulations)
- Screen reader, voice commands, keyboard navigation, and reading mode toggles
- Reading ruler, reduce motion, speech voice/rate, and voice recognition language
- Per-site preferences (only the hostname of sites where you turn the extension
  off or use site-specific settings — never full URLs or page content)

These settings are stored using Chrome's built-in `chrome.storage.sync` so they can follow
you across your own devices when you are signed in to Chrome. This data stays within your
Google/Chrome account and is never sent to the developer or any third party.

The extension does **not** collect names, email addresses, browsing history, page content,
form data, passwords, or any other personally identifiable information.

## Microphone

If you turn on **voice commands**, the extension uses your browser's built-in Web Speech
API to listen for commands. Speech recognition is handled by the browser; the extension
receives only the recognized text in order to act on a command (for example, "scroll
down"). Audio is not recorded, stored, or sent to the developer. You can turn voice
commands off at any time, and the browser will ask for microphone permission before
listening.

## Page content

Accessibility features such as reading mode and the screen reader read text directly on the
page you are viewing, in your browser, to apply styling or speak it aloud. This page content
is never stored or transmitted anywhere.

## On-device AI (summaries and plain-language rewrites)

The summarize and simplify features use **Chrome's built-in on-device AI model** (available
in Chrome 138 and newer on supported devices). The page text or selection being summarized
is processed entirely on your own computer by the browser's local model. It is not sent to
the developer or to any server by the extension. If your browser does not include the
on-device model, these features simply report that they are unavailable — there is no
cloud fallback.

## Permissions

The extension requests broad host access (`<all_urls>`) only so that the accessibility
toolbar can work on every website you choose to visit. It does not use this access to read
or send your data anywhere. The `activeTab` permission lets the popup show per-site
controls for the tab you have open.

## Third parties

A11y Companion uses no third-party analytics, advertising, or tracking services.

## Changes to this policy

If this policy changes, the updated version will be posted at this URL with a new "last
updated" date.

## Contact

Questions about this policy can be sent to: avaloseluis@gmail.com
