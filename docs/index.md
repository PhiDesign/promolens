---
title: PromoLens
---

# PromoLens

PromoLens is an open-source Chrome extension that, **when you ask it to**, estimates how likely an opened Reddit post is to be promotional, and shows the observable evidence behind that estimate. It helps readers tell transparent promotion ("I built this") from possible undisclosed promotion, without ever claiming that an author is definitely a marketer, scammer, or product owner.

PromoLens is an independent project. It is **not affiliated with, approved by, or endorsed by Reddit**.

## How it works

- Nothing runs automatically. A small button appears in the header of a post; PromoLens analyses a post only when you click it.
- The analysis runs in your browser with a rule engine based on a published set of criteria (calls to action, links and referral codes, story structure, disclosure wording, and whether the same product recurs in the author's public posts).
- The result is shown as an estimate with the evidence quoted: *Looks organic*, *Transparent promotion*, *Promotion, disclosed late*, or *Possible undisclosed promotion*.

## Documents

- [Privacy](privacy) - what is read, what leaves the browser (nothing, in the default configuration), retention and deletion
- [Architecture](architecture) - how the pieces fit together, written for beginners
- [Evaluation](evaluation) - how scoring approaches are compared on labelled posts
- [Testing](testing) - automated tests and the manual checklist
- [Reddit developer-terms review](reddit-compliance) - the compliance checklist for a public release

Source code: [github.com/PhiDesign/promolens](https://github.com/PhiDesign/promolens) (MIT licence).
