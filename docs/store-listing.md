# Chrome Web Store listing (draft for 0.3.0)

Everything the Developer Dashboard asks for, in the order it asks. Copy each block as-is; edit only the parts marked *[you]*.

## Before you start

1. Developer account: <https://chrome.google.com/webstore/devconsole> - one-time registration fee, identity verification can take a few days. Start this first.
2. Build the package: `npm run build`, then zip the *contents* of `apps/extension/dist/` (the manifest must be at the top level of the zip, not inside a folder).
3. Have the privacy policy URL ready: <https://phidesign.github.io/promolens/privacy>

## Store listing tab

**Extension name**
```
PromoLens - is this Reddit post promotional?
```

**Summary** (132 characters max)
```
Click a post to see how promotional it is, whether the author disclosed it, and the evidence. On demand only. Not affiliated with Reddit.
```

**Description**
```
PromoLens helps you tell transparent promotion from possible undisclosed promotion on Reddit - the founder who says "I built this" versus the "workflow" post where one obscure tool gets the only link.

Nothing happens on its own. A small button appears in the header of posts. Click it and PromoLens analyses that post and shows:

- a verdict: Looks organic, Transparent promotion, Promotion disclosed late, or Possible undisclosed promotion
- how the promotion is presented (a personal story that ends at a product, neutral advice that ends at a link, a workflow built around one tool...)
- a promotional-likelihood estimate (0-100), the disclosure status and a confidence level
- up to three reasons, quoted from the post, with links to the source when the evidence comes from elsewhere

Optionally, PromoLens also reads the author's recent public posts and comments (the same pages you could open yourself) to see whether the same product keeps coming back, and it can score a post straight from the feed without opening it. Both are one click, one post, never automatic, and can be switched off.

What it is not: PromoLens never labels people, never reports or hides anything, and never acts on your account. Every result is an estimate based on observable signals and can be wrong. Transparent promotion is treated as fine.

Privacy: analysis runs in your browser. Results are cached on your device for 24 hours and can be cleared with one click. No accounts, no analytics, no data sold, no model training. An optional "deeper analysis" mode can send a post to an analysis server you run yourself; it is off by default. Full policy: https://phidesign.github.io/promolens/privacy

Open source (MIT): https://github.com/PhiDesign/promolens

PromoLens is an independent project and is not affiliated with, approved by, or endorsed by Reddit. Author-history and feed-card reads use Reddit's public pages with your own session; Reddit may rate-limit them.
```

**Category:** Productivity (or "Social & Communication").
**Language:** English.

**Screenshots** (1280x800 or 640x400, up to 5)
1. A post page with the blue "Transparent promotion" card open.
2. A red "Possible undisclosed promotion" card with the technique line and a "source" link.
3. A green "Looks organic" card.
4. A feed with idle buttons on the cards and one scored ring.
5. The popup with the four switches.

**Small promo tile** (440x280) and **icon** (128x128): use the logo from `apps/extension/public/icons/`.

## Privacy practices tab

**Single purpose description**
```
Estimate, on the user's request, whether the Reddit post they are looking at is promotional and whether the author disclosed a connection, and show the evidence.
```

**Permission justifications**

- `storage`:
  ```
  Stores the user's settings and a cache of analysis results (keyed by a content hash, no post text) so the same post is not re-analysed within 24 hours. Users can clear it from the popup.
  ```
- Host permission `https://www.reddit.com/*`:
  ```
  The extension runs only on reddit.com: it reads the post the user opened and inserts the PromoLens button and evidence card. When the user clicks the button, it may also read the author's public profile pages and, for feed cards, that post's page, using the user's own session. Nothing is read without a click.
  ```
- Remote code: **No**. All code is packaged; no scripts are fetched at runtime.

**Data usage** (tick the boxes that apply)

- Collects: *Website content* (the Reddit post and comments the user chose to analyse) - processed locally; sent off-device only if the user enables the optional deeper-analysis mode pointing at their own server. *Personally identifiable information*: No. *Authentication information*: No. *Location*: No. *Web history*: No. *User activity*: No.
- Certifications (all true): not sold to third parties; not used for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL**
```
https://phidesign.github.io/promolens/privacy
```

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch - the link works, it just does not appear in search).
- Regions: all.
- Pricing: free.

## After publishing

- Update the redirect URI in any future Reddit app registration to the store's permanent extension ID.
- Tag the release: `git tag v0.3.0 && git push --tags`.
- Add the store link to the README and the docs site.
