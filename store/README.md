# Chrome Web Store assets

Everything needed to publish A11y Companion. Start with **`submission-checklist.md`**.

| File                            | What it's for                                              |
| ------------------------------- | --------------------------------------------------------- |
| `submission-checklist.md`       | Step-by-step submission walkthrough (start here)          |
| `listing.md`                    | Item name, summary, detailed description, asset list      |
| `permissions-justification.md`  | Single-purpose + per-permission justifications            |
| `privacy-data-disclosures.md`   | Data-usage checklist answers + privacy policy URL         |
| `screenshots/`                  | 1280×800 store screenshots (`01..07-*.png`)               |
| `promo/`                        | Small tile (440×280) and marquee (1400×560)               |

The upload package itself is built separately into `../dist/` with `npm run build`.

Regenerate the screenshots and promo tiles any time with `npm run screenshots`
(or the whole asset set — video included — with `npm run assets`).
