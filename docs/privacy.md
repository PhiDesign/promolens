# PromoLens privacy policy

Version 0.2, 8 September 2026. Published at <https://phidesign.github.io/promolens/privacy>. This policy will be updated before any change to what is collected, before any hosted service is introduced, and before any paid option exists.

**In one sentence:** PromoLens reads only the Reddit post you click on (and, if enabled, that author's public posts), analyses it in your browser, and sends nothing anywhere unless you deliberately switch on the optional developer feature that talks to an API you run yourself.

## Summary

- PromoLens does **nothing until you click its button** on a post - on the post page or on a feed card. Feeds are never scanned or scored on their own.
- Analysis runs **in your browser** by default, on information already visible on that post page.
- Nothing leaves your browser unless you switch on **Deeper analysis** in the popup, and then only the post you clicked goes to the server address you configured (by default `http://127.0.0.1:8787`, i.e. your own computer), and from there to the model provider you configured.
- There are **no accounts, no analytics, no telemetry, no advertising, and no data selling**.
- PromoLens does **not train models** on Reddit content.

## What visible Reddit information is processed

Only for a post you chose to analyse, from the post page you are viewing:

- post identifier and permalink
- title and the visible text excerpt
- visible author name and subreddit
- visible vote count, comment count and post age
- visible outbound link domains and URLs written in the text
- visible disclosure wording (for example "I built this")
- Reddit's visible "Brand Affiliate" label, when present

Additionally:

- the full visible post body
- the visible comments (author name, text, nesting depth), including public statements or accusations they contain

## What PromoLens does not access

- private messages, chats, or notifications
- anything behind a login that is not already rendered on the page
- your browsing history, cookies, or other websites
- any page you are not currently viewing, except the one case below: the *public* profile listing of the author of a post you clicked "analyse" on, when the history check is on (nothing is crawled or fetched in the background, and never for posts you did not click)

The extension requests the `storage` permission and host access to `https://www.reddit.com/*` (needed for the author-history request); it runs only on `https://www.reddit.com/*`.

## Does information leave the browser?

**Deeper analysis off (default):** no. Analysis runs in the page when you click. Results are cached inside Chrome's extension storage on your device.

**Deeper analysis on:** when you click the button, the background worker sends the fields listed above for that one post, plus the locally detected signals and a content hash, to the configured API URL over HTTP. The bundled API is designed to run on your own machine. If you point it at another machine, the same data goes there - only do that with a server you control and trust.

## Optional AI provider (off by default)

When the local API is started with `ANALYSIS_PROVIDER=openai`, each analysed post is also sent from **your local API server** to the configured model endpoint (by default OpenAI's). This only happens if you (1) run the API yourself, (2) put a key in `apps/api/.env`, (3) switch on **Deeper analysis** in the extension popup, and (4) click the button on a post.

What is sent to the model: the subreddit name, the post title, up to 6,000 characters of the visible post body, up to ten visible links, the list of rule signals already detected, and - when the history check is on - the compact author-history summary (titles, subreddits, domains, short excerpts, dates of the author's recent public posts and comments). No votes, no browsing history, nothing about you. Up to 20 visible top-level comments (300 characters each, with the post author's replies marked) are included so the model can weigh what the thread says.

What comes back: criterion IDs with short verbatim quotes. The model never returns a score; the rule engine computes it. Quotes that do not appear in the post are discarded, so the model cannot invent evidence.

The provider's own retention and training policies apply to what it receives; check them before enabling. PromoLens itself does not store the post text on the server (only the hashed result, for the cache TTL) and never logs it unless `LOG_RAW_CONTENT=true` is set for local debugging.

The extension never contains or receives the API key.

## Author history check (on by default, one click, one author)

When you click "analyse" on a post and **Check the author's public history** is on, the extension reads the author's recent public submissions and comments and their public account age/karma - the same pages anyone can open at `reddit.com/user/<name>` - using your own browser session. It keeps a compact summary (subreddit, title, outbound domain, a short excerpt, date) of up to 40 posts and 40 comments, uses it to check whether the same product recurs, and holds that summary **in the extension's worker memory only** for up to 6 hours per author - it is never written to disk, and it disappears when the browser or the extension's background worker stops. Evidence taken from another post is shown with the username and a link back to that post. If deeper analysis is on, the titles/excerpts summary is included in what goes to your local API and the model provider.

It does not read private messages, saved items, hidden or removed content, or anything not publicly visible. It never fetches a profile for a post you did not click, and never fetches profiles of commenters. Switch the toggle off in the popup to stop it; the engine then reports "author history not checked" and keeps confidence lower.

**Official API option.** When the extension is built with a registered Reddit app id, the popup offers **Log in with Reddit**. Logging in (read-only scopes: `identity`, `read`, `history`) makes these reads go through Reddit's Data API with your own account's token instead of the page session; PromoLens never posts, votes, or changes anything on your account. Tokens are stored in the extension's storage on your device and are revoked at Reddit and deleted when you log out. Until Reddit has approved PromoLens's Data API access, the login option is hidden and the extension reads public pages with your browser session, as described above; see `docs/reddit-compliance.md`.

## Feed-card clicks (on by default, one click, one post)

Clicking the button on a feed card fetches that one post's public content (title, body, links, top comments) in the background so it can be scored with the same data as on the post page - the same page you would get by opening the post, read through Reddit's public JSON listing with your own session. It is kept in the worker's memory for 10 minutes and otherwise treated exactly like a post you opened. Nothing is fetched for cards you do not click. Switch **Also show it on feed cards** off in the popup to remove the buttons from feeds.

## Retention and deletion

- **In the browser:** results are stored under a content hash (not the text) together with a timestamp, for 24 hours by default (configurable in `settings.cacheTtlHours`). Expired entries are removed automatically. You can delete everything at any time with **Clear cached results** in the toolbar popup, or by removing the extension.
- **In the bundled API:** results are kept in memory only, keyed by hash, for `CACHE_TTL_HOURS` (24 h default), and disappear when the process stops. Request logs record method, path, status and duration - never post text - unless you deliberately set `LOG_RAW_CONTENT=true` while debugging.
- **Raw post or comment content is not retained** by either component beyond the moment of analysis.

## How to turn PromoLens off

There is no automatic scanning. To remove the button entirely, click the PromoLens toolbar icon and switch off **Show PromoLens on post pages**. To stop any data leaving the browser, switch off **Deeper analysis**. You can also disable or remove the extension from `chrome://extensions`.

## Requesting deletion if server-side storage is introduced later

Today nothing is stored server-side beyond the in-memory cache of a server you run yourself. If a hosted service with persistent storage is ever introduced, this document will be updated with: what is stored, for how long, the lawful basis, and a deletion request channel (planned: an email address and an in-extension "delete my data" action keyed by an anonymous installation identifier). No hosted service exists in this milestone.

## Safety boundaries that protect other people

- PromoLens never labels a person publicly, never reports or hides posts, and never contacts Reddit or anyone else on your behalf.
- Output wording is deliberately cautious ("likely promotional", "possible undisclosed promotion", "limited evidence") and every estimate lists the observable reasons behind it.
- It focuses on commercial products and services only. It does not profile political views, religion, health, or other sensitive personal characteristics.

## Provider secrets

If an AI provider is added later, its API key lives only in `apps/api/.env` on the server. It is never bundled into the extension and never sent to the browser. `.env` files are excluded from Git by `.gitignore`.
