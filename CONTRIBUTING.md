# Contributing to PromoLens

Thanks for helping. PromoLens is small on purpose; the most valuable contributions are **labelled examples of wrong classifications** and **careful tuning of the detectors and weights**.

## Ground rules

- Keep the safety boundaries: no automatic reporting, hiding, or public labelling; cautious wording ("likely", "possible", "limited evidence"); commercial products only.
- Never commit live Reddit content, usernames, or secrets. Fixtures must be synthetic and sanitized. `.env` files stay out of Git.
- Do not add dependencies without a reason in the PR description. The extension has zero runtime dependencies besides the shared package; the API has only `zod`.
- Reddit-specific selectors go in `apps/extension/src/reddit/adapter.ts` and nowhere else.

## Setup

```bash
npm install
npm run check   # typecheck + tests + build
```

Load `apps/extension/dist` unpacked in Chrome (see README). `npm run watch --workspace=apps/extension` rebuilds on change; click **Reload** in `chrome://extensions` afterwards.

## Changing the scoring

1. Weights and caps live in `packages/shared/src/criteria.ts`. Each entry cites a criterion from the PromoLens criteria document; keep the IDs stable.
2. Detection logic lives in `packages/shared/src/detectors.ts`. Prefer conservative patterns; a missed signal lowers confidence, a false signal accuses someone.
3. Add or update a test in `packages/shared/test/` for every behaviour change. The suite enforces the invariants that matter most: clamping, category caps, style-only cap, reach separation, minimal weight for unsupported accusations.
4. Run `npm test` and include before/after scores for the fixtures in `apps/extension/test/fixtures/` in your PR.

## Reporting an incorrect classification

Open an issue with the **Incorrect classification** template. Please paraphrase the post rather than pasting it verbatim, and do not include the author's username.

## Pull requests

- One topic per PR.
- `npm run check` must pass.
- Explain *why* in the description, especially for weight changes.
- Update `docs/` when behaviour visible to users changes.

## Code style

TypeScript strict mode, no `any`, small modules with a comment at the top explaining their role. Match the style of the surrounding file.
