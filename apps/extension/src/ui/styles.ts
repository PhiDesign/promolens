/**
 * Styles for the injected UI. Everything lives inside Shadow DOM, so Reddit's
 * CSS cannot reach in and ours cannot leak out. Colours come from custom
 * properties that switch with data-theme="dark".
 */

export const THEME_VARS = `
  :host {
    --pl-green: #2e9e5b;
    --pl-blue: #2f6fdb;
    --pl-amber: #c98a00;
    --pl-red: #d1433b;
    --pl-gray: #8f949a;
    --pl-track: rgba(0, 0, 0, 0.12);
    --pl-text: #1a1a1b;
    --pl-muted: #5f6368;
    --pl-bg: #ffffff;
    --pl-border: #d9dcdf;
    --pl-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
    --pl-focus: #4f46e5;
  }
  :host([data-theme="dark"]) {
    --pl-green: #4cc27a;
    --pl-blue: #6aa1ff;
    --pl-amber: #f2b233;
    --pl-red: #ef6b63;
    --pl-gray: #9aa0a6;
    --pl-track: rgba(255, 255, 255, 0.18);
    --pl-text: #e6e7e8;
    --pl-muted: #a4a7ab;
    --pl-bg: #1f2123;
    --pl-border: #3a3d40;
    --pl-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    --pl-focus: #8b85ff;
  }
`;

export const RING_CSS = `
  ${THEME_VARS}
  :host {
    display: inline-flex;
    align-items: center;
    align-self: center;
    /* margin-left:auto keeps us glued to the right-hand controls even when the
       header row uses justify-content: space-between. */
    margin: 0 4px 0 auto;
    line-height: 0;
    vertical-align: middle;
    contain: layout style;
  }
  /* Fallback placement on the title line (float so the title text flows beside it). */
  :host([data-placement="title"]) {
    display: inline-block;
    float: left;
    margin: 1px 8px 0 0;
  }
  :host {
    /* Reddit covers each post card with an invisible full-size link overlay.
       Positioning the host lifts the ring above it so hover/click reach us. */
    position: relative;
    /* Just above the card's invisible link overlay (z-index auto), but below
       Reddit's fixed header (z-index 4) so the ring scrolls under it. */
    z-index: 1;
    pointer-events: auto;
    /* Reddit hides un-upgraded custom elements (:not(:defined)) with
       visibility: hidden. Our hosts are plain elements with hyphenated tag
       names, so force visibility; !important inside a shadow tree wins over
       the outer page's normal rules. */
    visibility: visible !important;
  }
  :host([hidden]) { display: none !important; }
  button {
    all: initial;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    cursor: pointer;
    position: relative;
    color: var(--pl-text);
  }
  button:focus-visible {
    outline: 2px solid var(--pl-focus);
    outline-offset: 2px;
  }
  /* In the header the button matches Reddit's own icon buttons: a 32px round
     hit area with the same hover background. Reddit's colour custom properties
     inherit across the shadow boundary, so we reuse them with a safe fallback. */
  :host([data-placement="header"]) button {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    transition: background-color 0.15s ease;
  }
  :host([data-placement="header"]) button:hover,
  :host([data-placement="header"]) button:focus-visible,
  :host([data-placement="header"]) button[aria-expanded="true"] {
    background-color: var(--color-secondary-background-hover, rgba(128, 128, 128, 0.18));
  }
  :host([data-placement="header"]) button:focus-visible { outline-offset: 0; }
  svg { width: 24px; height: 24px; display: block; overflow: visible; }
  .track { fill: none; stroke: var(--pl-track); stroke-width: 2.5; }
  .arc {
    fill: none;
    stroke: var(--pl-color, var(--pl-gray));
    stroke-width: 2.5;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dashoffset 0.35s ease, stroke 0.2s ease;
  }
  .num {
    font: 700 8px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    fill: var(--pl-color, var(--pl-gray));
    text-anchor: middle;
    dominant-baseline: central;
  }
  /* Three digits ("100") must clear the 2.5px stroke inside the 24px ring. */
  .num[data-len="3"] { font-size: 7px; letter-spacing: -0.2px; }
  :host([data-state="green"]) { --pl-color: var(--pl-green); }
  :host([data-state="blue"]) { --pl-color: var(--pl-blue); }
  :host([data-state="amber"]) { --pl-color: var(--pl-amber); }
  :host([data-state="red"]) { --pl-color: var(--pl-red); }
  :host([data-state="analyzing"]) .arc,
  :host([data-state="idle"]) .arc,
  :host([data-state="error"]) .arc { --pl-color: var(--pl-gray); }
  :host([data-state="idle"]) .arc { stroke-dasharray: 3 3.5; }
  :host([data-state="idle"]) .num { fill: var(--pl-muted); font-size: 10px; }
  :host([data-state="idle"]) button:hover .arc,
  :host([data-state="idle"]) button:focus-visible .arc { stroke: var(--pl-focus); stroke-dasharray: none; }
  :host([data-state="idle"]) button:hover .num,
  :host([data-state="idle"]) button:focus-visible .num { fill: var(--pl-focus); }
  :host([data-state="analyzing"]) .arc {
    stroke-dasharray: 14 43;
    stroke-dashoffset: 0;
    animation: pl-spin 1s linear infinite;
  }
  :host([data-state="analyzing"]) .num { display: none; }
  @keyframes pl-spin { to { transform: rotate(270deg); } }
  @media (prefers-reduced-motion: reduce) {
    :host([data-state="analyzing"]) .arc { animation: none; stroke-dasharray: 28 29; }
    .arc { transition: none; }
  }
`;

export const POPOVER_CSS = `
  ${THEME_VARS}
  :host {
    position: fixed;
    z-index: 2147483646;
    top: 0;
    left: 0;
    display: block;
    pointer-events: none;
    visibility: visible !important; /* see RING_CSS: Reddit hides :not(:defined) elements */
  }
  :host([hidden]) { display: none !important; }
  .card {
    pointer-events: auto;
    box-sizing: border-box;
    width: 290px;
    max-width: calc(100vw - 16px);
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--pl-bg);
    color: var(--pl-text);
    border: 1px solid var(--pl-border);
    box-shadow: var(--pl-shadow);
    font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    /* Inherited text properties cross the shadow boundary; Reddit sets
       word-break/hyphens that would split "65%". Reset them here. */
    word-break: normal;
    overflow-wrap: break-word;
    hyphens: manual;
    text-align: left;
    letter-spacing: normal;
    text-transform: none;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 6px;
  }
  .verdict { font-size: 14px; font-weight: 700; color: var(--pl-text); }
  .verdict-dot { width: 9px; height: 9px; }
  .technique { margin: 0 0 8px; color: var(--pl-text); font-size: 12.5px; }
  .score { display: flex; align-items: baseline; gap: 10px; margin: 0 0 4px; }
  .pct { flex: none; white-space: nowrap; font-size: 20px; font-weight: 700; color: var(--pl-color, var(--pl-gray)); }
  .label { font-weight: 600; color: var(--pl-muted); }
  .meta { color: var(--pl-muted); margin: 0 0 8px; }
  .meta div { display: flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pl-color, var(--pl-gray)); flex: none; }
  ul { margin: 0 0 8px; padding: 0 0 0 16px; }
  li { margin: 2px 0; }
  a.src { color: var(--pl-focus); font-size: 11px; text-decoration: underline; white-space: nowrap; }
  a.src:focus-visible { outline: 2px solid var(--pl-focus); outline-offset: 1px; }
  .foot { color: var(--pl-muted); font-size: 11px; margin: 0; font-style: italic; }
  .card[data-state="green"] { --pl-color: var(--pl-green); }
  .card[data-state="blue"] { --pl-color: var(--pl-blue); }
  .card[data-state="amber"] { --pl-color: var(--pl-amber); }
  .card[data-state="red"] { --pl-color: var(--pl-red); }
`;
