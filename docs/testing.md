# Testing PromoLens

## Automated tests

```bash
npm test            # run everything once
npm run test:watch  # re-run on change
npm run check       # typecheck + tests + build
```

Framework: [vitest](https://vitest.dev). DOM tests run in jsdom and opt in with a `// @vitest-environment jsdom` comment.

| File | Covers |
| --- | --- |
| `packages/shared/test/scoring.test.ts` | clamping 0-100, category caps, style-only cap, correlation discount, counter-signals, clear/missing/unclear/unknown disclosure, reach separate from promotion, high upvotes alone never raise the score, comment accusations (+2 max, independent concerns, coordinated -> no points + lower confidence, unverified linked post discounted, author admission), confidence rules, three reasons max |
| `packages/shared/test/detectors.test.ts` | each local detector: calls to buy/register/download, waitlist, coupon/referral, affiliate URL params, redirect domains, DM requests, "comment interested", product links vs Reddit/general hosts, repeated naming, story arc, workflow insertion, marketing/testimonial language, clear and unclear disclosure, Brand Affiliate label, limitations/alternatives, useful-without-links, availability notes |
| `packages/shared/test/schemas.test.ts` | request/response schema validation (example request accepted, missing title, oversized body, out-of-range score, unknown enum values, >3 reasons) |
| `packages/shared/test/hash.test.ts` | deterministic hashing; content changes rehash; vote changes do not |
| `apps/api/test/server.test.ts` | health, valid analyze -> schema-valid, cache hit on repeat, 400/413/415/404, CORS allow/deny + preflight, 429 rate limit |
| `apps/api/test/cache.test.ts` | memory cache expiry/eviction/clear, rate limiter window |
| `apps/extension/test/adapter.test.ts` | extraction from sanitized fixtures, links/domains, ring mounting with the title slot, stable keys, detail URL detection, end-to-end fixture scores (organic, transparent founder, undisclosed workflow, high-upvote organic) |
| `apps/extension/test/adapter-detail.test.ts` | comment extraction on a detail page, OP flagging, unsupported accusation stays minimal |
| `apps/extension/test/scanner.test.ts` | one ring per post, no duplicates on repeated scans, dynamically inserted post detected via MutationObserver, removed posts cleaned up, stop removes everything, IntersectionObserver gating |
| `apps/extension/test/cache.test.ts` | chrome.storage-style cache: 24 h expiry, TTL change at read time, pruning, clear keeps settings |
| `apps/extension/test/queue.test.ts` | concurrency limit, duplicate keys, cancellation of pending/running tasks, priority, error isolation |
| `apps/extension/test/apiClient.test.ts` | validated results, malformed/non-JSON/HTTP errors, unreachable server, max two concurrent, timeout |

### Fixtures

`apps/extension/test/fixtures/` contains **sanitized, synthetic HTML** modelled on `www.reddit.com` markup. None of it is live Reddit content; do not add real posts, usernames or comments to committed fixtures.

| Fixture | Represents |
| --- | --- |
| `organic-advice.html` | genuine advice, limitations discussed, no links |
| `founder-transparent.html` | "I'm the founder" + product link + limitation |
| `undisclosed-workflow.html` | multi-tool workflow where only one obscure tool is linked (with a referral parameter), no disclosure |
| `high-upvote-organic.html` | organic PSA with 24k upvotes |
| `accused-comments.html` | detail page; one unsupported "this is an ad" comment; author answers publicly |
| `dynamic-insert.html` | feed plus a `<template>` the scanner test inserts later (scanner is generic; the extension only points it at the main post of a post page) |

## Debugging on a live page

The content script prints `[PromoLens]` lines to the page console at the *Verbose* level (open DevTools > Console > set the level filter to include "Verbose"): ring attached, queued, extracted, local result, cache lookup, enrich. Warnings appear for anything unexpected.

Two things that look like bugs but are not:

- **Rings stay gray in a background tab.** Chrome does not fire `IntersectionObserver` for hidden tabs, so no post is ever "near the viewport" until the tab is in the foreground. Switch to the tab and the queue drains.
- **Reloading the extension orphans open tabs.** After clicking reload in `chrome://extensions`, content scripts in already-open Reddit tabs can no longer reach the new worker. Reload the Reddit tab too.

## Manual test checklist

Build (`npm run build`), load `apps/extension/dist` unpacked, then walk through:

### Feeds
- [ ] Home, subreddit and search feeds: each card gets an idle **?** in its header (left of "..."); nothing is analysed until a click (no `[PromoLens] analyse requested` lines in the console while scrolling).
- [ ] Click a card's **?**: the page does **not** navigate; the ring animates, then shows the verdict; the console shows `fetched post page` with body and comment counts.
- [ ] Open that post afterwards: the post page's button shows the same result immediately (cache).
- [ ] Switch **Also show it on feed cards** off: feed buttons disappear; post pages still get one.
- [ ] Click many cards quickly: if Reddit rate-limits, the ring shows the gray error state with a "wait a minute" label instead of hanging.

### Post page
- [ ] Open any post: a gray dashed **?** appears beside the `<h1>` title within ~1 s; related posts further down get nothing.
- [ ] Hover the **?**: a card explains what clicking does; move away: it closes.
- [ ] Click (or Tab to it and press Enter): the ring animates, then shows a colour and number within ~1 s (local rules).
- [ ] With deeper analysis on and the API running: the ring updates again within a few seconds; the popover footer reads "Rules + language model (...)".
- [ ] With deeper analysis off: footer reads "Local rules only."
- [ ] Reload the page and click again: result appears immediately (cache).

### Client-side navigation
- [ ] From a feed, click into a post (no reload): the **?** appears; go back: it is removed and nothing appears on the feed.
- [ ] Navigate directly from one post to another (e.g. related posts): the old button is gone, the new post gets an idle **?**, not a stale score.

### Light and dark themes
- [ ] Toggle Reddit's theme: ring colours and popover background/text remain readable in both.
- [ ] The popover picks up the current theme when opened after a theme change.

### Hover, click, focus and keyboard
- [ ] Hover a ring: popover opens; move away: it closes.
- [ ] Click a ring: popover stays open; click again or click elsewhere: it closes.
- [ ] Clicking the ring does **not** open the post.
- [ ] Tab to a ring: it shows a visible focus outline and the popover opens; Tab away: it closes.
- [ ] Enter/Space on a focused ring pins the popover; Escape closes it and returns focus to the ring.
- [ ] Screen reader (VoiceOver: Cmd+F5) reads "PromoLens estimate: NN% ..., ... confidence, ..." on the ring, and `aria-expanded` toggles.

### Popover contents
- [ ] Shows, in this order: the verdict line (Looks organic / Transparent promotion / Promotion with an unclear connection / Possible undisclosed promotion), the "presented as..." technique line when promotional, percentage + label + confidence, disclosure line, up to three reasons, the source/estimate sentence - nothing else.
- [ ] When history shows the author calling the product their own elsewhere but the post does not, the technique line starts with "Elsewhere the author describes this as their own product".
- [ ] A clearly disclosed founder post shows a blue ring, "Transparent promotion", "Connection disclosed by author", and a high percentage.
- [ ] A 40-59 post without disclosure shows an amber ring; the same post at 60+ shows red.
- [ ] A post with an undisclosed product link + call to action shows a red ring and "Connection not disclosed".

### API unavailable
- [ ] Enable **Deeper analysis** in the popup with no server running: clicking the button still shows the local result; nothing hangs; popup "Check connection" reports failure.
- [ ] Start `npm run dev:api`, click **Check connection**: reports connected (provider: mock).

### Malformed API response
- [ ] Temporarily make the API return invalid JSON or a wrong shape (e.g. edit `MockProvider` to return `{}`): rings keep local results; no errors in the page console beyond a warning.

### Extension disabled
- [ ] Switch off **Show PromoLens on post pages** in the popup: the button disappears immediately.
- [ ] Switch it back on: the button returns without reloading the page (idle state).
- [ ] Clear cached results: popup reports the count; next analysis of the same post recomputes.

### Author history
- [ ] With **Check the author's public history** on, click the button on a post by an active author: the API log / popover reasons mention "other recent posts" or "communities" when the product recurs; a genuine account shows no such reason.
- [ ] A post by a deleted or suspended author: analysis still completes; confidence is low; no error ring.
- [ ] Click a second post by the same author within 6 hours: no new profile request (cached).
- [ ] Switch the toggle off: the next analysis reports history not checked (visible in the API log as `history: unavailable (history check is turned off)`).
- [ ] Popup **Clear cached results** also clears cached histories.

### Developer: route deeper analysis through a local API server

The popup only offers "use my own OpenAI key". To use `apps/api` instead (evaluation, other providers, a shared server), open the extension's service-worker console from `chrome://extensions` and run:

```js
chrome.storage.local.get("promolens:settings", ({ "promolens:settings": s }) =>
  chrome.storage.local.set({ "promolens:settings": { ...s, apiEnabled: true, aiProvider: "local-api", apiBaseUrl: "http://127.0.0.1:8787" } }));
```

The popup then shows the local-API fields (URL and **Check connection**) until you switch back to own-key mode.

### AI provider (optional)
- [ ] With `ANALYSIS_PROVIDER=openai` and no key, `npm run dev:api` fails fast with a clear message.
- [ ] With a valid key: **Check connection** shows `openai:<model>`; rings update a second time within ~5 s; the popover reasons quote the post.
- [ ] Stop the API mid-session: rings keep their local scores; no errors beyond a warning.
- [ ] `LOG_RAW_CONTENT` unset: the API log shows only routes, statuses, timings and claim counts.

### Permissions review
- [ ] `chrome://extensions` > PromoLens > Details shows only "Read and change your data on www.reddit.com" and storage; nothing else.
