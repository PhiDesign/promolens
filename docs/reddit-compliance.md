# Reddit developer-terms review (draft, not legal advice)

Reviewed on 2026-09-07 against:

- Reddit Developer Terms - effective 24 Sep 2024, last revised 24 Mar 2026
- Reddit Data API Terms - effective 19 Jun 2023, last revised 20 Jul 2026 (incorporated into the Developer Terms; they state they cover content obtained from the Services "whether using the Data APIs or not")

Not yet reviewed: the Developer Data Protection Addendum (Dev 7.1), the Public Content Policy (Dev 4.2), Brand Guidelines. Do those before any public release.

## Summary

| | Personal use (today) | Public release |
| --- | --- | --- |
| Reading public post pages and profile listings via `www.reddit.com/*.json` with the user's session | Negligible risk, but technically not the "authorized Access Info" the terms require | **Blocker** - must use a registered app + OAuth (Dev 1.4, 6; Data API 2.8) |
| Sending post text to a third-party LLM provider for inference | No training, provider does not train on API input, one post per click | **Blocker** unless Reddit permits it, the model runs locally, or the public build ships rules-only (Dev 7.2 "will not share Reddit Services and Data with any third party"; Dev 4.2 / Data API 2.4, 3.2 on AI models) |
| Free, open source, no monetization | OK | OK - stays OK only while non-commercial (Dev 4.1; Data API 3.1, 3.2) |
| Short caches (results 24 h, history 6 h), Clear-cache button | OK | Mostly OK - see encryption at rest |
| History summaries with excerpts stored in extension storage | Unencrypted at rest | Fix: keep excerpts in memory only, or persist hashes/results without content (Dev 7.4) |
| Attribution of quoted evidence | Quotes and subreddit shown, no link back | Fix: link history evidence to permalinks, cite username, say it is from Reddit (Dev 5.2; Data API 4.2) |
| Privacy policy | `docs/privacy.md` draft | Fix: publish at a URL before install; describe deletion (Dev 7.2; Data API 2.6); comply with the DPA (Dev 7.1) |
| Rate limits, no crawling, no surveillance or harassment | On-demand only, one click = one post | OK (Dev 4.2) - keep the on-demand design |
| App review | - | Register the app honestly; Reddit may review at its discretion (Dev 3.1) |

## Actions before a public release

1. Register a Reddit app; move `background/history.ts` and `background/postFetch.ts` to the OAuth Data API (user login, `oauth.reddit.com`, proper User-Agent). Keep the one-click-one-post behaviour.
2. Decide the deeper-analysis story for the public build: rules-only by default; model analysis only as "run your own API" with a local model, or with written permission from Reddit for inference-only use.
3. Do not persist post/comment/history excerpts at rest; keep them in worker memory for the session only, or encrypt.
4. Add permalink links and usernames to evidence lines that quote other posts or comments.
5. Publish the privacy policy at a stable URL; add the deletion instructions; read and comply with the Developer DPA.
6. Read the Public Content Policy and Brand Guidelines; keep "not affiliated with Reddit" wording; "PromoLens for Reddit" is the permitted naming pattern if the Reddit wordmark is ever used.
7. Keep the project non-commercial unless a separate agreement with Reddit exists.

## Where to ask Reddit (from the Developer Terms and the linked help article)

- Reddit's help article "Developer Platform & Accessing Reddit Data" (linked from Developer Terms 4.1) lists what counts as commercial use. It explicitly includes **"Subscription services"** and **"Free product features available for upsell"** - i.e. a free extension with a paid tier is commercial use and needs a contract: "If you're interested in using Reddit data to power, augment, or enhance your product or service for any commercial purposes, you'll need our permission, and we'll require a contract. Please reach out through our contact form."
- **Commercial / API questions contact form:** `https://reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164` (the "contact us" link in the Developer Terms).
- **Non-commercial Data API sign-up:** the "sign-up here" link under "Getting Started" in that article (registers an app; needed for OAuth).
- Eligibility for commercial use "will be determined by the information you provide about your use case and App during Reddit's App Review" - so register the app first, describe it honestly, then ask.

## Why the design already helps

The terms repeatedly penalise crawling, excessive use, retention beyond need, and surveillance. PromoLens analyses one post per explicit click, never scans feeds automatically, keeps only short-lived caches, and phrases every result as an estimate about a post rather than a claim about a person. Those choices are the main reason the remaining work is a migration (OAuth) and a policy decision (model provider), not a redesign.
