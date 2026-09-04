# Evaluating scoring approaches

PromoLens can score a post three ways. This harness runs the same labelled posts through each and reports where they differ, so the choice is made on data.

| Mode | What scores | Where |
| --- | --- | --- |
| `rules` | the local rule engine only | `packages/shared` (same code as the browser) |
| `witness` | rules + a language model that reports quoted evidence and may retract rule false positives; the rule engine computes the number | `apps/api/src/services/providers/llm.ts` |
| `direct` | the model produces the score, disclosure and confidence itself, using the criteria as guidance (**experimental**) | `apps/api/src/services/providers/direct.ts` |

## Run it

```bash
npm run eval                                              # rules only, no key needed
npm run eval -- --providers rules,witness,direct --repeat 2
npm run eval -- --providers direct --only memoir-launch-with-code
```

`witness` and `direct` need `ANALYSIS_PROVIDER_API_KEY` and `LLM_MODEL` in `apps/api/.env`. Check both first with `npm run eval -- --probe`: it verifies the key, confirms the model id exists, and sends one tiny completion (no post content). A 429 on that probe means the account has no credit. `--repeat N` calls the model N times per post to measure consistency. Reports are written to `apps/api/eval/results/` (git-ignored).

## What the summary means

| Column | Meaning | What good looks like |
| --- | --- | --- |
| in range | share of runs whose score fell inside the labelled range | high |
| range err | mean distance outside the range (0 when inside) | low |
| disclosure ok | share of runs with the expected disclosure status | high |
| repeat spread | mean (max - min) score across repetitions of the same post | 0 = deterministic; above ~10 means users will see the number change on refresh |
| reach pairs held | pairs of cases that differ only in upvotes/comments and scored within ±5 of each other | all held; anything else means popularity leaked into the score |
| failed | model calls that errored, timed out or returned malformed JSON | 0 |
| latency | mean time per analysis | rules: ms; model: seconds |

Token totals are printed when the endpoint reports usage; multiply by your provider's price to get cost per post.

## Adding your own posts

The committed seed set is synthetic. Real posts belong in `apps/api/eval/local/*.json` (git-ignored, never committed):

```json
{
  "cases": [
    {
      "id": "my-post-1",
      "description": "Founder launch with coupon; disclosed in title",
      "post": {
        "title": "...",
        "body": "...",
        "subreddit": "SaaS",
        "links": ["https://example.app"],
        "upvotes": 210,
        "commentsCount": 55,
        "ageHours": 3
      },
      "expected": { "min": 75, "max": 100, "disclosure": "clear" }
    }
  ]
}
```

Label the range you would accept from a careful human reviewer, not the number you hope for. To test that reach never leaks, copy a case, change only `upvotes`/`commentsCount`, and set `"invariantWith": "<original id>"`.

A meaningful comparison needs roughly 100 labelled posts spread across the categories in the criteria document; the seed set only checks that nothing is badly broken.

## How to decide

- If `direct` is not clearly better on *in range* and *disclosure ok*, keep the rules as the judge: they are free, instant, deterministic and testable.
- If `direct` is better but its *repeat spread* or *reach pairs* are worse, that is the case for `witness`: model judgment, rule-engine guarantees.
- Whatever wins, every post the model gets right and the rules get wrong is a candidate for a new rule; every post the rules get right and the model gets wrong is a prompt fix.
