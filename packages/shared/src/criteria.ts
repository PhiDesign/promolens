import type { Criterion } from "./types.js";

/**
 * The PromoLens criteria catalogue.
 *
 * Every entry comes from the "PromoLens - Complete Reddit Promotion Detection
 * Criteria" document (v1.0, September 2026). Weights are hypotheses to be
 * tested against labelled posts, not permanent truth.
 *
 * `availability` tells the engine whether the criterion can be evaluated now:
 *   local        - from the visible feed post
 *   page         - needs the post detail page (full body, visible comments)
 *   unavailable  - needs profile history / external data. Kept in the model so
 *                  the gap is explicit; it lowers confidence and is never faked.
 *
 * To tune the engine, edit weights here and re-run `npm test`.
 */

const P = "promotion" as const;
const D = "disclosure" as const;
const C = "confidence" as const;
const R = "reach" as const;

export const CRITERIA: readonly Criterion[] = [
  // ---- 3. Direct promotional signals --------------------------------------
  { id: "cta.direct", category: "direct-cta", strength: "strong", weight: 20,
    description: "Directly asks readers to buy, download, install, register, subscribe, or book",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "cta" },
  { id: "cta.coupon", category: "direct-cta", strength: "strong", weight: 20, maxWeight: 25,
    description: "Provides a discount, coupon, promotional code, or time-limited offer",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "cta.signup-benefit", category: "direct-cta", strength: "strong", weight: 20,
    description: "Promises a benefit in return for signing up or joining",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "cta" },
  { id: "cta.repeated-links", category: "direct-cta", strength: "strong", weight: 20,
    description: "Repeatedly links to the product inside the post or replies",
    affects: [P], evidenceSource: "post-links", requiresVerification: false, availability: "local", correlationGroup: "product-link" },
  { id: "cta.waitlist", category: "direct-cta", strength: "medium", weight: 15,
    description: "Invites readers to join a product waitlist",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "cta" },
  { id: "cta.comment-interested", category: "direct-cta", strength: "strong", weight: 20,
    description: "Asks readers to comment 'interested' or a keyword to receive access",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "dm" },
  { id: "cta.feedback-redirect", category: "direct-cta", strength: "medium", weight: 10,
    description: "Requests feedback, but the content mainly directs users to the product",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "cta" },
  { id: "cta.dm-request", category: "direct-cta", strength: "strong", weight: 15, maxWeight: 20,
    description: "Asks readers to DM for the product, link, template, workflow, or details",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "dm" },

  // ---- 4. Account and profile signals (unavailable in milestone one) ------
  { id: "account.bio-links-product", category: "account", strength: "very-strong", weight: 30,
    description: "Profile biography links to the promoted product or company",
    affects: [P, D], evidenceSource: "profile", requiresVerification: true, availability: "unavailable" },
  { id: "account.username-matches", category: "account", strength: "strong", weight: 20,
    description: "Username resembles the product, brand, founder, or company",
    affects: [P], evidenceSource: "post-metadata", requiresVerification: false, availability: "local" },
  { id: "account.self-identified-elsewhere", category: "account", strength: "very-strong", weight: 30,
    description: "Author identifies elsewhere as the founder, employee, marketer, affiliate, or agency",
    affects: [P, D], evidenceSource: "history", requiresVerification: true, availability: "history" },
  { id: "account.single-product-history", category: "account", strength: "strong", weight: 25,
    description: "Most recent posts and comments concern one product",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "account.repeats-domain", category: "account", strength: "strong", weight: 25,
    description: "Author repeatedly recommends or links to the same domain",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "account.only-active-for-product", category: "account", strength: "strong", weight: 20,
    description: "Account rarely participates except when mentioning the product",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "account.comments-redirect", category: "account", strength: "strong", weight: 20,
    description: "Comments mainly redirect discussions toward the same product",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "account.sudden-activity", category: "account", strength: "medium", weight: 10,
    description: "Previously inactive account suddenly begins product-focused posting",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "account.low-karma", category: "account", strength: "weak", weight: 5,
    description: "Very low karma (context only, never decisive)",
    affects: [C], evidenceSource: "profile", requiresVerification: false, availability: "history", correlationGroup: "weak-account" },
  { id: "account.new-account", category: "account", strength: "weak", weight: 5,
    description: "Very new account (context only, never decisive)",
    affects: [C], evidenceSource: "profile", requiresVerification: false, availability: "history", correlationGroup: "weak-account" },
  { id: "account.new-low-karma-product-focus", category: "account", strength: "weak", weight: 8,
    description: "New account combined with low karma and product-focused activity",
    affects: [P, C], evidenceSource: "profile", requiresVerification: false, availability: "history", correlationGroup: "weak-account" },
  { id: "history.cross-subreddit", category: "repetition", strength: "strong", weight: 20,
    description: "The same product appears in the author's recent posts across several communities",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history", correlationGroup: "history-repeat" },
  { id: "history.repeated-text", category: "repetition", strength: "strong", weight: 20,
    description: "A near-identical post was published elsewhere by the author",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history", correlationGroup: "history-repeat" },

  // ---- 5. Repetition and distribution (mostly unavailable) ----------------
  { id: "repeat.identical-crosspost", category: "repetition", strength: "very-strong", weight: 30,
    description: "Identical post is submitted to several communities",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.rewritten-crosspost", category: "repetition", strength: "strong", weight: 25,
    description: "Slightly rewritten versions of the same story appear in several communities",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.same-story-same-product", category: "repetition", strength: "strong", weight: 25,
    description: "The same story structure repeatedly leads to the same product",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.same-hook", category: "repetition", strength: "medium", weight: 15,
    description: "The same title or hook structure is reused",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.same-domain", category: "repetition", strength: "strong", weight: 25,
    description: "The same domain appears repeatedly across posts and comments",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.unrelated-communities", category: "repetition", strength: "strong", weight: 20,
    description: "Similar promotional content is posted in unrelated communities",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.marginal-relevance", category: "repetition", strength: "medium", weight: 15,
    description: "The product is inserted into discussions where it is marginally relevant",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.coordinated-burst", category: "repetition", strength: "medium", weight: 10,
    description: "Product posts are published in a coordinated burst",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "repeat.same-reply", category: "repetition", strength: "strong", weight: 20,
    description: "The author repeats the same product reply under different posts",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },

  // ---- 6. Embedded workflow promotion ------------------------------------
  { id: "workflow.obscure-among-familiar", category: "workflow", strength: "medium", weight: 10,
    description: "An obscure product is casually inserted among familiar tools",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "workflow-insert" },
  { id: "workflow.necessary-step", category: "workflow", strength: "weak", weight: 8,
    description: "The product is presented as a necessary step in a useful workflow",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "workflow-insert" },
  { id: "workflow.success-attributed", category: "workflow", strength: "medium", weight: 15,
    description: "The successful outcome is strongly attributed to that product",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "workflow.only-product-linked", category: "workflow", strength: "strong", weight: 20,
    description: "Only the obscure product receives a link",
    affects: [P], evidenceSource: "post-links", requiresVerification: false, availability: "local" },
  { id: "workflow.more-detail", category: "workflow", strength: "medium", weight: 15,
    description: "The obscure product receives more explanation than supporting tools",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "workflow.recurs-across-workflows", category: "workflow", strength: "strong", weight: 25,
    description: "The same product appears in several otherwise different workflows",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "workflow.supporting-tools-change", category: "workflow", strength: "very-strong", weight: 30,
    description: "Famous supporting tools change between posts, but the obscure product remains",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "workflow.explainable-without-product", category: "workflow", strength: "medium", weight: 10,
    description: "The workflow could be explained without naming that specific product",
    affects: [P], evidenceSource: "api", requiresVerification: false, availability: "unavailable", correlationGroup: "workflow-insert" },
  { id: "workflow.unnecessary-mention", category: "workflow", strength: "medium", weight: 12,
    description: "The product mention is unnecessary to the main story",
    affects: [P], evidenceSource: "api", requiresVerification: false, availability: "unavailable", correlationGroup: "workflow-insert" },
  { id: "workflow.decisive-step", category: "workflow", strength: "strong", weight: 20,
    description: "The recurring product always appears at the decisive workflow step",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "workflow.no-relationship-disclosed", category: "workflow", strength: "medium", weight: 10,
    description: "No relationship with the recurring product is disclosed",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local" },

  // ---- 7. Story and narrative signals ------------------------------------
  { id: "story.problem-product-success", category: "narrative", strength: "medium", weight: 15,
    description: "Story follows problem -> discovery -> product -> dramatic success",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "story-arc" },
  { id: "story.advice-then-product", category: "narrative", strength: "medium", weight: 15,
    description: "Post begins as general advice but ends by directing readers to a product",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "story-arc" },
  { id: "story.emotional-intro", category: "narrative", strength: "medium", weight: 12,
    description: "An emotional personal story conveniently introduces the product",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "story-arc" },
  { id: "story.solves-everything", category: "narrative", strength: "medium", weight: 10,
    description: "The product appears to solve every problem mentioned",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "story.no-limitations", category: "narrative", strength: "weak", weight: 5,
    description: "No meaningful disadvantages or limitations are discussed",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "story.few-details", category: "narrative", strength: "medium", weight: 10,
    description: "The story provides few verifiable details outside the product",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "story.result-title-tool-body", category: "narrative", strength: "medium", weight: 12,
    description: "The title emphasizes a result while the body promotes the tool",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "story.name-repeated", category: "narrative", strength: "medium", weight: 10,
    description: "The product name is repeated unnaturally",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "name-repetition" },
  { id: "story.testimonial", category: "narrative", strength: "medium", weight: 10,
    description: "The recommendation reads like a testimonial",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },
  { id: "story.dramatic-claims", category: "narrative", strength: "weak", weight: 8,
    description: "Success claims are unusually dramatic or specific without support",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },

  // ---- 8. Marketing-language signals -------------------------------------
  { id: "lang.hype-phrases", category: "marketing-language", strength: "weak", weight: 5,
    description: "Uses phrases such as 'game changer', 'must-have', or 'revolutionary'",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },
  { id: "lang.transformation", category: "marketing-language", strength: "weak", weight: 7,
    description: "Uses transformation language such as 'this changed everything'",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },
  { id: "lang.feature-focus", category: "marketing-language", strength: "medium", weight: 10,
    description: "Focuses excessively on features and benefits",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "sales-format" },
  { id: "lang.matches-website", category: "marketing-language", strength: "strong", weight: 20,
    description: "Uses wording that closely matches the product website",
    affects: [P], evidenceSource: "external", requiresVerification: true, availability: "unavailable" },
  { id: "lang.sales-page-format", category: "marketing-language", strength: "medium", weight: 10,
    description: "Lists features in a sales-page format",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "sales-format" },
  { id: "lang.slogans", category: "marketing-language", strength: "medium", weight: 10,
    description: "Uses slogans or branded phrases",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },
  { id: "lang.unsupported-performance", category: "marketing-language", strength: "medium", weight: 10,
    description: "Makes unsupported performance claims",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "hype" },
  { id: "lang.pricing-details", category: "marketing-language", strength: "medium", weight: 10,
    description: "Includes exact pricing or plan details unnecessarily",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "lang.seo-name-repetition", category: "marketing-language", strength: "medium", weight: 10,
    description: "Repeats the full product name in an SEO-like way",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "name-repetition" },
  { id: "lang.search-title", category: "marketing-language", strength: "medium", weight: 10,
    description: "Uses a search-oriented title such as 'Best tool for X'",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },

  // ---- 9. Links, domains, and external context ---------------------------
  { id: "link.affiliate-params", category: "links", strength: "very-strong", weight: 30,
    description: "URL contains affiliate or referral parameters",
    affects: [P, D], evidenceSource: "post-links", requiresVerification: false, availability: "local", correlationGroup: "product-link" },
  { id: "link.author-discount", category: "links", strength: "very-strong", weight: 30,
    description: "Discount code or link is connected to the author",
    affects: [P, D], evidenceSource: "post-links", requiresVerification: true, availability: "unavailable" },
  { id: "link.single-linked-tool", category: "links", strength: "strong", weight: 20,
    description: "Only one product in a multi-tool workflow is linked",
    affects: [P], evidenceSource: "post-links", requiresVerification: false, availability: "local", correlationGroup: "product-link" },
  { id: "link.redirect-tracking", category: "links", strength: "medium", weight: 10,
    description: "Link uses a redirect or tracking domain",
    affects: [P], evidenceSource: "post-links", requiresVerification: false, availability: "local" },
  { id: "link.repeated-destination", category: "links", strength: "strong", weight: 25,
    description: "Author repeatedly links to the same destination domain",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "link.domain-in-profile", category: "links", strength: "very-strong", weight: 30,
    description: "Destination domain appears in the author's profile",
    affects: [P, D], evidenceSource: "profile", requiresVerification: true, availability: "unavailable" },
  { id: "link.landing-page-match", category: "links", strength: "strong", weight: 20,
    description: "Landing page wording is nearly identical to the Reddit post",
    affects: [P], evidenceSource: "external", requiresVerification: true, availability: "unavailable" },
  { id: "link.product-link", category: "links", strength: "medium", weight: 12,
    description: "The post contains a direct product or commercial link",
    affects: [P], evidenceSource: "post-links", requiresVerification: false, availability: "local", correlationGroup: "product-link" },
  { id: "link.no-independent-mentions", category: "links", strength: "weak", weight: 5,
    description: "Product has almost no independent mentions outside the author",
    affects: [P], evidenceSource: "external", requiresVerification: true, availability: "unavailable" },
  { id: "link.obscure-domain", category: "links", strength: "weak", weight: 3,
    description: "Product or domain is very new, low traffic, or poorly ranked",
    affects: [P], evidenceSource: "external", requiresVerification: true, availability: "unavailable" },

  // ---- 10. Comment and DM behaviour --------------------------------------
  { id: "behavior.dm-for-link", category: "comment-behavior", strength: "strong", weight: 20,
    description: "Author asks readers to DM for a link",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "dm" },
  { id: "behavior.comment-interested-dm", category: "comment-behavior", strength: "strong", weight: 20,
    description: "Author asks readers to comment 'interested' to receive a DM",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "dm" },
  { id: "behavior.withholds-public-info", category: "comment-behavior", strength: "medium", weight: 12,
    description: "Information that could be public is withheld without a clear reason",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "dm" },
  { id: "behavior.answers-only-purchase", category: "comment-behavior", strength: "strong", weight: 20,
    description: "Author ignores normal questions but answers purchase or access questions",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "behavior.private-group", category: "comment-behavior", strength: "medium", weight: 15,
    description: "Author repeatedly directs users to a private group or mailing list",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page" },
  { id: "behavior.same-product-replies", category: "comment-behavior", strength: "strong", weight: 20,
    description: "Author responds to many comments with the same product",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page" },
  { id: "behavior.avoids-affiliation", category: "comment-behavior", strength: "strong", weight: 20,
    description: "Author avoids direct questions about affiliation",
    affects: [P, D], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "behavior.defensive", category: "comment-behavior", strength: "weak", weight: 5, maxWeight: 8,
    description: "Author becomes defensive without answering the affiliation question",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "behavior.answers-publicly", category: "counter-signal", strength: "counter", weight: -10,
    description: "Author answers questions transparently and publicly",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page" },

  // ---- 11. Community and comment evidence --------------------------------
  { id: "community.single-accusation", category: "community-evidence", strength: "weak", weight: 2,
    description: "One comment says 'this is an ad' without evidence",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "accusation" },
  { id: "community.several-independent-concerns", category: "community-evidence", strength: "medium", weight: 8,
    description: "Several apparently independent users raise the same concern",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "accusation" },
  { id: "community.repeated-posts-identified", category: "community-evidence", strength: "medium", weight: 10,
    description: "A commenter identifies repeated posts by the author",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "page", correlationGroup: "accusation-evidence" },
  { id: "community.linked-identical-post", category: "community-evidence", strength: "strong", weight: 20,
    description: "A commenter links to an identical earlier promotional post",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "page", correlationGroup: "accusation-evidence" },
  { id: "community.author-product-evidence", category: "community-evidence", strength: "very-strong", weight: 30,
    description: "A commenter provides evidence connecting the author to the product",
    affects: [P, D], evidenceSource: "comments", requiresVerification: true, availability: "page", correlationGroup: "accusation-evidence" },
  { id: "community.author-admission", category: "community-evidence", strength: "very-strong", weight: 30,
    description: "The author admits being the creator, employee, affiliate, or marketer",
    affects: [P, D], evidenceSource: "comments", requiresVerification: false, availability: "page", correlationGroup: "self-connection" },
  { id: "community.avoids-affiliation-questions", category: "community-evidence", strength: "medium", weight: 10,
    description: "The author avoids multiple public affiliation questions",
    affects: [P, D], evidenceSource: "comments", requiresVerification: false, availability: "page" },
  { id: "community.links-changed", category: "community-evidence", strength: "medium", weight: 15,
    description: "The author deletes or changes promotional links after being questioned",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "community.mod-removed", category: "community-evidence", strength: "strong", weight: 20,
    description: "Moderators identify or remove the post as self-promotion",
    affects: [P], evidenceSource: "page-body", requiresVerification: false, availability: "page" },
  { id: "community.coordinated-accusations", category: "community-evidence", strength: "info", weight: 0,
    description: "Accusing comments appear copied, coordinated, or low quality (no points, lowers confidence)",
    affects: [C], evidenceSource: "comments", requiresVerification: false, availability: "page" },

  // ---- 12. Possible coordinated promotion (unavailable) ------------------
  { id: "coord.same-accounts-praise", category: "coordination", strength: "strong", weight: 20,
    description: "The same accounts repeatedly praise the same product",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "coord.similar-wording", category: "coordination", strength: "medium", weight: 15,
    description: "Supporting comments use unusually similar wording",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page" },
  { id: "coord.fast-positive", category: "coordination", strength: "weak", weight: 5,
    description: "Positive comments arrive unusually quickly",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "coord.product-focused-supporters", category: "coordination", strength: "strong", weight: 20,
    description: "Supporting accounts also have product-focused histories",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "coord.repeated-claims", category: "coordination", strength: "strong", weight: 20,
    description: "Several accounts repeat the same product claims",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "coord.planted-questions", category: "coordination", strength: "medium", weight: 15,
    description: "Questions appear designed to invite the author to mention the product",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "coord.closed-interaction", category: "coordination", strength: "medium", weight: 15,
    description: "The accounts interact primarily with one another",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },

  // ---- 13. Upvotes, engagement, and reach (reach only) -------------------
  { id: "reach.upvotes", category: "engagement", strength: "info", weight: 0,
    description: "High total upvotes (reach only, no promotion points)",
    affects: [R], evidenceSource: "post-metadata", requiresVerification: false, availability: "local" },
  { id: "reach.comments", category: "engagement", strength: "info", weight: 0,
    description: "Comment volume (reach only, no promotion points)",
    affects: [R], evidenceSource: "post-metadata", requiresVerification: false, availability: "local" },
  { id: "engagement.fast-growth", category: "engagement", strength: "weak", weight: 5,
    description: "Upvotes grow unusually quickly compared with similar posts",
    affects: [P], evidenceSource: "post-metadata", requiresVerification: true, availability: "unavailable" },
  { id: "engagement.votes-few-comments", category: "engagement", strength: "weak", weight: 3, maxWeight: 5,
    description: "High upvotes with very few comments",
    affects: [P], evidenceSource: "post-metadata", requiresVerification: false, availability: "unavailable" },
  { id: "engagement.skeptical-comments", category: "engagement", strength: "medium", weight: 8,
    description: "High upvotes while substantive comments are mostly skeptical",
    affects: [P], evidenceSource: "comments", requiresVerification: true, availability: "unavailable" },
  { id: "engagement.repeat-product-engagement", category: "engagement", strength: "medium", weight: 10,
    description: "Repeated posts about the same product receive unusual engagement",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "engagement.same-group-early", category: "engagement", strength: "medium", weight: 10, maxWeight: 15,
    description: "Same small group repeatedly provides early positive engagement",
    affects: [P], evidenceSource: "history", requiresVerification: true, availability: "unavailable" },
  { id: "engagement.above-normal", category: "engagement", strength: "weak", weight: 5,
    description: "Post performs far above the normal range for its subreddit and age",
    affects: [P], evidenceSource: "external", requiresVerification: true, availability: "unavailable" },

  // ---- 14. Counter-signals ------------------------------------------------
  { id: "counter.limitations", category: "counter-signal", strength: "counter", weight: -15,
    description: "Discusses meaningful disadvantages or limitations",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "counter.compares-alternatives", category: "counter-signal", strength: "counter", weight: -10,
    description: "Fairly compares several reasonable alternatives",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "counter.varied-recommendations", category: "counter-signal", strength: "counter", weight: -15,
    description: "Recommends different products across account history",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "counter.genuine-history", category: "counter-signal", strength: "counter", weight: -10,
    description: "Has a long history of genuine, unrelated community participation",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "counter.useful-no-links", category: "counter-signal", strength: "counter", weight: -10,
    description: "Provides useful information without linking anything",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "counter.incidental-product", category: "counter-signal", strength: "counter", weight: -10,
    description: "Product is incidental and does not recur elsewhere",
    affects: [P], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "counter.answers-without-push", category: "counter-signal", strength: "counter", weight: -10,
    description: "Answers questions publicly without pushing a purchase",
    affects: [P], evidenceSource: "comments", requiresVerification: false, availability: "page" },
  { id: "counter.discourages-buyers", category: "counter-signal", strength: "counter", weight: -10,
    description: "Discourages unsuitable readers from buying",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "counter.no-cta", category: "counter-signal", strength: "counter", weight: -5,
    description: "No call to action, referral code, or commercial link",
    affects: [P], evidenceSource: "post-text", requiresVerification: false, availability: "local" },

  // ---- 15. Disclosure evaluation -----------------------------------------
  // Clear disclosure also confirms an author-product connection, which is
  // strong evidence of promotional *intent* (transparent promotion is still
  // promotion). That is why these carry promotion weight too.
  { id: "disclosure.creator", category: "disclosure", strength: "very-strong", weight: 30,
    description: "'I built this' or 'This is my product' - creator relationship disclosed",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.employment", category: "disclosure", strength: "very-strong", weight: 30,
    description: "'I am the founder' or 'I work for this company' - employment or ownership disclosed",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.material-benefit", category: "disclosure", strength: "very-strong", weight: 25,
    description: "'I received this for free' or 'I was paid to review it' - material benefit disclosed",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.affiliate", category: "disclosure", strength: "very-strong", weight: 25,
    description: "'I receive a commission from this link' - affiliate relationship disclosed",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.brand-affiliate-label", category: "disclosure", strength: "strong", weight: 20,
    description: "A visible platform Brand Affiliate label is present",
    affects: [P, D], evidenceSource: "post-metadata", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.unclear-working-on", category: "disclosure", strength: "medium", weight: 12,
    description: "'Something I have been working on' - relationship not explicit",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.unclear-involved", category: "disclosure", strength: "medium", weight: 12,
    description: "'A project I am involved with' - role and benefit not explicit",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.friends-product", category: "disclosure", strength: "medium", weight: 8,
    description: "'A friend's product' - personal connection may matter",
    affects: [P, D], evidenceSource: "post-text", requiresVerification: false, availability: "local", correlationGroup: "self-connection" },
  { id: "disclosure.profile-only", category: "disclosure", strength: "info", weight: 0,
    description: "Connection appears only in the profile - readers may not see it",
    affects: [D], evidenceSource: "profile", requiresVerification: true, availability: "unavailable" },
  { id: "disclosure.buried", category: "disclosure", strength: "info", weight: 0,
    description: "Disclosure is buried at the end or behind another action - readers may miss it",
    affects: [D], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
  { id: "disclosure.comments-only", category: "disclosure", strength: "info", weight: 0,
    description: "Connection is disclosed only in comments, not in the post itself",
    affects: [D], evidenceSource: "comments", requiresVerification: false, availability: "page" },

  // ---- Model judgment (language-model witness, free-form) -----------------
  { id: "model.observation", category: "model-judgment", strength: "medium", weight: 8, maxWeight: 8,
    description: "An observation by the language model outside the named criteria, backed by a quote",
    affects: [P], evidenceSource: "api", requiresVerification: false, availability: "page" },

  // ---- Availability notes (confidence only) ------------------------------
  { id: "availability.profile-history-checked", category: "availability", strength: "info", weight: 0,
    description: "The author's public posting history was checked",
    affects: [C], evidenceSource: "history", requiresVerification: false, availability: "history" },
  { id: "availability.profile-history-unavailable", category: "availability", strength: "info", weight: 0,
    description: "Author profile and posting history were not available; account, repetition and cross-post criteria were not evaluated",
    affects: [C], evidenceSource: "history", requiresVerification: false, availability: "local" },
  { id: "availability.comments-unavailable", category: "availability", strength: "info", weight: 0,
    description: "Comments were not visible (feed view); comment evidence was not evaluated",
    affects: [C], evidenceSource: "comments", requiresVerification: false, availability: "local" },
  { id: "availability.body-truncated", category: "availability", strength: "info", weight: 0,
    description: "Only a short excerpt of the post body was visible",
    affects: [C], evidenceSource: "post-text", requiresVerification: false, availability: "local" },
];

const byId = new Map(CRITERIA.map((c) => [c.id, c]));

export function getCriterion(id: string): Criterion {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown criterion id: ${id}`);
  return c;
}

export function listCriteria(filter?: { availability?: Criterion["availability"] }): Criterion[] {
  if (!filter?.availability) return [...CRITERIA];
  return CRITERIA.filter((c) => c.availability === filter.availability);
}

/**
 * Maximum points each category may contribute to the promotional score.
 * These caps are the main defence against many similar signals adding up to a
 * high score on their own (for example five marketing phrases).
 */
export const CATEGORY_CAPS: Record<string, number> = {
  "direct-cta": 40,
  account: 35,
  repetition: 35,
  workflow: 35,
  narrative: 25,
  "marketing-language": 15,
  links: 35,
  "comment-behavior": 30,
  "community-evidence": 30,
  coordination: 25,
  engagement: 10,
  disclosure: 30,
  "model-judgment": 15, // free-form model observations can never dominate
  "counter-signal": -35, // floor (most negative allowed)
  availability: 0,
};

/**
 * Categories that count as "behavioral" evidence. If a post has none of these,
 * the total from style-only categories (narrative + marketing language +
 * engagement) is capped so weak signals can never create a high score alone.
 */
export const BEHAVIORAL_CATEGORIES: ReadonlySet<string> = new Set([
  "direct-cta", "links", "workflow", "disclosure", "account", "repetition",
  "comment-behavior", "community-evidence", "coordination",
]);

/**
 * Minimum score when the author confirms a product connection and asks
 * readers to act. Transparent promotion is still promotion.
 */
export const CONFIRMED_PROMOTION_FLOOR = 80;

/** Highest score reachable from style-only evidence. */
export const STYLE_ONLY_CAP = 39;

/** How much a second/third signal in the same correlation group still counts. */
export const CORRELATION_DISCOUNT = 0.25;

/** Unverified signals that require verification count at this fraction. */
export const UNVERIFIED_DISCOUNT = 0.25;
