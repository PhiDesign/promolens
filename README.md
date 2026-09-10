# PromoLens

PromoLens is a desktop Chrome extension that, **when you ask it to**, estimates **how likely an opened Reddit post is to be promotional**, and shows the observable evidence behind that estimate. It helps readers notice transparent promotion ("I built this") and *possible* undisclosed promotion, without ever claiming that an author is definitely a marketer, scammer, or product owner.

> PromoLens is an independent open-source project. It is **not affiliated with, approved by, or endorsed by Reddit**.
>
> Docs and privacy policy: <https://phidesign.github.io/promolens/> · Source: <https://github.com/PhiDesign/promolens>

## What it shows

PromoLens never analyses anything on its own. A small gray **?** button sits in the header of each post - on the post page and, if you keep the option on, on feed cards too. Click it (or focus it and press Enter) and PromoLens analyses that post. On a feed card it first fetches the post in the background (full body, links, top comments), so you can decide whether the post is worth opening without leaving the feed. Either way the analysis is:

1. **Author history**: the author's recent *public* posts and comments are read - the same pages you could open yourself - to see whether the same product keeps coming back, whether a near-identical post was published elsewhere, and whether the author has said "my app" / "I'm the founder" somewhere else.
2. **Rule engine**: scores the post plus that history in the browser, in milliseconds.
3. **Language model**: the post and the history summary go to the PromoLens service, to OpenAI with your own key, or to a local API you run, where a language model adds quoted evidence - including its own observations outside the named criteria, capped so they can never dominate - and the rule engine produces the final number. The ring shows one result, not a preliminary score that later changes.

Hover, focus, or click the ring to see a compact evidence card:

```
● Possible undisclosed promotion
Elsewhere the author describes this as their own product; this post does not say so.
Presented as a workflow in which one obscure tool gets the link and the credit;
the same product recurs in the author's other recent posts.
92%  Highly likely promotional · high confidence
● Connection not disclosed
 - In r/Entrepreneur (9 days ago) the author describes the product as their own
 - Only the obscure product receives a link
 - The same product appears in 4 other recent posts across 4 communities
Rules + language model (openai:gpt-5-mini). This is an estimate based on observable signals.
```

The first line is the **verdict** - the thing a reader actually needs: *Looks organic*, *Transparent promotion* (the author says so - fine), *Promotion with an unclear connection*, or *Possible undisclosed promotion*. The second line names the technique the promotion is dressed in, so you learn to spot it next time.

PromoLens keeps four ideas separate on purpose:

| Concept | Values | Meaning |
| --- | --- | --- |
| **Promotional likelihood** | 0-100 | How likely the post is meant to steer readers toward a product, service, waitlist, or commercial action. |
| **Disclosure** | clear / unclear / missing / unknown | Whether the author visibly reveals a connection to the product. |
| **Confidence** | low / medium / high | How much independent, verifiable evidence was actually available. |
| **Reach** | low / medium / high | How widely the post is seen (votes, comments, age). **Reach is never evidence of promotion.** |

A post can be highly promotional *and* transparent. "I built this product, try it here" scores around 90% promotional with **clear** disclosure and **low** undisclosed-promotion risk (purple ring). The same pitch with no disclosure would be a red ring.

Ring states: gray dashed **?** = not analysed, click to analyse · gray (animated) = analysing · green = low likelihood · purple = promotional and clearly disclosed (informational, not a warning) · amber = uncertain middle score without a clear disclosure · red = high likelihood with missing/unclear disclosure · gray **-** = analysis unavailable (click to retry).

Why on-demand and post-page only? The strongest evidence (full body, comments, the author's replies) only exists on the post page; one click per post keeps model costs to cents; and nothing about your browsing is analysed or sent unless you explicitly ask for that one post.

## Quick start (local, no accounts, no payments)

Prerequisites: **Node.js 20 or newer** (22 recommended) and **Google Chrome**.

```bash
git clone <your-fork-url> promolens
cd promolens
npm install
npm run build
```

Then load the extension:

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right switch).
3. Click **Load unpacked**.
4. Select the folder `apps/extension/dist` inside this repository.
5. Open any post on <https://www.reddit.com/> - a gray **?** appears beside its title. Click it.

Click the PromoLens toolbar icon to hide the button, choose where the model runs, or clear cached results.

### Optional: run the local analysis API

The extension works fully offline with its built-in rule engine. A small local API is included so an approved AI provider can be added later; today it ships with a deterministic **mock provider** that re-runs the same rules server-side.

```bash
cp .env.example apps/api/.env   # optional; defaults are fine
npm run dev:api                 # http://127.0.0.1:8787
```

In the toolbar popup, choose the local API option (see docs/testing.md), then click **Check connection**. If the API is unavailable or returns something malformed, the extension keeps the local rule-based result.

Never put a provider key in the extension. Provider secrets belong only in `apps/api/.env`, which Git ignores.

### Your own logo

The build draws a default ring icon. To use your own, drop four PNGs into `apps/extension/public/icons/` named `icon16.png`, `icon32.png`, `icon48.png` and `icon128.png` (square, transparent background works best), then run `npm run build` and reload the extension. The toolbar icon, the `chrome://extensions` card and the popup header all use them. The **?** ring injected into Reddit pages is drawn separately (`apps/extension/src/ui/ring.ts`) and is not affected.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run build` | Build the extension (`apps/extension/dist`) and the API (`apps/api/dist`). |
| `npm run build:extension` | Build only the extension. |
| `npm run watch --workspace=apps/extension` | Rebuild the extension on every change (click **Reload** in `chrome://extensions` afterwards). |
| `npm run dev:api` | Run the API with auto-reload. |
| `npm run start:api` | Run the built API from `apps/api/dist`. |
| `npm test` | Run all unit and DOM-fixture tests (vitest). |
| `npm run test:watch` | Tests in watch mode. |
| `npm run typecheck` | Type-check every package with `tsc`. |
| `npm run check` | Typecheck + tests + build, in that order. |

## Project structure

```
promolens/
  apps/
    extension/            Chrome extension (Manifest V3)
      public/             manifest.json, popup.html
      scripts/            esbuild build script, icon generator
      src/
        background/       service worker: result cache + API client (max 2 concurrent)
        content/          scanner (MutationObserver + IntersectionObserver), queue, analysis pipeline
        popup/            toolbar popup
        reddit/           adapter.ts - the ONLY file that knows Reddit's markup
        shared/           settings + message types
        ui/               score ring, evidence popover, theme detection, styles (Shadow DOM)
      test/               jsdom tests + sanitized HTML fixtures
    api/                  local Node.js API (node:http, no framework)
      src/
        routes/           /api/v1/health, /api/v1/analyze
        services/         cache, rate limiter, analysis service, providers/ (mock)
        validation/       request/response validation with the shared schemas
  packages/
    shared/               criteria catalogue, detectors, scoring engine, schemas, types
  docs/
    architecture.md       how it all fits together (beginner friendly)
    privacy.md            what is processed, what leaves the browser, retention
    testing.md            automated tests + manual test checklist
```

## How scoring works (short version)

1. The **adapter** extracts only visible information from a post (title, excerpt, author, subreddit, votes, comments, age, outbound domains, disclosure wording).
2. **Detectors** in `packages/shared/src/detectors.ts` turn that text into *signals*. Every signal references a criterion in `criteria.ts` (from the PromoLens criteria document) with a stable ID, category, weight, evidence source, verification flag, and which concept it affects.
3. The **scoring engine** discounts correlated signals, applies per-category caps (five marketing phrases cannot reach a high score on their own), caps style-only evidence at 39, clamps to 0-100, and then computes disclosure, confidence and reach separately.
4. Criteria that need author history or external data are **represented but marked unavailable**: they lower confidence and never invent points.

See [docs/architecture.md](docs/architecture.md) for details and the exact rules.

### Where the language model runs

Out of the box, every click uses **Included analyses** through the hosted PromoLens service: 20 analyses to start, then 5 a month, or 500 a month with PromoLens Plus ($4.99/month). For unlimited use with no subscription, choose **Use my own OpenAI API key** in the popup, paste a key from platform.openai.com/api-keys and click **Save and test key**. Chrome asks once for permission to contact api.openai.com. From then on each click also sends that post to the model, which adds quoted evidence; the rule engine still computes the score. Cost is billed to your OpenAI account - roughly half a cent per post with `gpt-5-mini`.

Developers who want to run the model behind their own API (for the evaluation harness, other providers, or a shared server) can use the local API instead:

1. Copy `.env.example` to `apps/api/.env` if it does not exist.
2. In `apps/api/.env` set:
   ```
   ANALYSIS_PROVIDER=openai
   ANALYSIS_PROVIDER_API_KEY=<paste your key here by hand>
   LLM_MODEL=<model id exactly as shown in your provider dashboard>
   ```
3. Start the API: `npm run dev:api`. The startup line shows the provider and model.
4. In the extension popup select the local API option and click **Check connection** - it should report the provider as `openai:<model>`.

From then on, clicking the **?** on a post page sends that post (and only that post) to your API; results are cached for 24 h by content hash. Expect 10-40 s per post with a large model (the prompt includes the post, comments and author history); a "mini" model answers in a few seconds. If the model exceeds `LLM_TIMEOUT_MS` (45 s by default) the API answers 502 and the ring shows the local result. If the model call fails or returns something malformed, the ring keeps the local rule-based score. Read `docs/privacy.md` before enabling: the text of posts you analyse leaves your machine for the model provider.

Never paste a key into chat tools, issues, or commits. `apps/api/.env` is git-ignored.

To compare rules-only, rules + model witness, and model-only scoring on labelled posts, run `npm run eval` - see `docs/evaluation.md`.

## Limitations (please read)

- **Estimates, not verdicts.** The rules are hypotheses to be tuned against labelled posts. Expect false positives (genuinely enthusiastic recommendations) and false negatives (subtle promotion).
- **Public information only.** Author history comes from the author's public profile listing (last ~40 posts and comments); private, suspended or deleted profiles yield "history unavailable" and lower confidence. Profile bios and cross-community coordination are still not evaluated.
- **Reddit access.** By default the history and feed-card checks read Reddit's public JSON pages with your own session. An official Data API path (OAuth "Log in with Reddit", read-only) is built in and switches on once a registered app id is set in `apps/extension/src/shared/redditApp.ts` after Reddit's approval - see `docs/reddit-compliance.md`.
- **On demand only.** Nothing is scored in feeds; you decide which posts to analyse.
- **Reach is approximate.** It uses raw votes/comments/age, not a comparison with similar posts in the same subreddit.
- **English-first heuristics.** Detectors are regular expressions written for English text.
- **Reddit's markup changes.** Everything Reddit-specific lives in `apps/extension/src/reddit/adapter.ts`; if the button stops appearing, that is the file to update.
- **Desktop `www.reddit.com` only.** No old.reddit.com, mobile, Firefox or Safari support.

## Privacy

Nothing is analysed or sent until you click the button on a post page. Each click runs the rules in your browser and sends the visible text and comments of *that one post* go to the API server you run, and from there to your configured model provider. No accounts, no analytics, no data selling, no model training. Cached results are keyed by a content hash and expire after 24 hours. Full details: [docs/privacy.md](docs/privacy.md).

## Safety boundaries

PromoLens never reports, hides, removes, or publicly labels anyone. It uses language such as "likely promotional", "possible undisclosed promotion" and "limited evidence", always allows an uncertain result, and focuses on commercial products - never political views or sensitive personal characteristics.

## Roadmap

- **Milestone 1 (done):** local rule-based scoring, evidence popover, mock API, tests, docs.
- **Milestone 2 (done):** language-model witness provider; evaluation harness comparing rules / hybrid / model-only; on-demand post-page mode.
- **Milestone 3 (in progress, 0.3.0):** done - author public history on click, verdict-first card, model observation channel (capped), comments forwarded to the model, multi-word product names, reach relative to community size, buried-disclosure verdict, Reddit developer-terms review and dormant OAuth path. Remaining - validation against 100-200 manually labelled real posts; weight and prompt tuning from them; correction/feedback button in the popover.
- **Later:** official Reddit API enrichment (author history, cross-posts) behind the existing disabled interface, once authorised access and a policy review exist; subreddit-relative reach; localisation.

Not planned: payments, accounts, automatic reporting/hiding, moderator dashboards, website-ranking checks, profile crawling.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Incorrect classifications are the most useful reports - use the **Incorrect classification** issue template.

## License

[MIT](LICENSE).
