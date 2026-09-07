/**
 * Local rule-based signal detectors.
 *
 * Each detector looks at *visible* post information and emits Signals that
 * reference a criterion from criteria.ts. Nothing here fabricates evidence:
 * if the information needed for a criterion is not present, the detector
 * simply does not fire, and availability notes lower confidence instead.
 *
 * Detectors are deliberately conservative regular expressions. They are
 * expected to be tuned against labelled examples (see docs/testing.md).
 */
import { getCriterion } from "./criteria.js";
import { detectHistorySignals } from "./history.js";
import type { PostInput, Signal, VisibleComment } from "./types.js";
import {
  countMatches,
  domainOf,
  escapeRegExp,
  extractUrls,
  findNameCandidates,
  isFamiliarTool,
  NON_PRODUCT_DOMAINS,
  normalizeWhitespace,
  splitSentences,
  wordCount,
} from "./text.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SignalOptions {
  weight?: number;
  verified?: boolean;
  explanation?: string;
  excerpt?: string;
  sourceUrl?: string;
}

/** Build a Signal from a criterion id, with optional overrides. */
export function makeSignal(id: string, opts: SignalOptions = {}): Signal {
  const c = getCriterion(id);
  const weight = opts.weight ?? c.weight;
  return {
    id: c.id,
    category: c.category,
    explanation: opts.explanation ?? c.description,
    weight: c.maxWeight !== undefined ? Math.min(weight, c.maxWeight) : weight,
    evidenceSource: c.evidenceSource,
    verified: opts.verified ?? !c.requiresVerification,
    affects: [...c.affects],
    strength: c.strength,
    correlationGroup: c.correlationGroup,
    excerpt: opts.excerpt,
    sourceUrl: opts.sourceUrl,
  };
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? normalizeWhitespace(m[0]).slice(0, 80) : undefined;
}

function positionOf(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? m.index / Math.max(1, text.length) : -1;
}

/** Jaccard similarity of word sets - used to spot copied comments. */
function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// ---------------------------------------------------------------------------
// Context built once per post
// ---------------------------------------------------------------------------

export interface DetectionContext {
  post: PostInput;
  title: string;
  body: string;
  /** title + body */
  text: string;
  words: number;
  links: string[];
  /** Non-Reddit, non-general-purpose destinations */
  productLinks: string[];
  productDomains: string[];
  /** name -> mention count */
  names: Map<string, number>;
  /** Most-mentioned candidate that is not a widely known tool. */
  primaryProduct?: string;
  primaryMentions: number;
  familiarMentioned: string[];
}

export function buildContext(post: PostInput): DetectionContext {
  const title = normalizeWhitespace(post.title ?? "");
  const body = (post.body ?? "").trim();
  const text = `${title}\n${body}`;
  const links = Array.from(new Set([...(post.links ?? []), ...extractUrls(body)]));
  const productLinks = links.filter((u) => {
    const d = domainOf(u);
    return d !== undefined && !NON_PRODUCT_DOMAINS.has(d) && !d.endsWith(".reddit.com");
  });
  const productDomains = Array.from(
    new Set([
      ...productLinks.map((u) => domainOf(u)!).filter(Boolean),
      ...(post.outboundDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, "")).filter((d) => !NON_PRODUCT_DOMAINS.has(d)),
    ]),
  );
  const names = findNameCandidates(text, productDomains);

  const familiarMentioned = [...names.keys()].filter((n) => isFamiliarTool(n));
  const candidates = [...names.entries()]
    .filter(([n]) => !isFamiliarTool(n))
    .sort((a, b) => b[1] - a[1]);

  // Prefer a candidate whose name matches a linked domain.
  const linkedLabels = productDomains.map((d) => d.split(".")[0]!.toLowerCase());
  const linked = candidates.find(([n]) => linkedLabels.includes(n.toLowerCase()));
  const primary = linked ?? candidates[0];

  return {
    post,
    title,
    body,
    text,
    words: wordCount(text),
    links,
    productLinks,
    productDomains,
    names,
    primaryProduct: primary?.[0],
    primaryMentions: primary?.[1] ?? 0,
    familiarMentioned,
  };
}

function productRegex(ctx: DetectionContext): RegExp | undefined {
  if (!ctx.primaryProduct) return undefined;
  return new RegExp(`\\b${escapeRegExp(ctx.primaryProduct)}\\b`, "gi");
}

// ---------------------------------------------------------------------------
// 3. Direct promotional signals
// ---------------------------------------------------------------------------

const CTA_VERBS =
  "buy|purchase|order|download|install|sign ?up|register|subscribe|book a (?:demo|call)|try it (?:out|free|now|today|at|here|on)|get started|start (?:your )?free trial|grab (?:it|yours|a copy)|check it out|get it (?:here|now|today)|here(?:'s| is) (?:the |my )?(?:link|one i (?:got|use|bought|ordered|went with))";
/**
 * A call to action is an *instruction to the reader*: the verb opens a
 * sentence/clause or follows "you can", "go", "just", "please"... Descriptions
 * such as "one-click install from the Store" or "people who download it" are
 * not calls to action and must not match.
 */
const CTA_RE = new RegExp(
  "(?:(?:^|[.!?:;\\n]\\s*|\\b(?:you can|you should|go|just|please|feel free to|head over and|come|now)\\s+)(?:" +
    CTA_VERBS +
    ")\\b|\\blink in (?:bio|comments?|profile)\\b)",
  "i",
);
const COUPON_RE =
  /\b(?:coupon|promo ?code|discount code|use code|referral code|\d{1,2}% off|percent off|limited[- ]time|offer ends|early[- ]bird|lifetime deal|\bLTD\b|first \d+ (?:users|customers|people|signups) (?:get|receive|will get|can)\b|only \d+ (?:spots|seats|licenses) left|limited (?:spots|seats|slots)|spots (?:are )?limited)\b/i;
/** Case-sensitive: an uppercase token after "code" is a promo code even without "use". */
const CODE_TOKEN_RE = /\bcode[:\s]+[A-Z][A-Z0-9]{3,}\b/;
const SIGNUP_BENEFIT_RE =
  /\b(?:sign ?up|join|register|subscribe)\b[^.!?\n]{0,60}\b(?:get|receive|free|bonus|credits|unlock|reward)\b/i;
const WAITLIST_RE = /\b(?:wait ?list|(?:join|sign ?up for|get|request|apply for) (?:the |our )?(?:early access|beta access|beta list|beta|closed beta)|early[- ]access (?:link|signup|sign-up|form))\b/i;
const COMMENT_INTERESTED_RE =
  /\b(?:comment|reply|drop)\s+(?:with\s+)?["'“]?(?:interested|yes|me|info|link|send|template|workflow|access)\b/i;
const DM_RE = /\b(?:dm|pm|message)\s+me\b|\bi(?:'ll| will) (?:dm|pm|message) you\b|\bdm (?:for|if you)\b|\bsend (?:me )?a (?:dm|message|pm)\b|\bdms? (?:are )?open\b|\bshoot me a (?:dm|message)\b/i;
const DM_FOR_RE = /\b(?:dm|pm|message)\s+me\b[^.!?\n]{0,40}\b(?:link|template|workflow|details|access|invite|code|guide|list|doc)\b/i;
const FEEDBACK_RE = /\b(?:feedback|thoughts|what do you (?:think|guys think)|would love to hear|let me know what you think)\b/i;

function detectDirectSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  const { text } = ctx;

  if (CTA_RE.test(text)) {
    out.push(makeSignal("cta.direct", {
      explanation: "The post directly asks readers to buy, sign up, download, or try something",
      excerpt: firstMatch(text, CTA_RE),
    }));
  }
  if ((COUPON_RE.test(text) || CODE_TOKEN_RE.test(text))) {
    const strong = /\b(?:promo ?code|discount code|use code|referral code)\b/i.test(text);
    out.push(makeSignal("cta.coupon", {
      weight: strong ? 25 : 20,
      explanation: strong ? "The post includes a discount, promo or referral code" : "The post includes a discount or time-limited offer",
      excerpt: firstMatch(text, COUPON_RE),
    }));
  }
  if (SIGNUP_BENEFIT_RE.test(text)) {
    out.push(makeSignal("cta.signup-benefit", { excerpt: firstMatch(text, SIGNUP_BENEFIT_RE) }));
  }
  if (WAITLIST_RE.test(text)) {
    out.push(makeSignal("cta.waitlist", { excerpt: firstMatch(text, WAITLIST_RE) }));
  }
  if (COMMENT_INTERESTED_RE.test(text)) {
    out.push(makeSignal("cta.comment-interested", { excerpt: firstMatch(text, COMMENT_INTERESTED_RE) }));
  }
  if (DM_RE.test(text)) {
    const specific = DM_FOR_RE.test(text);
    out.push(makeSignal("cta.dm-request", {
      weight: specific ? 20 : 15,
      explanation: specific
        ? "Readers are asked to send a private message to get the link, template or details"
        : "Readers are asked to send a private message",
      excerpt: firstMatch(text, DM_RE),
    }));
  }
  if (FEEDBACK_RE.test(text) && ctx.productLinks.length > 0 && CTA_RE.test(text)) {
    out.push(makeSignal("cta.feedback-redirect"));
  }

  // Repeated links to the same product domain
  const domainCounts = new Map<string, number>();
  for (const u of ctx.productLinks) {
    const d = domainOf(u);
    if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }
  const repeated = [...domainCounts.entries()].find(([, n]) => n >= 2);
  if (repeated) {
    out.push(makeSignal("cta.repeated-links", {
      explanation: `The post links to ${repeated[0]} ${repeated[1]} times`,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9. Links and domains
// ---------------------------------------------------------------------------

const AFFILIATE_PARAM_RE =
  /[?&](?:ref|referral|referrer|aff|affiliate|affid|aff_id|tag|via|invite|promo|coupon|discount|partner|sub_?id|clickid|irclickid|cjevent|awc|sscid|rfsn|fpr|gr_pk|utm_campaign=affiliate)=/i;
const AFFILIATE_PATH_RE = /\/(?:ref|refer|referral|aff|affiliate|invite|r)\/[A-Za-z0-9_-]{3,}(?:[/?#]|$)/i;
const REDIRECT_HOSTS = [
  "bit.ly", "tinyurl.com", "t.co", "lnk.to", "linktr.ee", "rebrand.ly", "cutt.ly", "shorturl.at",
  "ow.ly", "buff.ly", "is.gd", "amzn.to", "geni.us", "prf.hn", "go.magik.ly", "shareasale.com",
  "clickbank.net", "hop.clickbank.net", "linksynergy.com", "anrdoezrs.net", "tkqlhce.com", "dpbolvw.net",
];

function detectLinkSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  let affiliate: string | undefined;
  let redirect: string | undefined;

  for (const u of ctx.productLinks) {
    const d = domainOf(u) ?? "";
    if (!affiliate && (AFFILIATE_PARAM_RE.test(u) || AFFILIATE_PATH_RE.test(u) || (d.endsWith("amazon.com") && /[?&]tag=/.test(u)))) {
      affiliate = d;
    }
    if (!redirect && REDIRECT_HOSTS.some((h) => d === h || d.endsWith("." + h))) redirect = d;
  }
  if (affiliate) {
    out.push(makeSignal("link.affiliate-params", {
      explanation: `A link to ${affiliate} carries affiliate or referral tracking parameters`,
    }));
  }
  if (redirect) {
    out.push(makeSignal("link.redirect-tracking", {
      explanation: `A link goes through a redirect or tracking domain (${redirect})`,
    }));
  }

  if (ctx.productLinks.length > 0 || ctx.productDomains.length > 0) {
    const d = ctx.productDomains[0] ?? domainOf(ctx.productLinks[0]!);
    out.push(makeSignal("link.product-link", {
      explanation: d ? `The post contains a direct link to ${d}` : "The post contains a direct product link",
    }));
  }

  // Only one tool in a multi-tool post receives a link
  const toolsMentioned = ctx.familiarMentioned.length + (ctx.primaryProduct ? 1 : 0);
  if (toolsMentioned >= 3 && ctx.productDomains.length === 1 && ctx.primaryProduct) {
    const label = ctx.productDomains[0]!.split(".")[0]!.toLowerCase();
    if (label === ctx.primaryProduct.toLowerCase()) {
      out.push(makeSignal("workflow.only-product-linked", {
        explanation: `Several tools are mentioned but only ${ctx.primaryProduct} receives a link`,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Embedded workflow promotion
// ---------------------------------------------------------------------------

const STEP_RE = /(?:^|\n)\s*(?:step\s*\d+|\d+[.)]\s|[-*•]\s)|\b(?:first,|then|next,|after that|finally,|→|->)\b/gim;
const NECESSARY_RE = /\b(?:need|must|have to|essential|required|can't (?:do|work|live) without|non[- ]negotiable|the key (?:is|was))\b/i;
const ATTRIBUTION_RE = /\b(?:thanks to|because of|that's when|is what (?:made|got|helped|changed)|this alone|the (?:real )?reason (?:it|this) worked|made all the difference)\b/i;

function detectWorkflowSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  if (!ctx.primaryProduct) return out;
  const pRe = productRegex(ctx)!;
  const steps = countMatches(ctx.body, STEP_RE);
  const isWorkflow = steps >= 2;

  if (isWorkflow && ctx.familiarMentioned.length >= 1) {
    out.push(makeSignal("workflow.obscure-among-familiar", {
      explanation: `${ctx.primaryProduct} is presented alongside well-known tools (${ctx.familiarMentioned.slice(0, 3).join(", ")})`,
    }));
  }

  const sentences = splitSentences(ctx.body);
  const productSentences = sentences.filter((s) => pRe.test(s) && (pRe.lastIndex = 0) === 0);

  if (isWorkflow && productSentences.some((s) => NECESSARY_RE.test(s))) {
    out.push(makeSignal("workflow.necessary-step", {
      explanation: `${ctx.primaryProduct} is described as a necessary step`,
    }));
  }
  if (productSentences.some((s) => ATTRIBUTION_RE.test(s))) {
    out.push(makeSignal("workflow.success-attributed", {
      explanation: `The successful outcome is attributed to ${ctx.primaryProduct}`,
    }));
  }

  // Product receives more explanation than supporting tools
  if (ctx.familiarMentioned.length >= 1 && productSentences.length >= 3) {
    const maxFamiliar = Math.max(
      0,
      ...ctx.familiarMentioned.map((t) => sentences.filter((s) => new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(s)).length),
    );
    if (productSentences.length >= Math.max(3, maxFamiliar * 2)) {
      out.push(makeSignal("workflow.more-detail", {
        explanation: `${ctx.primaryProduct} gets far more explanation than the supporting tools`,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. Story and narrative
// ---------------------------------------------------------------------------

const PROBLEM_RE = /\b(?:struggl\w*|stuck|couldn't|could not|frustrat\w*|wasted|spent (?:hours|days|weeks|months)|nightmare|painful|overwhelmed|burn(?:ed|t)? ?out|failing|was losing|no idea)\b/i;
const DISCOVERY_RE = /\b(?:found|discovered|stumbled (?:upon|across|on)|came across|tried|started using|switched to|signed up for|a friend (?:told|recommended|showed) me)\b/i;
const SUCCESS_RE = /\b(?:now i|doubled|tripled|10x|\d+x|skyrocket\w*|finally|saved me|game[- ]?changer|changed everything|never looked back|in (?:just |only )?\d+ (?:days|weeks|hours)|from \$?\d[\d,]* to \$?\d[\d,]*|\d+% (?:increase|growth|more))\b/i;
const EMOTIONAL_RE = /\b(?:cried|crying|depress\w*|anxi\w*|panic|lost my job|laid off|broke|desperate|rock bottom|divorce|sleepless|hopeless)\b/i;
const ADVICE_TITLE_RE = /\b(?:how (?:to|i)|tips|guide|lessons|what i learned|things i wish|mistakes|framework|playbook|checklist|advice)\b/i;
const RESULT_TITLE_RE = /(?:\d+[kK%x]\b|\$\d|doubled|tripled|from \d[\d,]* to \d[\d,]*|in \d+ (?:days|weeks|months)|how i (?:got|made|grew|went|hit|reached))/i;
const SOLVES_ALL_RE = /\b(?:solved|fixed|handles|takes care of|covers|does)\s+(?:all|everything|every single|literally everything)\b/i;
const LIMITATION_RE = /\b(?:downsides?|drawbacks?|limitations?|cons\b|not perfect|isn't perfect|doesn't (?:do|support|work|handle)|wish it|annoying|buggy|clunky|the (?:bad|ugly)|caveats?|but it (?:can't|doesn't|lacks|isn't)|not (?:great|ideal) (?:for|at)|pricey|expensive|steep learning curve|learning curve|room for improvement|far from perfect|only downside)\b/i;
const RESOLUTION_RE = /\b(?:what (?:finally|actually|really|eventually) (?:helped|worked|fixed it|made the difference)|the (?:only |one )?thing that (?:finally |actually )?(?:helped|worked)|finally (?:helped|worked|fixed))\b/i;
const TESTIMONIAL_RE = /\b(?:highly recommend|can't recommend (?:it |this )?enough|best (?:decision|purchase|investment)|worth every (?:penny|cent|dollar)|you won't regret|10\/10|life[- ]?saver|absolutely (?:love|loving)|hands down the best|i'm obsessed)\b/i;
const DRAMATIC_RE = /(?:\b\d{2,}x\b|\b10x\b|\b\d+% (?:increase|more|faster|growth|conversion)|\$\d[\d,]*(?:k)?\s?(?:\/|per|a) ?(?:month|mo|day|week)|\bovernight\b|in (?:just |only )?\d+ (?:hours|minutes)|\bpassive income\b)/i;

function detectNarrativeSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  const { body, text, title } = ctx;
  const pRe = productRegex(ctx);
  // Where the product enters the story: its name, or failing that its link.
  const namePos = pRe ? positionOf(body, new RegExp(pRe.source, "i")) : -1;
  const linkPos = ctx.productLinks.length ? Math.min(...ctx.productLinks.map((u) => body.indexOf(u)).filter((i) => i >= 0).map((i) => i / Math.max(1, body.length)), 2) : -1;
  const productPos = namePos >= 0 ? namePos : linkPos >= 0 && linkPos <= 1 ? linkPos : -1;
  const hasProduct = productPos >= 0 || ctx.productLinks.length > 0;
  // A DM/keyword request means the "product" is the thing being withheld.
  const hasOffer = hasProduct || DM_RE.test(text) || COMMENT_INTERESTED_RE.test(text) || CTA_RE.test(text);

  if (hasOffer && ctx.words >= 40) {
    const problemPos = Math.max(positionOf(body, PROBLEM_RE), positionOf(body, EMOTIONAL_RE)) === -1
      ? -1
      : Math.min(...[positionOf(body, PROBLEM_RE), positionOf(body, EMOTIONAL_RE)].filter((p) => p >= 0));
    const discoveryPos = positionOf(body, DISCOVERY_RE);
    const successPos = (() => {
      const re = new RegExp(SUCCESS_RE.source, "gi");
      let last = -1;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) last = m.index / Math.max(1, body.length);
      return last;
    })();
    // "What finally helped was ..." states the resolution before naming the product.
    const resolutionPos = positionOf(body, RESOLUTION_RE);
    const outcomePos = Math.max(successPos, resolutionPos);
    const midPos = Math.max(discoveryPos, productPos);
    if (problemPos >= 0 && midPos > problemPos && outcomePos > problemPos) {
      out.push(makeSignal("story.problem-product-success", {
        explanation: "The story moves from a problem to discovering the product to a dramatic result",
      }));
    }
    if (EMOTIONAL_RE.test(body.slice(0, Math.floor(body.length * 0.35))) && productPos > 0.3) {
      out.push(makeSignal("story.emotional-intro"));
    }
  }

  if (ADVICE_TITLE_RE.test(title) && ctx.words >= 80) {
    const tail = body.slice(Math.floor(body.length * 0.7));
    if (extractUrls(tail).some((u) => ctx.productLinks.includes(u)) || CTA_RE.test(tail) || DM_RE.test(tail)) {
      out.push(makeSignal("story.advice-then-product", {
        explanation: "The post starts as general advice but ends by directing readers to a product",
      }));
    }
  }

  if (RESULT_TITLE_RE.test(title) && (ctx.productLinks.length > 0 || CTA_RE.test(body))) {
    out.push(makeSignal("story.result-title-tool-body"));
  }

  if (hasProduct && SOLVES_ALL_RE.test(body) && countMatches(body, PROBLEM_RE) >= 2) {
    out.push(makeSignal("story.solves-everything"));
  }

  if (hasOffer && ctx.words >= 80 && !LIMITATION_RE.test(text)) {
    out.push(makeSignal("story.no-limitations"));
  }

  if (ctx.productLinks.length > 0 && ctx.words < 60 && !/\d/.test(body)) {
    out.push(makeSignal("story.few-details"));
  }

  if (ctx.primaryProduct && ctx.primaryMentions >= 4 && ctx.primaryMentions >= Math.floor(ctx.words / 60) + 2) {
    const seoLike = ctx.primaryMentions >= 6;
    out.push(makeSignal(seoLike ? "lang.seo-name-repetition" : "story.name-repeated", {
      explanation: `${ctx.primaryProduct} is named ${ctx.primaryMentions} times`,
    }));
  }

  if (TESTIMONIAL_RE.test(text)) {
    out.push(makeSignal("story.testimonial", { excerpt: firstMatch(text, TESTIMONIAL_RE) }));
  }
  if (DRAMATIC_RE.test(text) && hasOffer) {
    out.push(makeSignal("story.dramatic-claims", { excerpt: firstMatch(text, DRAMATIC_RE) }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. Marketing language
// ---------------------------------------------------------------------------

const HYPE_RE = /\b(?:game[- ]?changer|game[- ]?changing|must[- ]have|revolutionary|revolutioni[sz]e|mind[- ]?blowing|incredible|insane(?:ly)?|next[- ]level|cutting[- ]edge|state[- ]of[- ]the[- ]art|best[- ]in[- ]class|world[- ]class)\b/i;
const TRANSFORM_RE = /\b(?:changed (?:everything|my life|the game)|life[- ]changing|never (?:going|looking) back|totally transformed|completely transformed|transformed my)\b/i;
const FEATURE_RE = /\b(?:features?|supports?|integrat\w+|automat\w+|dashboard|analytics|real[- ]time|unlimited|seamless(?:ly)?|one[- ]click|built[- ]in|out of the box|no[- ]code|ai[- ]powered|plug[- ]and[- ]play|sync(?:s|ed)?)\b/i;
const BULLET_RE = /(?:^|\n)\s*(?:[-*•]|✅|✔|☑|\u{1F680}|\u{1F525}|\u{1F4A1}|⭐|\u{1F4CC}|\u{1F449})\s+\S/gmu;
const SLOGAN_RE = /\b(?:the (?:only|smartest|easiest|fastest|simplest) way to|your all[- ]in[- ]one|#1 |number one|the future of|built for (?:teams|creators|founders) who)\b/i;
const PERFORMANCE_RE = /\b(?:\d+x (?:faster|better|more|cheaper)|saves? (?:me |you )?\d+\+? hours|\d+% (?:faster|more accurate|better|cheaper)|99\.\d+% uptime|zero (?:effort|setup))\b/i;
const PRICING_RE = /(?:\$\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:mo|month|yr|year|user|seat)|\b(?:free plan|free tier|pro plan|starter plan|pricing starts|lifetime (?:license|access) for)\b)/i;
const SEARCH_TITLE_RE = /^(?:best|top \d+|\d+ best|the best)\b.*\b(?:for|to|in \d{4})\b|\b(?:review|vs\.?|alternatives?)\b/i;

function detectLanguageSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  const { text, body, title } = ctx;

  if (HYPE_RE.test(text)) out.push(makeSignal("lang.hype-phrases", { excerpt: firstMatch(text, HYPE_RE) }));
  if (TRANSFORM_RE.test(text)) out.push(makeSignal("lang.transformation", { excerpt: firstMatch(text, TRANSFORM_RE) }));

  const featureHits = countMatches(body, FEATURE_RE);
  if (featureHits >= 5 && ctx.words >= 60) out.push(makeSignal("lang.feature-focus", { explanation: `The text leans heavily on feature and benefit language (${featureHits} feature terms)` }));

  const bullets = countMatches(body, BULLET_RE);
  if (bullets >= 3 && featureHits >= 2) out.push(makeSignal("lang.sales-page-format"));

  if (SLOGAN_RE.test(text)) out.push(makeSignal("lang.slogans", { excerpt: firstMatch(text, SLOGAN_RE) }));
  if (PERFORMANCE_RE.test(text)) out.push(makeSignal("lang.unsupported-performance", { excerpt: firstMatch(text, PERFORMANCE_RE) }));
  if (PRICING_RE.test(body)) out.push(makeSignal("lang.pricing-details", { excerpt: firstMatch(body, PRICING_RE) }));
  if (SEARCH_TITLE_RE.test(title) && (ctx.primaryProduct || ctx.productLinks.length > 0)) out.push(makeSignal("lang.search-title"));
  return out;
}

// ---------------------------------------------------------------------------
// 15. Disclosure
// ---------------------------------------------------------------------------

export const CLEAR_CREATOR_RE =
  /\b(?:i|we)\s+(?:built|made|created|developed|designed|founded|launched|coded|wrote)\s+(?:this|it|the|a|an|my|our)\b|\b(?:this is|it's|it is)\s+(?:my|our)\s+(?:product|app|tool|startup|company|project|saas|service|site|website|extension|plugin|course|book|game)\b|\b(?:my|our)\s+(?:own\s+)?(?:product|app|tool|startup|company|saas|service|extension|plugin|course|book|game)\b|\bi(?:'m| am) the (?:founder|creator|developer|co-?founder|owner|maker|author|dev|builder)\b|\b(?:built|made|created|developed|building)\s+(?:the|a|an)\s+(?:tool|app|product|platform|service|thing|extension|site)\s+(?:i|we)\s+(?:needed|wanted|wished (?:i|we) had|always wanted)\b|\b(?:we|i)(?:'ve| have)?\s+(?:been\s+)?(?:working on|building|developing)\s+(?:it|this)\s+(?:daily|every day|full[- ]time|for (?:the (?:last|past) )?(?:\d+|two|three|four|five|six) (?:years?|months?))\b|\b(?:it|this|that) turned into (?:a|our|my) (?:project|product|startup|company|business|side project)\b|\b(?:we|i) (?:launched|shipped|released) (?:it|this|the app|the tool) (?:this|last) (?:week|month)\b|\bshameless (?:self[- ]?)?(?:plug|promo)\b|\bself[- ]?promo(?:tion)?\b|\bfull disclosure\b|\bdisclaimer:?\s*(?:i|this is)\b/i;
/**
 * "we built QuickDesign", "I created Mumbleflow": the object is a product
 * name, not "this/it/the". Case-sensitive on purpose - the name must be
 * capitalised - so this stays separate from the /i regex above.
 */
export const CREATOR_NAMED_RE =
  /\b(?:I|[Ww]e)\s+(?:built|made|created|developed|designed|launched|coded|wrote|started)\s+([A-Z][A-Za-z0-9.-]{2,})\b/;
/** "a tool we built", "the app I made" - relative clause after the noun. */
export const CREATOR_RELATIVE_RE =
  /\b(?:tool|app|product|thing|project|service|extension|site|website|game|saas|startup|bot|plugin)\s+(?:that\s+|which\s+)?(?:i|we)(?:'ve| have)?\s+(?:built|made|created|developed|designed|launched|coded|wrote)\b/i;
/**
 * "my app", "our company" on its own only discloses something when the post
 * is actually about a product (named or linked). "I need a demo video for my
 * SaaS" is context, not a disclosure.
 */
export const GENERIC_POSSESSIVE_RE =
  /\b(?:my|our)\s+(?:own\s+)?(?:product|app|tool|startup|company|saas|service|extension|plugin|course|book|game)\b/gi;
export const CLEAR_EMPLOYMENT_RE =
  /\bi\s+(?:work|am working)\s+(?:for|at|with)\s+(?:this|the|that|a|an)?\s*(?:company|team|startup|business|firm|agency|[A-Z][\w.-]+)\b|\bi(?:'m| am) (?:an? )?(?:employee|engineer|marketer|pm|product manager|community manager|dev|developer|founder|ceo|cto)\s+(?:at|of|for)\b|\bwe(?:'re| are) the (?:team|company|people) behind\b|\bon behalf of\b/i;
export const CLEAR_BENEFIT_RE =
  /\b(?:i|we)\s+(?:received|got|was given|were given)\s+(?:this|it|the product|a (?:free )?(?:copy|unit|sample|license))\s+(?:for free|free|as a gift|in exchange)\b|\b(?:i was|we were)\s+paid\b|\bpaid (?:partnership|promotion|review|post)\b|\bsponsored (?:by|post|content|review)\b|\bgifted (?:by|to me|product)\b|\bfree (?:sample|unit|license) (?:from|by)\b/i;
export const CLEAR_AFFILIATE_RE =
  /\baffiliate (?:link|links|code|relationship|of|for|partner)\b|\bi (?:get|earn|receive|make) (?:a )?(?:small )?(?:commission|cut|kickback|percentage)\b|\breferral (?:link|code) (?:below|here|is mine|of mine)\b|\bthis is (?:an? )?(?:affiliate|referral) link\b|\bmy (?:affiliate|referral) (?:link|code)\b/i;

export const UNCLEAR_WORKING_ON_RE =
  /\bsomething (?:i|we)(?:'ve| have) been working on\b|\b(?:i|we)(?:'ve| have) been working on\b|\bi(?:'ve| have) been (?:building|tinkering|playing) with\b/i;
export const UNCLEAR_INVOLVED_RE =
  /\b(?:a )?project (?:i|we)(?:'m| am| are)? (?:involved|helping|part of)\b|\bi(?:'m| am) (?:kind of |kinda |sort of |somewhat )?(?:involved|connected|associated|affiliated) (?:with|in)\b|\bi (?:know|helped) the (?:founder|founders|team|guy|guys|dev|devs)\b|\bi(?:'m| am) close to the (?:team|project)\b|\bmy (?:team|friends?) (?:and i )?(?:are|is) (?:working on|building)\b/i;
export const FRIENDS_PRODUCT_RE =
  /\b(?:a |my )?(?:friend|buddy|mate|brother|sister|cousin|roommate|coworker|colleague)(?:'s| of mine)?\s+(?:built|made|created|runs|started|launched|product|app|tool|startup|company)\b/i;

export interface DisclosureDetection {
  signals: Signal[];
  clear: boolean;
  unclear: boolean;
  buried: boolean;
}

export function detectDisclosure(ctx: DetectionContext): DisclosureDetection {
  const signals: Signal[] = [];
  const { text } = ctx;
  let clear = false;
  let unclear = false;
  let buried = false;

  // Creator disclosure: explicit statements always count; a bare "my app" /
  // "our company" only counts when the post is about a product.
  const aboutAProduct = !!ctx.primaryProduct || ctx.productLinks.length > 0;
  const creatorRe = [CREATOR_NAMED_RE, CREATOR_RELATIVE_RE, CLEAR_CREATOR_RE].find((re) => {
    if (re === CLEAR_CREATOR_RE) {
      const withoutGeneric = text.replace(GENERIC_POSSESSIVE_RE, " ");
      return re.test(withoutGeneric) || (aboutAProduct && re.test(text));
    }
    return re.test(text);
  });

  const clearChecks: [string, RegExp | undefined, string][] = [
    ["disclosure.creator", creatorRe, "The author states they built or own the product"],
    ["disclosure.employment", CLEAR_EMPLOYMENT_RE, "The author discloses working for the company"],
    ["disclosure.material-benefit", CLEAR_BENEFIT_RE, "The author discloses receiving the product for free or being paid"],
    ["disclosure.affiliate", CLEAR_AFFILIATE_RE, "The author discloses an affiliate or commission relationship"],
  ];
  for (const [id, re, explanation] of clearChecks) {
    if (re && re.test(text)) {
      clear = true;
      signals.push(makeSignal(id, { explanation, excerpt: firstMatch(text, re) }));
      const pos = positionOf(text, new RegExp(re.source, re.flags.includes("i") ? "i" : ""));
      // Buried: at the very end of a medium post, or past the midpoint of a
      // long one ("...my own tool called X" in tip 4 of 5). Readers skimming
      // a long guide will not see it.
      if ((ctx.words > 150 && pos > 0.85) || (ctx.words > 300 && pos > 0.5)) buried = true;
    }
  }
  if (ctx.post.brandAffiliateLabel) {
    clear = true;
    signals.push(makeSignal("disclosure.brand-affiliate-label", { explanation: "Reddit shows a Brand Affiliate label on this post" }));
  }
  if (buried) {
    signals.push(makeSignal("disclosure.buried", { explanation: "The disclosure appears only at the very end of a long post, where readers may miss it" }));
  }

  if (!clear) {
    const unclearChecks: [string, RegExp, string][] = [
      ["disclosure.unclear-working-on", UNCLEAR_WORKING_ON_RE, "The author says they have been 'working on' it without stating their role or benefit"],
      ["disclosure.unclear-involved", UNCLEAR_INVOLVED_RE, "The author mentions being involved or knowing the team without explaining the relationship"],
      ["disclosure.friends-product", FRIENDS_PRODUCT_RE, "The product is described as a friend's or relative's - a personal connection may matter"],
    ];
    for (const [id, re, explanation] of unclearChecks) {
      if (re.test(text)) {
        unclear = true;
        signals.push(makeSignal(id, { explanation, excerpt: firstMatch(text, re) }));
      }
    }
  }
  return { signals, clear, unclear, buried };
}

// ---------------------------------------------------------------------------
// 14. Counter-signals
// ---------------------------------------------------------------------------

const COMPARE_RE = /\b(?:compared (?:to|with)|vs\.?|versus|alternatives?|instead of|switched from|also tried|other options|pros and cons|trade[- ]?offs?|depends on your)\b/i;
const DISCOURAGE_RE = /\b(?:don't (?:buy|need|bother)|not (?:for everyone|worth it if|necessary if)|skip (?:it|this) if|you probably don't need|overkill (?:for|if)|only (?:worth it|makes sense) if|free (?:options|tools) (?:are|work) (?:fine|enough))\b/i;

function detectCounterSignals(ctx: DetectionContext, hasCommercialSignal: boolean): Signal[] {
  const out: Signal[] = [];
  const { text } = ctx;

  const limitationHits = countMatches(text, LIMITATION_RE);
  if (limitationHits >= 1) {
    out.push(makeSignal("counter.limitations", {
      weight: limitationHits >= 2 ? -15 : -10,
      explanation: "The post discusses drawbacks or limitations",
      excerpt: firstMatch(text, LIMITATION_RE),
    }));
  }
  // A genuine comparison names at least two tools in the same sentence as the
  // comparison wording ("X vs Y", "compared to", "instead of"...).
  const toolNames = [...ctx.names.keys()];
  const comparisonSentence = splitSentences(text).find((sentence) => {
    if (!COMPARE_RE.test(sentence)) return false;
    const mentioned = toolNames.filter((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(sentence)).length;
    return mentioned >= 2;
  });
  if (comparisonSentence && toolNames.length >= 3) {
    out.push(makeSignal("counter.compares-alternatives", {
      explanation: "The post compares several alternatives rather than pushing one",
      excerpt: normalizeWhitespace(comparisonSentence).slice(0, 80),
    }));
  }
  if (ctx.links.length === 0 && ctx.words >= 120) {
    out.push(makeSignal("counter.useful-no-links", {
      explanation: "The post shares detailed information without linking to anything",
    }));
  }
  if (DISCOURAGE_RE.test(text)) {
    out.push(makeSignal("counter.discourages-buyers", { excerpt: firstMatch(text, DISCOURAGE_RE) }));
  }
  if (!hasCommercialSignal && ctx.productLinks.length === 0) {
    out.push(makeSignal("counter.no-cta", {
      explanation: "No call to action, referral code, or commercial link was found",
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Account signals available locally
// ---------------------------------------------------------------------------

function detectAccountSignals(ctx: DetectionContext): Signal[] {
  const out: Signal[] = [];
  const author = (ctx.post.author ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!author || author.length < 4) return out;
  const candidates = [
    ...(ctx.primaryProduct ? [ctx.primaryProduct] : []),
    ...ctx.productDomains.map((d) => d.split(".")[0]!),
  ].map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((n) => n.length >= 4);
  const hit = candidates.find((n) => author.includes(n) || n.includes(author));
  if (hit) {
    out.push(makeSignal("account.username-matches", {
      explanation: `The username resembles the product or brand name (${ctx.post.author})`,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 10-12. Comment evidence (post detail page only)
// ---------------------------------------------------------------------------

const ACCUSATION_RE =
  /\b(?:this is (?:just )?(?:an )?ad\b|it'?s (?:just )?an ad\b|of course it'?s an ad|is this (?:just )?(?:an ad|to sell|an advert\w*|a promo\w*)|just to sell\b|this is (?:just )?(?:an )?advert\w*|advertisement|astroturf\w*|shill\w*|sponsored|undisclosed|self[- ]?promo\w*|promo(?:tional)? post|marketing post|seo post|promoting (?:his|her|their) own|op (?:is|works for|made|owns|built)|guerr?illa marketing|paid post|native ad|stealth marketing|obvious(?:ly)? (?:an )?ad\b|bot post|spam(?:ming|mer)?\b|slop ?bot|tl;?dr:? (?:buy|use|sign up for) )/i;
/** A commenter says the author has posted this (or the product) before. */
const REPEAT_MENTION_RE = /\b(?:spamming again|posting (?:this )?again|posted this (?:before|already|last week|yesterday)|again with (?:the|this)|keeps? posting|every (?:day|week) with|same post (?:as|again)|reposting)\b/i;
const POSITIVE_RE = /\b(?:amazing|awesome|love (?:it|this)|great tool|thanks for sharing|just signed up|game changer|exactly what i needed|highly recommend)\b/i;
const PRIVATE_GROUP_RE = /\b(?:join (?:my|our) (?:discord|telegram|whatsapp|newsletter|mailing list|community|slack)|subscribe to (?:my|our) newsletter)\b/i;
const REDDIT_LINK_RE = /https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:r\/\w+\/comments\/|user\/|u\/)/i;

export interface CommentDetection {
  signals: Signal[];
  /** True when the author disclosed a connection in comments. */
  authorAdmission: boolean;
  /** True when accusations look copied/coordinated. */
  coordinatedAccusations: boolean;
}

export function detectCommentSignals(ctx: DetectionContext): CommentDetection {
  const signals: Signal[] = [];
  const comments = ctx.post.visibleComments ?? [];
  const opName = (ctx.post.author ?? "").toLowerCase();
  const isOp = (c: VisibleComment) => c.isOp === true || (!!opName && (c.author ?? "").toLowerCase() === opName);
  const opComments = comments.filter(isOp);
  const others = comments.filter((c) => !isOp(c));
  let authorAdmission = false;
  let coordinatedAccusations = false;

  // --- Accusations ---------------------------------------------------------
  const accusations = others.filter((c) => ACCUSATION_RE.test(c.text));
  const accusers = new Set(accusations.map((c) => c.author ?? `anon-${Math.random()}`));
  if (accusations.length >= 2) {
    let similarPairs = 0;
    for (let i = 0; i < accusations.length; i++) {
      for (let j = i + 1; j < accusations.length; j++) {
        if (similarity(accusations[i]!.text, accusations[j]!.text) >= 0.7) similarPairs++;
      }
    }
    if (similarPairs >= 1) {
      coordinatedAccusations = true;
      signals.push(makeSignal("community.coordinated-accusations", {
        explanation: "Several accusing comments use near-identical wording; they were not counted as evidence",
      }));
    }
  }
  if (!coordinatedAccusations) {
    if (accusers.size >= 2) {
      signals.push(makeSignal("community.several-independent-concerns", {
        explanation: `${accusers.size} different commenters raise concerns that the post may be promotional (unverified)`,
      }));
    } else if (accusations.length === 1) {
      signals.push(makeSignal("community.single-accusation", {
        explanation: "One commenter suggests the post is an ad, without supporting evidence",
      }));
    }
  }

  // A commenter says the author has posted this product before.
  const repeatMentions = others.filter((c) => REPEAT_MENTION_RE.test(c.text));
  if (repeatMentions.length > 0 && !coordinatedAccusations) {
    signals.push(makeSignal("community.repeated-posts-identified", {
      verified: false,
      explanation: `A commenter says the author has posted this before (${repeatMentions.length === 1 ? "one comment" : `${repeatMentions.length} comments`}, not verified by PromoLens)`,
      excerpt: normalizeWhitespace(repeatMentions[0]!.text).slice(0, 80),
    }));
  }

  // Evidence inside accusations: links to other Reddit posts / user pages.
  const withRedditLink = accusations.filter((c) => REDDIT_LINK_RE.test(c.text));
  if (withRedditLink.length > 0 && !coordinatedAccusations) {
    signals.push(makeSignal("community.linked-identical-post", {
      verified: false,
      explanation: "A commenter links to what they say is an earlier post by the author (not verified by PromoLens)",
    }));
  }
  const withExternalEvidence = accusations.filter((c) =>
    extractUrls(c.text).some((u) => {
      const d = domainOf(u);
      return d && !d.endsWith("reddit.com") && ctx.productDomains.includes(d);
    }),
  );
  if (withExternalEvidence.length > 0 && !coordinatedAccusations) {
    signals.push(makeSignal("community.author-product-evidence", {
      verified: false,
      explanation: "A commenter links to the product site as evidence of a connection to the author (not verified by PromoLens)",
    }));
  }

  // --- Author behaviour in comments ---------------------------------------
  const opText = opComments.map((c) => c.text).join("\n");
  if (opComments.length > 0) {
    if (CLEAR_CREATOR_RE.test(opText) || CLEAR_EMPLOYMENT_RE.test(opText) || CLEAR_AFFILIATE_RE.test(opText) || CLEAR_BENEFIT_RE.test(opText)) {
      authorAdmission = true;
      signals.push(makeSignal("community.author-admission", {
        explanation: "In the comments, the author acknowledges a connection to the product",
      }));
    }
    if (DM_RE.test(opText)) {
      signals.push(makeSignal("behavior.dm-for-link", { explanation: "In the comments, the author asks readers to send a private message" }));
    }
    if (COMMENT_INTERESTED_RE.test(opText)) {
      signals.push(makeSignal("behavior.comment-interested-dm"));
    }
    if (countMatches(opText, PRIVATE_GROUP_RE) >= 2) {
      signals.push(makeSignal("behavior.private-group"));
    }
    const opProductReplies = opComments.filter((c) => extractUrls(c.text).some((u) => ctx.productDomains.includes(domainOf(u) ?? ""))).length;
    if (opProductReplies >= 3) {
      signals.push(makeSignal("behavior.same-product-replies", {
        explanation: `The author replies with the product link in ${opProductReplies} comments`,
      }));
    }
    const pushes = DM_RE.test(opText) || CTA_RE.test(opText) || opProductReplies > 0;
    if (opComments.length >= 3 && !pushes) {
      signals.push(makeSignal("counter.answers-without-push", {
        explanation: "The author answers questions publicly without pushing a purchase",
      }));
    }
  }

  // --- Possible coordinated praise -----------------------------------------
  const positives = others.filter((c) => POSITIVE_RE.test(c.text) && c.text.length < 200);
  let similarPositive = 0;
  for (let i = 0; i < positives.length; i++) {
    for (let j = i + 1; j < positives.length; j++) {
      if (similarity(positives[i]!.text, positives[j]!.text) >= 0.7) similarPositive++;
    }
  }
  if (similarPositive >= 2) {
    signals.push(makeSignal("coord.similar-wording", {
      explanation: "Several supportive comments use unusually similar wording",
    }));
  }

  // --- Moderator removal note visible in body -----------------------------
  if (/\[removed\]|removed by (?:the )?moderators?/i.test(ctx.body) && /self[- ]?promo|spam|advertis/i.test(ctx.body)) {
    signals.push(makeSignal("community.mod-removed"));
  }

  return { signals, authorAdmission, coordinatedAccusations };
}

// ---------------------------------------------------------------------------
// 13. Reach (never promotion points)
// ---------------------------------------------------------------------------

export function detectReachSignals(post: PostInput): Signal[] {
  const out: Signal[] = [];
  if (typeof post.upvotes === "number") {
    out.push(makeSignal("reach.upvotes", { explanation: `${post.upvotes.toLocaleString("en-US")} upvotes (affects reach only)` }));
  }
  if (typeof post.commentsCount === "number") {
    out.push(makeSignal("reach.comments", { explanation: `${post.commentsCount.toLocaleString("en-US")} comments (affects reach only)` }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Availability notes (confidence only)
// ---------------------------------------------------------------------------

function detectAvailability(post: PostInput): Signal[] {
  const out: Signal[] = []; // history availability is reported by detectHistorySignals
  if (!post.isDetailPage) {
    out.push(makeSignal("availability.comments-unavailable"));
    if (post.body && post.body.length > 0) out.push(makeSignal("availability.body-truncated"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface DetectionOutput {
  signals: Signal[];
  context: DetectionContext;
  disclosure: DisclosureDetection;
  comments: CommentDetection;
}

export function detectAll(post: PostInput): DetectionOutput {
  const ctx = buildContext(post);
  const direct = detectDirectSignals(ctx);
  const links = detectLinkSignals(ctx);
  const workflow = detectWorkflowSignals(ctx);
  const narrative = detectNarrativeSignals(ctx);
  const language = detectLanguageSignals(ctx);
  const disclosure = detectDisclosure(ctx);
  const account = detectAccountSignals(ctx);
  const comments = post.isDetailPage ? detectCommentSignals(ctx) : { signals: [], authorAdmission: false, coordinatedAccusations: false };

  const hasCommercial = direct.length > 0 || links.some((s) => s.id !== "link.product-link") || ctx.productLinks.length > 0;
  const counter = detectCounterSignals(ctx, hasCommercial);
  const history = detectHistorySignals(post, {
    names: [...ctx.names.keys()].filter((n) => !isFamiliarTool(n)),
    domains: ctx.productDomains,
  });

  const signals = [...direct, ...links, ...workflow, ...narrative, ...language, ...disclosure.signals, ...account, ...comments.signals, ...counter, ...history];

  // Workflow/product promotion with no disclosure at all
  const productPromotion = ctx.primaryProduct && (workflow.length > 0 || links.length > 0 || direct.length > 0);
  if (productPromotion && !disclosure.clear && !disclosure.unclear && !comments.authorAdmission) {
    signals.push(makeSignal("workflow.no-relationship-disclosed", {
      explanation: `No relationship with ${ctx.primaryProduct} is disclosed`,
    }));
  }
  if (comments.authorAdmission && !disclosure.clear) {
    signals.push(makeSignal("disclosure.comments-only", {
      explanation: "The connection is disclosed only in the comments, not in the post",
    }));
  }

  signals.push(...detectReachSignals(post), ...detectAvailability(post));
  return { signals, context: ctx, disclosure, comments };
}
