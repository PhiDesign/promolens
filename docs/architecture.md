# PromoLens architecture

This document explains how PromoLens works, written for someone who is new to browser extensions. If you only read one section, read "The journey of one post".

## The three parts

```
+---------------------------+       messages        +-----------------------------+
|  Content script           | <-------------------> |  Background service worker  |
|  (runs inside reddit.com) |   chrome.runtime      |  (extension-level helper)   |
|                           |                       |                             |
|  - finds posts            |                       |  - result cache (24h)       |
|  - local rule scoring     |                       |  - talks to the local API   |
|  - draws rings/popover    |                       |    (max 2 at a time)        |
+---------------------------+                       +--------------+--------------+
            ^                                                      |
            |  reads settings                                      |  HTTP (optional)
            v                                                      v
+---------------------------+                       +-----------------------------+
|  Toolbar popup            |                       |  Local API (apps/api)       |
|  on/off, API settings,    |                       |  POST /api/v1/analyze       |
|  clear cache              |                       |  mock provider today        |
+---------------------------+                       +-----------------------------+

              Everything above shares one library: packages/shared
              (criteria, detectors, scoring, schemas, types)
```

- **Content script** (`apps/extension/src/content`): JavaScript that Chrome injects into every `https://www.reddit.com/*` page. It can see the page, but not extension-wide storage tricks or the network in a privileged way.
- **Background service worker** (`apps/extension/src/background`): a script Chrome starts on demand. It owns the persistent cache and the API connection. It goes to sleep when idle, which is why the content script never assumes it is awake.
- **Popup** (`apps/extension/src/popup`): the small window under the toolbar icon.
- **Shared package** (`packages/shared`): plain TypeScript with no browser or Node dependencies, so the same scoring code runs in the content script, in tests, and on the server.
- **API** (`apps/api`): a tiny Node server. Optional. It exists so an approved AI provider can be plugged in later without touching the extension.

## The journey of one post

1. **Only post pages.** The content script does nothing on feeds. On `/r/<sub>/comments/<id>/...` it finds the main post (by the id in the URL, falling back to the post carrying the `<h1>`) via the adapter's `findDetailPostElement`.
2. **One idle button.** A gray dashed ring with a **?** is inserted before the title with `slot="title"`, so it renders on the title line inside Reddit's shadow DOM. Hovering explains what a click does; nothing is analysed yet. A `MutationObserver` (debounced) plus URL polling re-attach it after client-side navigation and remove it when you leave the post.
3. **Click.** `PromoLens.analyse` queues `analyzeRecord` for that post (concurrency 1). The ring switches to the animated analysing state.
4. **Extract.** `extractPost` reads the visible attributes, the full body and the visible comments (see `adapter.ts`). If parsing fails, the ring shows the gray error state; clicking again retries.
4b. **Author history.** If enabled, the content script asks the worker (`HISTORY_GET`), which fetches the author's public submissions, comments and account info (`background/history.ts`), keeps a compact summary and caches it 6 h per author. `packages/shared/src/history.ts` turns it into signals: same domain linked repeatedly, same product across several communities, near-identical reposts, comments steering to the product, a public "it's my product" statement elsewhere (verified - we saw it), account age/karma as weak context, and counter-signals for varied or long genuine histories. Unavailable history becomes an explicit note that lowers confidence.
5. **Hash.** `hashPostContent` hashes the fields that affect analysis (not votes), including a fingerprint of the history summary. This key drives every cache.
6. **Local score.** `analyzePost` runs the detectors and the scoring engine synchronously - a few milliseconds - and the ring updates right away. This never waits on the background worker.
7. **Cache lookup.** The content script asks the worker (`CACHE_GET`, 1.5 s timeout). A hit that came from the API replaces the local result; otherwise the local result is stored (`CACHE_PUT`).
8. **Deeper analysis (optional).** If enabled, the worker sends the post to `POST /api/v1/analyze` (at most two in flight globally, 25 s timeout), validates the response against the shared schema, caches it, and the ring updates again. The popover footer says whether the result is "Local rules only" or "Rules + language model". Any failure leaves the local result in place.
9. **Cleanup.** Navigating away cancels queued work, hides the popover and removes the button.

## Where Reddit-specific code lives

Only `apps/extension/src/reddit/adapter.ts`. It knows:

- `shreddit-post` and its attributes (`id`, `permalink`, `post-title`, `author`, `subreddit-name`, `score`, `comment-count`, `created-timestamp`, `domain`, `content-href`);
- the title slot (`[slot="title"]`), body slot (`[slot="text-body"]`) and credit bar;
- `shreddit-comment` with `author` / `depth` and its `[slot="comment"]` content on detail pages.

Attributes were chosen over class names because Reddit's class names are generated and change often; the custom-element attributes have been stable for a long time. When Reddit changes something, update the `SELECTORS` / `ATTRS` tables there and rerun the fixture tests.

## The scoring engine

Files: `packages/shared/src/criteria.ts`, `detectors.ts`, `scoring.ts`.

### Criteria and signals

`criteria.ts` is a data table transcribed from the PromoLens criteria document. Each entry has:

| Field | Meaning |
| --- | --- |
| `id` | stable identifier, e.g. `cta.dm-request` |
| `category` | section of the framework; used for caps |
| `strength` / `weight` | very-strong (+25..30), strong (+20), medium (+8..15), weak (+2..5), counter (-5..-15), info (0) |
| `affects` | which of promotion / disclosure / confidence / reach the signal may change |
| `evidenceSource` | post-text, post-links, comments, profile, history, external, api... |
| `requiresVerification` | if true and the signal is unverified, it counts at 25 % |
| `availability` | `local` (feed), `page` (detail page), `unavailable` (needs history/external data - never fabricated) |
| `correlationGroup` | signals that describe overlapping evidence |

A **signal** is a criterion that was actually detected for one post, with a human-readable explanation and optional short excerpt.

### From signals to a score

1. **Verification discount** - unverified signals that require verification count at 25 %.
2. **Correlation discount** - within a correlation group (e.g. "DM me" and "comment interested"), the strongest counts fully, the rest at 25 %.
3. **Category caps** (`CATEGORY_CAPS`) - e.g. marketing language can add at most 15, narrative 25, direct calls to action 40; counter-signals can subtract at most 35.
4. **Style-only cap** - if no *behavioural* category (calls to action, links, workflow, disclosure, account, repetition, comment evidence) contributes at least 8 points, the total is capped at 39. Polished writing, dramatic stories and hype words can never create a high score alone.
5. **Confirmed-promotion floor** - when the author states a connection ("I built this", "I work for them", "affiliate link") *and* asks readers to act (link or call to action), the score is at least 80. Transparent promotion is still promotion; disclosure changes the colour, not the fact.
6. **Clamp** to 0-100 and round.

### Disclosure

- `clear` - explicit creator / employee / paid / gifted / affiliate statement, or Reddit's Brand Affiliate label, placed where readers see it.
- `unclear` - vague wording ("something I've been working on", "a friend's product"), disclosure buried at the very end of a long post, or a connection admitted only in comments.
- `missing` - commercial evidence exists (call to action, product link, workflow insertion...) with no disclosure.
- `unknown` - nothing to disclose was detected.

`undisclosedRisk` is derived: clear -> low; otherwise high at 60+, medium at 40+, else low.

### Confidence (computed separately)

Points from signal strength (very-strong 3, strong 2, medium 1, weak 0.25, counter 1; unverified 0.25) plus 0.5 per additional evidence source. Below 2.5 -> low, below 6 -> medium, else high. On feed posts without a verified very-strong signal, high is capped to medium. Copied/coordinated accusations lower confidence one step. Availability notes ("author history unavailable") are signals too, so limited evidence is always visible in the reasons.

### Reach

From visible votes, comments and age; explained in words ("2,400 upvotes and 184 comments on a 3-hour-old post"). It never adds promotion points - tests enforce this.

### Comment evidence (detail pages only)

| Situation | Handling |
| --- | --- |
| one "this is an ad" without evidence | +2 max |
| several independent users raise the concern | +8 |
| commenter links to an earlier identical post | strong criterion, but unverified -> 25 % until verified |
| commenter links evidence connecting author and product | very strong, unverified -> 25 % |
| author admits the connection in comments | confirms promotion; disclosure becomes *unclear* (it was not in the post) |
| accusations look copied / coordinated | no points, confidence lowered |

## The verdict

`packages/shared/src/verdict.ts` turns a result into the line a reader needs. It does not change the score; it reads it together with the disclosure status and the detected signals:

| Verdict | Condition |
| --- | --- |
| Looks organic / Mostly organic | score under 40 and no hidden connection |
| Transparent promotion | promotional and disclosure *clear* |
| Promotion with an unclear connection | disclosure *unclear* (vague wording, admitted only in comments) |
| Possible undisclosed promotion | disclosure *missing* with score 60+, or the author's connection found in their history but not in the post |

The technique line is picked from the signals in priority order: hidden connection found elsewhere > workflow framing > advice-then-product > personal story > DM/keyword gating > review with a link > product-page style > direct ask, plus a clause when the product recurs in the author's history. Wording is always "presented as..." - never a label for the person.

## Messages

| Message | Direction | Purpose |
| --- | --- | --- |
| `CACHE_GET {hash}` | content -> worker | look up a cached result |
| `CACHE_PUT {hash, result}` | content -> worker | store a local result |
| `ENRICH {hash, post, localSignals}` | content -> worker | ask the local API (if enabled) |
| `CACHE_CLEAR` | popup -> worker | delete every cached result |
| `API_HEALTH {baseUrl?}` | popup -> worker | connection check |

Every content-script call is wrapped so a sleeping or reloaded worker degrades to "no cache, local result only".

## Storage

`chrome.storage.local` holds:

- `promolens:settings` - `{ enabled, apiEnabled, apiBaseUrl, cacheTtlHours }`
- `promolens:cache:<hash>` - `{ result, storedAt }` (no post text). Expired entries are dropped on read and pruned on worker start / every 50 writes; the cache is capped at 2,000 entries.

## The API

`node:http` with hand-written middleware so every safeguard is visible in `server.ts`:

- CORS restricted to `ALLOWED_ORIGINS` (default allows any locally loaded `chrome-extension://` origin and localhost dev ports; narrow it to your extension ID if you like);
- request body limit (`MAX_BODY_BYTES`), JSON only;
- sliding-window rate limit per client;
- provider timeout (`REQUEST_TIMEOUT_MS`) and socket timeouts;
- request and response validated with the shared zod schemas;
- content-hash cache (`ContentHashCache` interface, in-memory implementation);
- access log contains method, path, status and duration only - never post content (unless `LOG_RAW_CONTENT=true` for local debugging).

`AnalysisProvider` is the extension point. `MockProvider` re-runs the shared engine and adds an honest note that no extra evidence sources were consulted. A real provider would live beside it, read its key from `config.providerApiKey`, and must still return signals with observable explanations.

## Future Reddit API enrichment

The `PostInput` / `Signal` model already contains the profile, history and repetition criteria (marked `unavailable`). An enrichment step would populate those from an authorised source and set `verified: true` where appropriate. Nothing in the current code crawls profiles, and this stays disabled until authorised API access and a policy review exist.

## Key decisions, in plain language

- **Manifest V3, no remote code, `storage` permission only.** The content script matches `https://www.reddit.com/*`; the worker reaches the local API through ordinary CORS, so no host permissions are needed.
- **Shadow DOM for all injected UI.** Reddit's CSS cannot restyle the ring; our CSS cannot leak out. Two Reddit-specific traps are handled in `styles.ts`: Reddit hides un-upgraded custom elements with `:not(:defined) { visibility: hidden }` (our hosts force `visibility: visible !important`), and every post card carries an invisible full-size link overlay (the ring host is positioned with a z-index so hover and click reach it).
- **One shared popover** positioned with `position: fixed` so it is never clipped by a post card.
- **Local first.** The rule engine runs in the page and needs nothing else. The API only ever refines.
- **Hashes, not content.** Caches are keyed by a content hash; votes are excluded so the same post is not re-analysed every time its score changes.
- **Honesty over confidence.** Unavailable evidence lowers confidence instead of being guessed.

## The AI provider: witness, not judge

`apps/api/src/services/providers/llm.ts` plugs a language model into the same pipeline without giving up the properties above:

1. The rules run first on the server (identical code to the browser).
2. The model receives the post plus the catalogue of *judgment* criteria (calls to action, narrative, workflow, marketing language, disclosure, counter-signals) and the rule signals already found. It answers with criterion IDs, each backed by a **verbatim quote**, and may **retract** rule signals it considers false positives (e.g. "one-click install" is a description, not a call to action).
3. Every quote is checked against the post text. No matching quote, no signal.
4. Retractions are honoured only for text-judgment categories. Links, affiliate parameters, account facts, comment evidence and reach stay exactly as the rules found them.
5. The merged signals go through `scoreSignals` - same caps, same correlation discounts, same floor, same reach separation. The model never outputs a number, so five hype phrases from the model are capped at 15 points just like five from the regexes.
6. Anything malformed from the model raises an error: the API answers 502, nothing is cached, and the extension keeps its local score.

The model sees the post, up to 20 visible comments (the author's replies marked), and the author-history summary. Quotes are checked against the right source: post-level claims (disclosure, calls to action, narrative) must quote the post; account/repetition claims may quote the history; thread claims may quote the comments. A commenter's words or the author's statement in another post can therefore never become this post's disclosure.

The model also has a channel of its own, `observations`: anything promotional or organic it notices that the catalogue does not name, each with a verbatim quote (from the post or the fetched history), a direction and a short neutral note. They become `model.observation` signals worth ±8 each, at most three, in a category capped at 15 points - the model's eyes and judgment, without the pen. When author history was fetched, the model sees its summary and may cite account/repetition criteria from it, quoting the history titles or excerpts.

`openai.ts` is the transport: one POST to any OpenAI-compatible `/chat/completions` endpoint, JSON output, timeout, and error messages that never include post content or the key. Tests use a fake client, so the suite never touches the network.
