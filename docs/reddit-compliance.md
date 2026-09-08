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

1. Register a Reddit app; move `background/history.ts` and `background/postFetch.ts` to the OAuth Data API (user login, `oauth.reddit.com`). Keep the one-click-one-post behaviour. **Built 2026-09-07, dormant:** `background/redditAuth.ts` implements the installed-app OAuth flow (code grant, permanent refresh token, silent refresh, revoke on logout) and `dataApiFetch` routes the existing fetchers through `oauth.reddit.com`; the popup shows "Log in with Reddit" once `REDDIT_CLIENT_ID` in `apps/extension/src/shared/redditApp.ts` is filled in after Reddit's approval. Known limitation: a browser extension cannot set a custom `User-Agent` on fetch; document this in the access request if Reddit asks.
2. Decide the deeper-analysis story for the public build: rules-only by default; model analysis only as "run your own API" with a local model, or with written permission from Reddit for inference-only use.
3. ~~Do not persist post/comment/history excerpts at rest~~ - done 2026-09-07: history summaries and fetched post pages live in worker memory only; only hashed results are stored.
4. ~~Add permalink links and usernames to evidence lines that quote other posts or comments~~ - done 2026-09-07: history evidence names `u/<author>` and carries a "source" link to the post.
5. Publish the privacy policy at a stable URL; add the deletion instructions; read and comply with the Developer DPA.
6. Read the Public Content Policy and Brand Guidelines; keep "not affiliated with Reddit" wording; "PromoLens for Reddit" is the permitted naming pattern if the Reddit wordmark is ever used.
7. Keep the project non-commercial unless a separate agreement with Reddit exists.

## Where to ask Reddit (from the Developer Terms and the linked help article)

- Reddit's help article "Developer Platform & Accessing Reddit Data" (linked from Developer Terms 4.1) lists what counts as commercial use. It explicitly includes **"Subscription services"** and **"Free product features available for upsell"** - i.e. a free extension with a paid tier is commercial use and needs a contract: "If you're interested in using Reddit data to power, augment, or enhance your product or service for any commercial purposes, you'll need our permission, and we'll require a contract. Please reach out through our contact form."
- **Commercial / API questions contact form:** `https://reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164` (the "contact us" link in the Developer Terms).
- **Non-commercial Data API sign-up:** the "sign-up here" link under "Getting Started" in that article (registers an app; needed for OAuth).
- Eligibility for commercial use "will be determined by the information you provide about your use case and App during Reddit's App Review" - so register the app first, describe it honestly, then ask.

## Responsible Builder Policy (read 2026-09-07)

Shown by Reddit before app creation. Points that matter for PromoLens:

- **"Approval is required: You must request access and get explicit approval before accessing any Reddit data through our API."** Creating an app is no longer enough; Data API access is granted on request. Non-commercial developers are pointed at Devvit first; "if your use case is not supported by Devvit, file a ticket" - a browser extension is such a case.
- **Transparency:** do not misrepresent why you access data; one account, one request per use case.
- **Zero tolerance for privacy violations:** never process data "to derive or infer potentially sensitive characteristics about Reddit users (e.g., health, political affiliation, sexual orientation)" or re-identify users. PromoLens infers properties of a *post* (promotional, disclosed) and observable posting behaviour (the same product recurring), never personal characteristics; keep it that way and say so in the request and the privacy policy.
- **No unapproved commercialization or AI training** - restated; consistent with the review above.
- **Apps must register and create a developer profile** for an app label; app accounts must be single-purpose (not relevant while PromoLens acts as the logged-in user rather than as its own account).

Consequence: the OAuth migration depends on an approved access request, not just on a client ID. Submit the non-commercial request first; keep the paid-tier question for a separate, later ticket, but do not hide the intent.

## Access request log

- **2026-09-07 - request #18416631 submitted** (non-commercial Data API access, developer form, "app not supported by Devvit").
- **2026-09-07 - denied** the same day, form reply: "not in compliance with Reddit's Responsible Builder Policy and/or lacks necessary details." No specifics given.
- Likely weaknesses of that submission, to fix before resubmitting: (1) the source-code link pointed at a private repository (404 for the reviewer); (2) no registered app / client id was referenced; (3) the description mentioned an optional third-party language-model provider - a reviewer reads that as sharing Reddit data with a third party; (4) "reads the author's recent public posts and comments" can read as user profiling under the "zero tolerance for privacy violations" section unless framed as spam/repeat-promotion detection of the *post's author* only; (5) no public privacy policy URL.
- Plan: public repo + privacy policy page + registered app first; describe the public build as rules-only in the browser (no third party), with the history check framed precisely; then resubmit. Personal use is unaffected (page-session reads continue).
- **2026-09-08** - repository made public; docs published at <https://phidesign.github.io/promolens/> (privacy policy at `/privacy`).

## Resubmission text (second request)

Fill in the app name / client id before sending. Keep every sentence true of the public build.

> **Benefit for Redditors.** PromoLens helps readers tell transparent promotion from possible undisclosed promotion. Many posts in communities such as r/SaaS or r/Entrepreneur are product pitches dressed as stories or advice. On the reader's request, PromoLens shows an estimate of how promotional a post is, whether the author disclosed a connection, and the observable evidence, quoted from the post. It treats an openly disclosed founder post as fine and never makes claims about a person - only about a post. Free, open source (MIT): https://github.com/PhiDesign/promolens. Privacy policy: https://phidesign.github.io/promolens/privacy.
>
> **What the app does on Reddit.** It is a Chrome extension that runs entirely in the reader's browser. It never posts, votes, comments, or messages, and does nothing automatically. When the reader clicks a button on a post, it reads that one post (title, body, links, top-level comments) and the post author's recent public submissions and comments - the same pages anyone can open - through the Data API with the reader's own OAuth login (read-only scopes: identity, read, history). A rule engine in the browser then scores the post. The author history is used for one purpose: to see whether the same product is being posted repeatedly across communities (repeat promotion / spam). PromoLens does not infer anything about people - no sensitive characteristics, no identity matching, no profiling beyond "this product recurs in this author's posts". Results are shown as estimates (e.g. "possible undisclosed promotion", "transparent promotion") with quoted evidence and links back to the source posts. Nothing is stored on any server; results are cached in the browser for 24 hours by content hash and can be cleared with one click; post text is never written to disk. No data is sold, shared, or used to train any model. Volume: about four API requests per click, a few dozen per user per day.
>
> **Example.** A post titled "My exact content workflow" that names five tools and links only one, with a referral code, by an author whose public posts mention that tool in five communities, is shown as "Possible undisclosed promotion" with those three facts as reasons. A post saying "I'm the founder, here is the link" is shown as "Transparent promotion". A balanced comparison with no links is shown as "Looks organic".
>
> **Why not Devvit.** PromoLens must annotate any post the reader is viewing, in the reader's own browser, on the reader's request, without moderator installation and without acting as its own account. Devvit apps are installed per subreddit by moderators and render inside Reddit's app surfaces; they cannot add a control to arbitrary post pages in the reader's browser.
>
> **Subreddits.** None specifically - it acts only on the post the reader clicks. **Operating username.** None; it acts as the logged-in reader. **App.** [name / client id].

Do not mention the optional language-model API in this request: it is a developer-only feature, off by default, that runs against a server the developer hosts; it is not part of the public build's Reddit data flow.

## Why the design already helps

The terms repeatedly penalise crawling, excessive use, retention beyond need, and surveillance. PromoLens analyses one post per explicit click, never scans feeds automatically, keeps only short-lived caches, and phrases every result as an estimate about a post rather than a claim about a person. Those choices are the main reason the remaining work is a migration (OAuth) and a policy decision (model provider), not a redesign.
