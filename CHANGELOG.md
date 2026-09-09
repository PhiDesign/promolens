# Changelog

All notable changes to PromoLens. Dates are when the version was tagged.

## Unreleased (0.5.0)

### Added
- Included analyses: deeper analysis works out of the box through the hosted PromoLens service - 20 analyses to start, then 5 a month - identified only by an anonymous install id.
- PromoLens Plus ($4.99/month, 500 analyses/month) via Lemon Squeezy: Upgrade link and licence-key activation in the popup.
- API: `QUOTA_ENABLED` metering per install with a persistent usage file, `GET /api/v1/quota`, `POST`/`DELETE /api/v1/license`, 402 `quota_exceeded`, refunds when the model call fails; `docs/deploy.md`.

## 0.4.0 - 2026-09-09

### Added
- Bring your own key: paste an OpenAI API key in the popup and deeper analysis runs from the extension itself - no server. Optional permission for api.openai.com requested on save; key stored on-device only.
- "Save and test key" with plain-language diagnostics (rejected key, unknown model, no quota).

### Changed
- The language-model witness and the OpenAI client moved into the shared package so the extension, the API and the evaluation harness run the same code.

## 0.3.0 - 2026-09-09

First version prepared for the Chrome Web Store.

### Added
- On-click author history: when you click the button, the author's recent public posts and comments are read (with your own session) to see whether the same product recurs, is reposted, or is described as their own elsewhere. Kept in memory only.
- Feed-card analysis: click the button on a feed card to fetch and score that post without opening it.
- Verdict-first evidence card: *Looks organic*, *Transparent promotion*, *Promotion, disclosed late in the post*, *Promotion, disclosed only in the comments*, *Possible undisclosed promotion* - plus a line naming the technique the promotion is dressed in.
- Optional deeper analysis through your own local API with a language model acting as an evidence witness (quoted claims, capped free-form observations, retractions of rule false positives). The rule engine still computes every score.
- Evaluation harness (`npm run eval`) comparing rules-only, rules + model witness and model-only on labelled posts, with consistency and reach-leak checks.
- Custom icon support (drop PNGs into `apps/extension/public/icons/`).
- Blue ring for clearly disclosed promotion; amber reserved for the uncertain middle.

### Changed
- PromoLens is on-demand only: nothing is analysed until you click. Feed scanning removed.
- The button sits in the post header, left of Reddit's "..." menu, sized and hovered like Reddit's own controls.
- Reach is judged relative to the community's size when known; it never affects the score.
- Multi-word product names ("Advisory Guide") are recognised as one name.
- Disclosure: "we built <Name>" and "a tool we built" count; a bare "my app" only counts when the post is about a product; a disclosure past the midpoint of a long post is reported as *disclosed late*.
- Comment evidence recognises everyday wording ("is this just to sell X?", "spamming again", "of course it's an ad").

### Removed
- The `identity` permission and `oauth.reddit.com` host: the Reddit OAuth path stays in the code but is dormant until a Data API app is approved (see `docs/reddit-compliance.md`).

## 0.2.0 - 2026-09-03

- Initial public commit: rule-based scoring from the PromoLens criteria document, evidence popover, local mock API, tests and documentation.
